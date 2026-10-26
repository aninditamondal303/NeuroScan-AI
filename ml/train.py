"""Train, compare, calibrate and evaluate NeuroScan models.

Example (PowerShell, from the repository root):

    python -m ml.train --data-dir "C:\\data\\brain-tumor-mri-dataset"

Outputs in ``model/`` (or ``--out``):
    best_model.keras      selected model (weights)
    metadata.json         everything the backend needs to serve it correctly
    ood_stats.npz         atypical-input detector statistics
    evaluation.json       held-out test results and training history
    split_manifest.json   which file went to train / validation / test

Rules this script follows:
* The Kaggle ``Testing`` folder is the held-out test set. It is used once, after
  the model, temperature and review threshold have been chosen on validation data.
* Training images that exactly or nearly duplicate a test image are removed.
* Validation is split from ``Training`` by near-duplicate group, stratified by class.
* Augmentation is applied to training batches only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.preprocessing import MODEL_CHANNELS, PREPROCESSING_ID  # noqa: E402
from ml.dataset import build_cache, class_info, grouped_validation_split, leakage_check, scan  # noqa: E402
from ml.evaluation import (  # noqa: E402
    apply_threshold,
    classification_metrics,
    fit_mahalanobis,
    fit_temperature,
    mahalanobis_min,
    nll,
    reliability,
    select_review_threshold,
    softmax,
)

DATASET_NAME = "Brain Tumor MRI Dataset (Masoud Nickparvar, Kaggle)"
DATASET_SOURCE = "https://www.kaggle.com/datasets/masoudnickparvar/brain-tumor-mri-dataset"


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data-dir", required=True, type=Path, help="Folder containing Training/ and Testing/")
    p.add_argument("--out", type=Path, default=REPO_ROOT / "model")
    p.add_argument("--cache-dir", type=Path, default=REPO_ROOT / ".cache")
    p.add_argument("--models", default="baseline_cnn,efficientnet_b0", help="Comma-separated candidates to compare")
    p.add_argument("--img-size", type=int, default=224)
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--baseline-epochs", type=int, default=25)
    p.add_argument("--head-epochs", type=int, default=8)
    p.add_argument("--finetune-epochs", type=int, default=12)
    p.add_argument("--finetune-layers", type=int, default=40)
    p.add_argument("--finetune-lr", type=float, default=5e-5)
    p.add_argument("--patience", type=int, default=4)
    p.add_argument("--val-fraction", type=float, default=0.15)
    p.add_argument("--near-dup-distance", type=int, default=12, help="Max Hamming distance (of 256 bits) for near-duplicates")
    p.add_argument("--target-accuracy", type=float, default=0.97, help="Selective accuracy the review threshold aims for on validation")
    p.add_argument("--ood-quantile", type=float, default=0.99, help="Validation quantile used as the atypical-input limit")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--deterministic", action="store_true", help="Enable TensorFlow op determinism (slower)")
    p.add_argument("--quick", action="store_true", help="Small subset and few epochs to check the pipeline. Metrics are NOT meaningful.")
    return p.parse_args(argv)


# --------------------------------------------------------------- tf helpers
def to_model_input(images_u8: np.ndarray) -> np.ndarray:
    """Same tensor layout as backend.app.preprocessing.to_model_batch, for many images."""
    return np.repeat(images_u8[..., None].astype(np.float32), MODEL_CHANNELS, axis=-1)


def make_dataset(tf, images_u8, labels, batch_size, training, seed, augmenter=None):
    ds = tf.data.Dataset.from_tensor_slices((images_u8, labels))
    if training:
        ds = ds.shuffle(len(labels), seed=seed, reshuffle_each_iteration=True)
    ds = ds.batch(batch_size)
    ds = ds.map(
        lambda x, y: (tf.repeat(tf.cast(x[..., None], tf.float32), MODEL_CHANNELS, axis=-1), y), num_parallel_calls=tf.data.AUTOTUNE
    )
    if training and augmenter is not None:
        ds = ds.map(lambda x, y: (augmenter(x, training=True), y), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.prefetch(tf.data.AUTOTUNE)


def predict_outputs(keras, model, images_u8: np.ndarray, batch: int = 64) -> tuple[np.ndarray, np.ndarray]:
    """Logits and embeddings for a set of prepared images, without augmentation."""
    infer = keras.Model(model.inputs[0], [model.get_layer("logits").output, model.get_layer("embedding").output])
    logits, embeds = [], []
    for start in range(0, len(images_u8), batch):
        lo, em = infer(to_model_input(images_u8[start : start + batch]), training=False)
        logits.append(np.asarray(lo, dtype=np.float64))
        embeds.append(np.asarray(em, dtype=np.float64))
    return np.concatenate(logits), np.concatenate(embeds)


def history_rows(history, phase: str, offset: int) -> list[dict]:
    h = history.history
    rows = []
    for i in range(len(h.get("loss", []))):
        rows.append(
            {
                "epoch": offset + i + 1,
                "phase": phase,
                "loss": float(h["loss"][i]),
                "accuracy": float(h["accuracy"][i]),
                "val_loss": float(h["val_loss"][i]),
                "val_accuracy": float(h["val_accuracy"][i]),
            }
        )
    return rows


def train_candidate(tf, keras, built, train_ds, val_ds, class_weight, args, ckpt_path: Path) -> list[dict]:
    from ml.models import set_backbone_trainable

    loss = keras.losses.SparseCategoricalCrossentropy()

    def callbacks():
        return [
            keras.callbacks.EarlyStopping(monitor="val_loss", patience=args.patience, restore_best_weights=True),
            keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.3, patience=2, min_lr=1e-6),
            keras.callbacks.ModelCheckpoint(str(ckpt_path), monitor="val_loss", save_best_only=True),
        ]

    rows: list[dict] = []
    model = built.model
    if built.backbone_layers:
        set_backbone_trainable(built, False)
        model.compile(optimizer=keras.optimizers.Adam(1e-3), loss=loss, metrics=["accuracy"])
        log(f"  phase 1: training the classification head ({args.head_epochs} epochs max, backbone frozen)")
        h = model.fit(
            train_ds, validation_data=val_ds, epochs=args.head_epochs, class_weight=class_weight, callbacks=callbacks(), verbose=2
        )
        rows += history_rows(h, "head", 0)
        set_backbone_trainable(built, True, last_n=args.finetune_layers)
        model.compile(optimizer=keras.optimizers.Adam(args.finetune_lr), loss=loss, metrics=["accuracy"])
        log(f"  phase 2: fine-tuning the top {args.finetune_layers} backbone layers ({args.finetune_epochs} epochs max)")
        h = model.fit(
            train_ds, validation_data=val_ds, epochs=args.finetune_epochs, class_weight=class_weight, callbacks=callbacks(), verbose=2
        )
        rows += history_rows(h, "fine-tune", len(rows))
    else:
        model.compile(optimizer=keras.optimizers.Adam(1e-3), loss=loss, metrics=["accuracy"])
        log(f"  training from scratch ({args.baseline_epochs} epochs max)")
        h = model.fit(
            train_ds, validation_data=val_ds, epochs=args.baseline_epochs, class_weight=class_weight, callbacks=callbacks(), verbose=2
        )
        rows += history_rows(h, "train", 0)
    return rows


def quick_subset(cache, per_class: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    keep = []
    for source, n in (("Training", per_class), ("Testing", max(10, per_class // 4))):
        for c in np.unique(cache.labels):
            idx = np.nonzero((cache.sources == source) & (cache.labels == c))[0]
            keep.extend(rng.choice(idx, size=min(n, len(idx)), replace=False).tolist())
    return np.sort(np.array(keep))


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------- main
def main(argv=None) -> int:
    args = parse_args(argv)
    if args.quick:
        args.baseline_epochs, args.head_epochs, args.finetune_epochs, args.patience = 2, 1, 1, 1

    log("Importing TensorFlow")
    import tensorflow as tf

    keras = tf.keras
    keras.utils.set_random_seed(args.seed)
    if args.deterministic:
        tf.config.experimental.enable_op_determinism()
    from ml.models import BUILDERS, augmentation

    candidates = [m.strip() for m in args.models.split(",") if m.strip()]
    unknown = [m for m in candidates if m not in BUILDERS]
    if unknown:
        raise SystemExit(f"Unknown model(s): {unknown}. Choose from {sorted(BUILDERS)}.")

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    (out / "candidates").mkdir(exist_ok=True)

    # 1. Data --------------------------------------------------------------
    log(f"Scanning {args.data_dir}")
    dataset = scan(args.data_dir)
    classes = class_info(dataset.class_ids)
    log(f"Classes (index order): {[c['id'] for c in classes]}")
    for source, counts in dataset.counts.items():
        log(f"  {source}: {counts}")
    cache = build_cache(dataset, args.data_dir, args.img_size, args.cache_dir / f"preprocessed_{args.img_size}.npz", log)

    if args.quick:
        sub = quick_subset(cache, 120, args.seed)
        from ml.dataset import Cache

        cache = Cache(*(getattr(cache, f)[sub] for f in ("images", "labels", "sources", "sha256", "dhash", "colourfulness", "paths")))
        log(f"QUICK MODE: using {len(sub)} images. Results only check that the pipeline runs.")

    log("Checking for duplicate and near-duplicate images across splits")
    leak = leakage_check(cache, args.near_dup_distance)
    for k, v in leak.summary.items():
        if k not in ("method", "note"):
            log(f"  {k}: {v}")

    pool_labels = cache.labels[leak.train_pool]
    tr_pos, va_pos = grouped_validation_split(pool_labels, leak.groups, args.val_fraction, args.seed)
    train_idx, val_idx, test_idx = leak.train_pool[tr_pos], leak.train_pool[va_pos], leak.test
    assert not set(leak.groups[tr_pos].tolist()) & set(leak.groups[va_pos].tolist()), "group leaked across train/val"
    n_classes = len(classes)

    def counts(idx):
        return {classes[c]["id"]: int(np.sum(cache.labels[idx] == c)) for c in range(n_classes)}

    split_counts = {"train": counts(train_idx), "validation": counts(val_idx), "test": counts(test_idx)}
    log(f"Split sizes: { {k: sum(v.values()) for k, v in split_counts.items()} }")
    (out / "split_manifest.json").write_text(
        json.dumps({k: cache.paths[v].tolist() for k, v in (("train", train_idx), ("validation", val_idx), ("test", test_idx))}, indent=1),
        encoding="utf-8",
    )

    y_train = cache.labels[train_idx]
    freq = np.bincount(y_train, minlength=n_classes)
    class_weight = {c: float(len(y_train) / (n_classes * max(freq[c], 1))) for c in range(n_classes)}
    log(f"Class weights (balanced): { {classes[c]['id']: round(w, 3) for c, w in class_weight.items()} }")

    train_ds = make_dataset(tf, cache.images[train_idx], y_train, args.batch_size, True, args.seed, augmentation(args.seed))
    val_ds = make_dataset(tf, cache.images[val_idx], cache.labels[val_idx], args.batch_size, False, args.seed)

    # 2. Train candidates and compare on validation -------------------------
    results = []
    for name in candidates:
        log(f"Training candidate: {name}")
        keras.backend.clear_session()
        keras.utils.set_random_seed(args.seed)
        built = BUILDERS[name](args.img_size, n_classes)
        start = time.time()
        rows = train_candidate(tf, keras, built, train_ds, val_ds, class_weight, args, out / "candidates" / f"{name}.ckpt.keras")
        seconds = time.time() - start
        path = out / "candidates" / f"{name}.keras"
        # Save an uncompiled copy so the file holds weights only, not optimizer state.
        clean = keras.models.clone_model(built.model)
        clean.set_weights(built.model.get_weights())
        clean.save(path)
        val_logits, _ = predict_outputs(keras, built.model, cache.images[val_idx])
        val_probs = softmax(val_logits)
        m = classification_metrics(cache.labels[val_idx], val_probs, classes)
        results.append(
            {
                "name": name,
                "architecture": built.architecture,
                "parameters": int(built.model.count_params()),
                "gradcam_layer": built.gradcam_layer,
                "epochs_trained": len(rows),
                "train_seconds": round(seconds, 1),
                "validation": {"accuracy": m["accuracy"], "macro_f1": m["macro_f1"], "nll": nll(val_probs, cache.labels[val_idx])},
                "history": rows,
                "path": path,
            }
        )
        log(f"  {name}: val accuracy {m['accuracy']:.4f}, val macro-F1 {m['macro_f1']:.4f}")

    results.sort(key=lambda r: (-r["validation"]["macro_f1"], r["validation"]["nll"]))
    chosen = results[0]
    log(f"Selected {chosen['name']} (highest validation macro-F1; ties broken by lower validation loss)")

    # 3. Reload the saved artifact so every later number describes the served file
    keras.backend.clear_session()
    model = keras.models.load_model(chosen["path"], compile=False)
    tr_logits, tr_emb = predict_outputs(keras, model, cache.images[train_idx])
    va_logits, va_emb = predict_outputs(keras, model, cache.images[val_idx])
    te_logits, te_emb = predict_outputs(keras, model, cache.images[test_idx])
    y_val, y_test = cache.labels[val_idx], cache.labels[test_idx]

    # 4. Calibration, review threshold and OOD limit: validation data only ----
    temperature = fit_temperature(va_logits, y_val)
    va_raw, va_cal = softmax(va_logits), softmax(va_logits, temperature)
    decision = select_review_threshold(va_cal, y_val, args.target_accuracy)
    log(
        f"Temperature {temperature:.3f}; review threshold {decision['review_threshold']:.3f} (validation coverage {decision['coverage']:.3f})"
    )

    means, precision = fit_mahalanobis(tr_emb, cache.labels[train_idx], n_classes)
    va_dist = mahalanobis_min(va_emb, means, precision)
    ood_threshold = float(np.quantile(va_dist, args.ood_quantile))
    np.savez(out / "ood_stats.npz", means=means.astype(np.float32), precision=precision.astype(np.float32))

    train_colour = cache.colourfulness[train_idx]
    colour_max = float(max(10.0, 2.0 * np.quantile(train_colour, 0.999)))

    # 5. Held-out test, used once ------------------------------------------
    te_raw, te_cal = softmax(te_logits), softmax(te_logits, temperature)
    test_metrics = classification_metrics(y_test, te_cal, classes)
    te_dist = mahalanobis_min(te_emb, means, precision)
    ece_raw_val, _ = reliability(va_raw, y_val)
    ece_cal_val, _ = reliability(va_cal, y_val)
    ece_raw_test, _ = reliability(te_raw, y_test)
    ece_cal_test, bins_test = reliability(te_cal, y_test)
    test_threshold = apply_threshold(te_cal, y_test, decision["review_threshold"])
    accepted = (te_cal.max(axis=1) >= decision["review_threshold"]) & (te_dist <= ood_threshold)
    accepted_metrics = classification_metrics(y_test[accepted], te_cal[accepted], classes) if accepted.any() else None
    wrong = np.nonzero(te_cal.argmax(axis=1) != y_test)[0]
    failures = [
        {
            "path": str(cache.paths[test_idx][i]),
            "true": classes[int(y_test[i])]["id"],
            "predicted": classes[int(te_cal[i].argmax())]["id"],
            "score": float(te_cal[i].max()),
            "would_be_flagged": bool(not accepted[i]),
        }
        for i in wrong[np.argsort(-te_cal[wrong].max(axis=1))][:40]
    ]
    log(f"TEST accuracy {test_metrics['accuracy']:.4f}, macro-F1 {test_metrics['macro_f1']:.4f} on {test_metrics['n']} images")

    # 6. Write artifacts ------------------------------------------------------
    best = out / "best_model.keras"
    shutil.copyfile(chosen["path"], best)
    digest = file_sha256(best)
    created = datetime.now(timezone.utc)
    version = f"{created:%Y.%m.%d}-{chosen['name']}-{digest[:8]}" + ("-quick" if args.quick else "")

    metadata = {
        "schema_version": 1,
        "model_version": version,
        "architecture": chosen["architecture"],
        "framework": f"tensorflow {tf.__version__} / keras {keras.__version__}",
        "created_at": created.isoformat(timespec="seconds"),
        "weights_file": best.name,
        "weights_sha256": digest,
        "logits_layer": "logits",
        "input": {"height": args.img_size, "width": args.img_size, "channels": MODEL_CHANNELS, "dtype": "float32", "value_range": [0, 255]},
        "preprocessing": {"id": PREPROCESSING_ID},
        "classes": classes,
        "calibration": {"method": "temperature", "temperature": temperature, "fitted_on": "validation split"},
        "decision": {
            "review_threshold": decision["review_threshold"],
            "selected_on": "validation",
            "target_selective_accuracy": args.target_accuracy,
            "validation_coverage": decision["coverage"],
            "validation_selective_accuracy": decision["selective_accuracy"],
        },
        "input_checks": {"colourfulness_max": colour_max, "derived_from": "max(10, 2 x 99.9th percentile of training-image colourfulness)"},
        "ood": {
            "method": "mahalanobis-embedding",
            "embedding_layer": "embedding",
            "threshold": ood_threshold,
            "stats_file": "ood_stats.npz",
            "fitted_on": "training split (means, covariance); validation split (limit)",
            "validation_flag_rate": float(np.mean(va_dist > ood_threshold)),
        },
        "explainability": {"method": "grad-cam", "layer": chosen["gradcam_layer"]},
        "dataset": {
            "name": DATASET_NAME,
            "source": DATASET_SOURCE,
            "notes": "2D JPEG slices; mixed planes and MRI sequences; no patient identifiers.",
        },
        "quick_run": bool(args.quick),
    }
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    evaluation = {
        "schema_version": 1,
        "model_version": version,
        "created_at": created.isoformat(timespec="seconds"),
        "quick_run": bool(args.quick),
        "dataset": {
            "name": DATASET_NAME,
            "source": DATASET_SOURCE,
            "classes": [c["id"] for c in classes],
            "folder_counts": dataset.counts,
            "split_counts": split_counts,
            "split_method": f"Testing folder = held-out test set. Validation = {args.val_fraction:.0%} of the remaining Training images, "
            "stratified by class and grouped by near-duplicate cluster (StratifiedGroupKFold).",
        },
        "leakage": leak.summary,
        "candidates": [{k: v for k, v in r.items() if k not in ("history", "path")} for r in results],
        "selected": chosen["name"],
        "selection_rule": "Highest validation macro-F1; ties broken by lower validation loss. The test set was not used for selection.",
        "history": chosen["history"],
        "calibration": {
            "method": "temperature scaling",
            "temperature": temperature,
            "validation_nll_before": nll(va_raw, y_val),
            "validation_nll_after": nll(va_cal, y_val),
            "validation_ece_before": ece_raw_val,
            "validation_ece_after": ece_cal_val,
            "test_ece_before": ece_raw_test,
            "test_ece_after": ece_cal_test,
            "test_reliability": bins_test,
        },
        "decision": {
            **decision,
            "test_coverage": test_threshold["coverage"],
            "test_selective_accuracy": test_threshold["selective_accuracy"],
            "test_accuracy_of_flagged": test_threshold["accuracy_of_flagged"],
            "test_flagged_count": test_threshold["flagged_count"],
        },
        "ood": {
            "threshold": ood_threshold,
            "validation_flag_rate": metadata["ood"]["validation_flag_rate"],
            "test_flag_rate": float(np.mean(te_dist > ood_threshold)),
            "note": "Measured only on in-distribution images (how often normal test slices are flagged). "
            "Detection of non-MRI or other-scanner images has not been measured.",
        },
        "test": test_metrics,
        "test_accepted_only": accepted_metrics,
        "test_failures": failures,
        "environment": {
            "python": platform.python_version(),
            "tensorflow": tf.__version__,
            "numpy": np.__version__,
            "platform": platform.platform(),
        },
        "config": {k: (str(v) if isinstance(v, Path) else v) for k, v in vars(args).items() if k not in ("data_dir", "out", "cache_dir")},
    }
    (out / "evaluation.json").write_text(json.dumps(evaluation, indent=2), encoding="utf-8")

    # 7. Serve the artifacts through the real backend and compare --------------
    log("Verifying the saved model through the backend inference service")
    consistency = serving_check(out, args.data_dir, cache.paths[test_idx][:24], te_cal[:24], temperature)
    evaluation["serving_consistency"] = consistency
    (out / "evaluation.json").write_text(json.dumps(evaluation, indent=2), encoding="utf-8")
    log(f"Serving check: {consistency['summary']}")
    if not consistency["passed"]:
        log("WARNING: backend results differ from the evaluation pipeline. Investigate before using this model.")
        return 1
    log(f"Done. Model version {version}. Restart the backend (or use 'Reload model' in About) to serve it.")
    return 0


def serving_check(model_dir: Path, data_dir: Path, rel_paths, expected_probs: np.ndarray, temperature: float) -> dict:
    """Load the artifacts with the backend's readiness gate and run raw test files
    through the exact upload path (decode -> preprocess -> model)."""
    from backend.app.inference import InferenceService
    from backend.app.validation import decode_upload

    service = InferenceService(model_dir)
    readiness = service.load()
    if not readiness.ready:
        return {"passed": False, "summary": f"backend readiness failed: {readiness.first_failure()}", "checked": 0}
    max_diff = 0.0
    for rel, expected in zip(rel_paths, expected_probs):
        data = (Path(data_dir) / rel).read_bytes()
        image = decode_upload(data, max_bytes=50 * 1024 * 1024, max_pixels=40_000_000, max_side=8192, min_side=16)
        result = service.analyze(image, explain=False, client_request_id=None)
        got = np.array([s.score for s in result.scores])
        max_diff = max(max_diff, float(np.max(np.abs(got - expected))))
    passed = max_diff < 1e-4
    return {
        "passed": passed,
        "checked": len(rel_paths),
        "max_abs_score_difference": max_diff,
        "summary": f"{len(rel_paths)} test files analysed through the API code path; max score difference {max_diff:.2e}",
    }


if __name__ == "__main__":
    sys.exit(main())
