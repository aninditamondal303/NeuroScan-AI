"""Metric, calibration, threshold and OOD maths, checked against independent references."""

from __future__ import annotations

import numpy as np
import pytest
from sklearn.metrics import confusion_matrix as sk_confusion
from sklearn.metrics import f1_score, precision_recall_fscore_support

from ml.evaluation import (
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

CLASSES = [
    {"id": "glioma", "label": "Glioma", "is_tumour": True},
    {"id": "meningioma", "label": "Meningioma", "is_tumour": True},
    {"id": "notumor", "label": "No tumour", "is_tumour": False},
    {"id": "pituitary", "label": "Pituitary", "is_tumour": True},
]


def random_predictions(n=400, seed=0):
    rng = np.random.default_rng(seed)
    labels = rng.integers(0, 4, n)
    logits = rng.normal(0, 1, (n, 4))
    logits[np.arange(n), labels] += 2.0  # informative but imperfect
    return labels, logits


def test_metrics_match_scikit_learn():
    labels, logits = random_predictions()
    probs = softmax(logits)
    preds = probs.argmax(axis=1)
    m = classification_metrics(labels, probs, CLASSES)
    np.testing.assert_array_equal(np.array(m["confusion_matrix"]["matrix"]), sk_confusion(labels, preds, labels=[0, 1, 2, 3]))
    p, r, f, s = precision_recall_fscore_support(labels, preds, labels=[0, 1, 2, 3], zero_division=0)
    for i, row in enumerate(m["per_class"]):
        assert row["precision"] == pytest.approx(p[i]) and row["recall"] == pytest.approx(r[i])
        assert row["f1"] == pytest.approx(f[i]) and row["support"] == s[i]
    assert m["macro_f1"] == pytest.approx(f1_score(labels, preds, average="macro"))
    assert m["accuracy"] == pytest.approx(np.mean(preds == labels))


def test_tumour_binary_sensitivity_specificity():
    labels = np.array([0, 1, 3, 2, 2, 2])
    preds = np.array([0, 2, 3, 2, 2, 1])  # one tumour missed, one false alarm
    probs = np.eye(4)[preds]
    b = classification_metrics(labels, probs, CLASSES)["tumour_vs_no_tumour"]
    assert (b["tp"], b["fn"], b["tn"], b["fp"]) == (2, 1, 2, 1)
    assert b["sensitivity"] == pytest.approx(2 / 3) and b["specificity"] == pytest.approx(2 / 3)


def test_temperature_scaling_recovers_known_temperature():
    rng = np.random.default_rng(3)
    n = 20000
    true_logits = rng.normal(0, 2, (n, 4))
    labels = np.array([rng.choice(4, p=p) for p in softmax(true_logits)])
    overconfident = true_logits * 2.5  # a model whose logits are 2.5x too large
    t = fit_temperature(overconfident, labels)
    assert t == pytest.approx(2.5, rel=0.08)
    assert nll(softmax(overconfident, t), labels) < nll(softmax(overconfident), labels)


def test_reliability_perfect_calibration_has_low_ece():
    rng = np.random.default_rng(4)
    logits = rng.normal(0, 2, (20000, 4))
    probs = softmax(logits)
    labels = np.array([rng.choice(4, p=p) for p in probs])
    ece, bins = reliability(probs, labels)
    assert ece < 0.02
    assert sum(b["count"] for b in bins) == len(labels)


def test_threshold_reaches_target_on_validation():
    labels, logits = random_predictions(2000, seed=5)
    probs = softmax(logits)
    d = select_review_threshold(probs, labels, target_accuracy=0.9)
    assert d["target_met"] is True
    assert d["selective_accuracy"] >= 0.9
    assert 1 / 4 < d["review_threshold"] < 1
    check = apply_threshold(probs, labels, d["review_threshold"])
    assert check["coverage"] == pytest.approx(d["coverage"])


def test_threshold_reports_when_target_is_unreachable():
    rng = np.random.default_rng(6)
    labels = rng.integers(0, 4, 500)
    probs = softmax(rng.normal(0, 1, (500, 4)))  # uninformative model
    d = select_review_threshold(probs, labels, target_accuracy=0.99)
    assert d["target_met"] is False
    assert d["coverage"] >= 0.5


def test_mahalanobis_flags_far_embeddings():
    rng = np.random.default_rng(7)
    labels = rng.integers(0, 3, 600)
    centres = np.array([[0, 0, 0, 0], [5, 0, 0, 0], [0, 5, 0, 0]], dtype=float)
    emb = centres[labels] + rng.normal(0, 1, (600, 4))
    means, precision = fit_mahalanobis(emb, labels, 3)
    near = mahalanobis_min(centres + 0.1, means, precision)
    far = mahalanobis_min(np.array([[30.0, 30, 30, 30]]), means, precision)
    assert near.max() < 1.0 and far[0] > 10
