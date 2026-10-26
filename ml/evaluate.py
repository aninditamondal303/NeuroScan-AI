"""Re-evaluate the saved model on the held-out Testing folder.

Uses the temperature, review threshold and OOD limit stored in
model/metadata.json (it never re-fits them on test data) and refreshes the
test sections of model/evaluation.json.

    python -m ml.evaluate --data-dir "C:\\data\\brain-tumor-mri-dataset"
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.metadata import ModelMetadata  # noqa: E402
from ml.dataset import build_cache, scan  # noqa: E402
from ml.evaluation import apply_threshold, classification_metrics, mahalanobis_min, reliability, softmax  # noqa: E402
from ml.train import log, predict_outputs, serving_check  # noqa: E402


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", required=True, type=Path)
    p.add_argument("--model-dir", type=Path, default=REPO_ROOT / "model")
    p.add_argument("--cache-dir", type=Path, default=REPO_ROOT / ".cache")
    args = p.parse_args(argv)

    meta = ModelMetadata.model_validate(json.loads((args.model_dir / "metadata.json").read_text(encoding="utf-8")))
    classes = [c.model_dump() for c in meta.classes]
    dataset = scan(args.data_dir)
    if dataset.class_ids != [c["id"] for c in classes]:
        raise SystemExit(f"Dataset classes {dataset.class_ids} differ from model classes {[c['id'] for c in classes]}.")
    cache = build_cache(dataset, args.data_dir, meta.input.height, args.cache_dir / f"preprocessed_{meta.input.height}.npz", log)
    test_idx = np.nonzero(cache.sources == "Testing")[0]
    y_test = cache.labels[test_idx]

    import tensorflow as tf

    keras = tf.keras
    model = keras.models.load_model(args.model_dir / meta.weights_file, compile=False)
    logits, emb = predict_outputs(keras, model, cache.images[test_idx])
    raw, cal = softmax(logits), softmax(logits, meta.calibration.temperature)
    metrics = classification_metrics(y_test, cal, classes)
    ece_raw, _ = reliability(raw, y_test)
    ece_cal, bins = reliability(cal, y_test)
    threshold = apply_threshold(cal, y_test, meta.decision.review_threshold)

    eval_path = args.model_dir / "evaluation.json"
    report = json.loads(eval_path.read_text(encoding="utf-8")) if eval_path.is_file() else {"schema_version": 1}
    if report.get("model_version") not in (None, meta.model_version):
        log("evaluation.json belongs to a different model version; starting a fresh report.")
        report = {"schema_version": 1}
    report["model_version"] = meta.model_version
    report["test"] = metrics
    report.setdefault("calibration", {}).update({"test_ece_before": ece_raw, "test_ece_after": ece_cal, "test_reliability": bins})
    report.setdefault("decision", {}).update(
        {
            "test_coverage": threshold["coverage"],
            "test_selective_accuracy": threshold["selective_accuracy"],
            "test_accuracy_of_flagged": threshold["accuracy_of_flagged"],
            "test_flagged_count": threshold["flagged_count"],
        }
    )
    if meta.ood is not None:
        with np.load(args.model_dir / meta.ood.stats_file) as data:
            dist = mahalanobis_min(emb, np.asarray(data["means"], np.float64), np.asarray(data["precision"], np.float64))
        report.setdefault("ood", {})["test_flag_rate"] = float(np.mean(dist > meta.ood.threshold))
    report["re_evaluated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report["serving_consistency"] = serving_check(
        args.model_dir, args.data_dir, cache.paths[test_idx][:24], cal[:24], meta.calibration.temperature
    )
    eval_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log(f"Test accuracy {metrics['accuracy']:.4f}, macro-F1 {metrics['macro_f1']:.4f} on {metrics['n']} images. Wrote {eval_path.name}.")
    log(f"Serving check: {report['serving_consistency']['summary']}")
    return 0 if report["serving_consistency"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
