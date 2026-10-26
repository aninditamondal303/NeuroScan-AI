"""Print a Markdown summary of model/evaluation.json for the README and model card.

    python -m ml.report_md                 # reads model/evaluation.json
    python -m ml.report_md path/to/evaluation.json

Every number comes from the evaluation file written by ml/train.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def pct(x: float) -> str:
    # Round half up (95.25 -> 95.3), matching the website's display.
    return f"{int(1000 * x + 0.5 + 1e-9) / 10:.1f}%"


def render(e: dict) -> str:
    t = e["test"]
    tb = t.get("tumour_vs_no_tumour") or {}
    d = e["decision"]
    leak = e["leakage"]
    cal = e["calibration"]
    sel = next(c for c in e["candidates"] if c["name"] == e["selected"])
    lines = [
        f"Model `{e['model_version']}` ({sel['architecture']}), evaluated once on the {t['n']} images of the dataset's `Testing` folder.",
        "",
        "| Metric (held-out test set) | Value |",
        "|---|---|",
        f"| Accuracy | {pct(t['accuracy'])} |",
        f"| Macro F1 | {t['macro_f1']:.3f} |",
        f"| Balanced accuracy | {pct(t['balanced_accuracy'])} |",
    ]
    if tb:
        lines += [
            f"| Tumour vs no tumour: sensitivity | {pct(tb['sensitivity'])} ({tb['fn']} of {tb['tp'] + tb['fn']} tumour images missed) |",
            f"| Tumour vs no tumour: specificity | {pct(tb['specificity'])} ({tb['fp']} of {tb['tn'] + tb['fp']} no-tumour images flagged) |",
        ]
    lines += [
        f"| Images classified at the review threshold ({d['review_threshold']:.3f}) | {pct(d['test_coverage'])} |",
        f"| Accuracy on those classified images | {pct(d['test_selective_accuracy'])} |",
        f"| Calibration error (ECE) after temperature scaling | {cal['test_ece_after']:.3f} |",
        "",
        "| Class | Precision | Recall | F1 | Specificity |",
        "|---|---|---|---|---|",
    ]
    for c in t["per_class"]:
        lines.append(f"| {c['label']} | {c['precision']:.3f} | {c['recall']:.3f} | {c['f1']:.3f} | {c['specificity']:.3f} |")
    lines += [
        "",
        "| Candidate (validation data) | Val. accuracy | Val. macro F1 | Parameters | Training time |",
        "|---|---|---|---|---|",
    ]
    for c in e["candidates"]:
        mark = " (selected)" if c["name"] == e["selected"] else ""
        lines.append(
            f"| {c['architecture']}{mark} | {c['validation']['accuracy']:.3f} | {c['validation']['macro_f1']:.3f} "
            f"| {c['parameters']:,} | {c['train_seconds'] / 60:.0f} min |"
        )
    lines += [
        "",
        f"Leakage control: {leak['training_removed_exact_match_in_test']} training images were exact copies of test images and "
        f"{leak['training_removed_near_match_in_test']} were near-duplicates (256-bit dHash, Hamming distance ≤ {leak['near_duplicate_max_distance']}); "
        f"all were removed before training, leaving {leak['training_pool_after_removal']} of {leak['training_images_scanned']} training images.",
    ]
    return "\n".join(lines)


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "model" / "evaluation.json"
    print(render(json.loads(path.read_text(encoding="utf-8"))))


if __name__ == "__main__":
    main()
