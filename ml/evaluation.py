"""Evaluation maths with numpy only: metrics, calibration, thresholds, OOD.

Every number the app displays about model quality is computed here from real
predictions on real images.
"""

from __future__ import annotations

import numpy as np


# ----------------------------------------------------------------- basics
def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = np.asarray(logits, dtype=np.float64) / temperature
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def nll(probs: np.ndarray, labels: np.ndarray) -> float:
    return float(-np.mean(np.log(np.clip(probs[np.arange(len(labels)), labels], 1e-12, 1.0))))


def confusion_matrix(labels: np.ndarray, preds: np.ndarray, n_classes: int) -> np.ndarray:
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    np.add.at(cm, (labels, preds), 1)
    return cm  # rows = true class, columns = predicted class


def classification_metrics(labels: np.ndarray, probs: np.ndarray, classes: list[dict]) -> dict:
    n = len(classes)
    preds = probs.argmax(axis=1)
    cm = confusion_matrix(labels, preds, n)
    total = cm.sum()
    per_class = []
    recalls = []
    f1s = []
    for c in range(n):
        tp = cm[c, c]
        fp = cm[:, c].sum() - tp
        fn = cm[c, :].sum() - tp
        tn = total - tp - fp - fn
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        specificity = tn / (tn + fp) if tn + fp else 0.0
        recalls.append(recall)
        f1s.append(f1)
        per_class.append(
            {
                "class_id": classes[c]["id"],
                "label": classes[c]["label"],
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1),
                "specificity": float(specificity),
                "support": int(cm[c, :].sum()),
            }
        )
    out = {
        "n": int(total),
        "accuracy": float(np.trace(cm) / total) if total else 0.0,
        "macro_f1": float(np.mean(f1s)),
        "balanced_accuracy": float(np.mean(recalls)),
        "per_class": per_class,
        "confusion_matrix": {
            "labels": [c["id"] for c in classes],
            "matrix": cm.tolist(),
            "rows": "true class",
            "columns": "predicted class",
        },
    }
    out["tumour_vs_no_tumour"] = tumour_binary(labels, preds, classes)
    return out


def tumour_binary(labels: np.ndarray, preds: np.ndarray, classes: list[dict]) -> dict | None:
    """Collapse to 'any tumour class' vs 'no tumour' and report sensitivity/specificity."""
    tumour = np.array([c["is_tumour"] for c in classes])
    if tumour.all() or not tumour.any():
        return None
    y = tumour[labels]
    p = tumour[preds]
    tp = int(np.sum(y & p))
    fn = int(np.sum(y & ~p))
    tn = int(np.sum(~y & ~p))
    fp = int(np.sum(~y & p))
    return {
        "sensitivity": tp / (tp + fn) if tp + fn else 0.0,
        "specificity": tn / (tn + fp) if tn + fp else 0.0,
        "tp": tp,
        "fn": fn,
        "tn": tn,
        "fp": fp,
        "note": "Computed by treating glioma, meningioma and pituitary predictions as 'tumour' on the held-out test images.",
    }


# ------------------------------------------------------------ calibration
def fit_temperature(logits: np.ndarray, labels: np.ndarray, lo: float = 0.05, hi: float = 20.0, iters: int = 80) -> float:
    """Temperature scaling (Guo et al., 2017): minimise validation NLL over T
    with a golden-section search on log T. NLL(T) is unimodal in practice."""
    a, b = np.log(lo), np.log(hi)
    phi = (np.sqrt(5) - 1) / 2

    def f(log_t: float) -> float:
        return nll(softmax(logits, float(np.exp(log_t))), labels)

    c, d = b - phi * (b - a), a + phi * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - phi * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + phi * (b - a)
            fd = f(d)
    return float(np.exp((a + b) / 2))


def reliability(probs: np.ndarray, labels: np.ndarray, n_bins: int = 10) -> tuple[float, list[dict]]:
    """Expected calibration error and per-bin confidence/accuracy for the top class."""
    conf = probs.max(axis=1)
    correct = probs.argmax(axis=1) == labels
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins = []
    ece = 0.0
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (conf > lo) & (conf <= hi) if i else (conf >= lo) & (conf <= hi)
        count = int(mask.sum())
        if count:
            acc = float(correct[mask].mean())
            mean_conf = float(conf[mask].mean())
            ece += count / len(conf) * abs(acc - mean_conf)
        else:
            acc = mean_conf = None
        bins.append({"lower": float(lo), "upper": float(hi), "count": count, "confidence": mean_conf, "accuracy": acc})
    return float(ece), bins


# -------------------------------------------------------- review threshold
def select_review_threshold(probs: np.ndarray, labels: np.ndarray, target_accuracy: float, min_coverage: float = 0.5) -> dict:
    """Pick the lowest top-score threshold whose accepted validation predictions
    reach ``target_accuracy``; lower thresholds keep more images classified.

    If the target cannot be met with at least ``min_coverage`` of images kept,
    the threshold with the best selective accuracy at that coverage is used and
    ``target_met`` is false. The threshold is an engineering setting for when to
    ask for review, not a clinical safety guarantee."""
    n_classes = probs.shape[1]
    conf = probs.max(axis=1)
    correct = probs.argmax(axis=1) == labels
    order = np.argsort(-conf)
    conf_sorted = conf[order]
    cum_acc = np.cumsum(correct[order]) / np.arange(1, len(order) + 1)

    floor = 1.0 / n_classes + 1e-6
    chosen = None
    for k in range(len(order) - 1, -1, -1):  # largest coverage first
        if cum_acc[k] >= target_accuracy:
            chosen = k
            break
    target_met = chosen is not None and (chosen + 1) / len(order) >= min_coverage
    if not target_met:
        start = max(0, int(np.ceil(min_coverage * len(order))) - 1)
        chosen = start + int(np.argmax(cum_acc[start:]))
    threshold = float(min(max(conf_sorted[chosen], floor), 0.999))
    accepted = conf >= threshold
    return {
        "review_threshold": threshold,
        "target_selective_accuracy": float(target_accuracy),
        "target_met": bool(target_met),
        "coverage": float(accepted.mean()),
        "selective_accuracy": float(correct[accepted].mean()) if accepted.any() else None,
    }


def apply_threshold(probs: np.ndarray, labels: np.ndarray, threshold: float) -> dict:
    conf = probs.max(axis=1)
    correct = probs.argmax(axis=1) == labels
    accepted = conf >= threshold
    return {
        "coverage": float(accepted.mean()),
        "selective_accuracy": float(correct[accepted].mean()) if accepted.any() else None,
        "accuracy_of_flagged": float(correct[~accepted].mean()) if (~accepted).any() else None,
        "flagged_count": int((~accepted).sum()),
    }


# -------------------------------------------------------------------- OOD
def fit_mahalanobis(embeddings: np.ndarray, labels: np.ndarray, n_classes: int) -> tuple[np.ndarray, np.ndarray]:
    """Class means and a shared, shrinkage-regularised precision matrix
    (Lee et al., 2018, without input pre-processing)."""
    from sklearn.covariance import LedoitWolf

    means = np.stack([embeddings[labels == c].mean(axis=0) for c in range(n_classes)])
    centred = embeddings - means[labels]
    cov = LedoitWolf().fit(centred).covariance_
    precision = np.linalg.inv(cov)
    return means, precision


def mahalanobis_min(embeddings: np.ndarray, means: np.ndarray, precision: np.ndarray) -> np.ndarray:
    out = np.empty(len(embeddings))
    for i, e in enumerate(embeddings):
        d = means - e[None, :]
        out[i] = np.sqrt(max(float(np.min(np.einsum("kd,de,ke->k", d, precision, d))), 0.0))
    return out
