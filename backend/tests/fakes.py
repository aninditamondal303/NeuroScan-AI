"""Test doubles for software tests only.

These runners produce whatever logits a test asks for. They exist to check how
the service and API *handle* model outputs (mapping, thresholds, error paths).
They say nothing about model accuracy and are never imported by the app.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from backend.app.preprocessing import PREPROCESSING_ID
from backend.app.runner import RunnerOutput

CLASSES = [
    {"id": "glioma", "label": "Glioma", "index": 0, "is_tumour": True},
    {"id": "meningioma", "label": "Meningioma", "index": 1, "is_tumour": True},
    {"id": "notumor", "label": "No tumour", "index": 2, "is_tumour": False},
    {"id": "pituitary", "label": "Pituitary", "index": 3, "is_tumour": True},
]
EMBED_DIM = 8


def make_metadata(**overrides) -> dict:
    meta = {
        "schema_version": 1,
        "model_version": "test-0.0.1",
        "architecture": "test-double",
        "framework": "none (software test double)",
        "created_at": "2026-01-01T00:00:00+00:00",
        "weights_file": "best_model.keras",
        "logits_layer": "logits",
        "input": {"height": 32, "width": 32, "channels": 3, "dtype": "float32", "value_range": [0, 255]},
        "preprocessing": {"id": PREPROCESSING_ID},
        "classes": CLASSES,
        "calibration": {"method": "temperature", "temperature": 1.0, "fitted_on": "validation"},
        "decision": {
            "review_threshold": 0.6,
            "selected_on": "validation",
            "target_selective_accuracy": 0.95,
            "validation_coverage": 0.9,
            "validation_selective_accuracy": 0.95,
        },
        "input_checks": {"colourfulness_max": 15.0, "derived_from": "test"},
        "ood": {
            "method": "mahalanobis-embedding",
            "embedding_layer": "embedding",
            "threshold": 10.0,
            "stats_file": "ood_stats.npz",
            "fitted_on": "training",
            "validation_flag_rate": 0.01,
        },
        "explainability": {"method": "grad-cam", "layer": "last_conv"},
        "dataset": {"name": "test", "source": "synthetic"},
    }
    meta.update(overrides)
    return meta


def write_model_dir(model_dir: Path, meta: Optional[dict] = None, *, weights: bool = True, ood: bool = True) -> dict:
    model_dir.mkdir(parents=True, exist_ok=True)
    meta = meta if meta is not None else make_metadata()
    (model_dir / "metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    if weights:
        (model_dir / meta["weights_file"]).write_bytes(b"not-a-real-model")
    if ood and meta.get("ood"):
        np.savez(model_dir / meta["ood"]["stats_file"], means=np.zeros((len(meta["classes"]), EMBED_DIM)), precision=np.eye(EMBED_DIM))
    return meta


class FakeRunner:
    """Configurable runner. ``logits_fn`` maps a batch to logits."""

    def __init__(
        self,
        logits_fn: Callable[[np.ndarray], np.ndarray] | None = None,
        *,
        input_shape=(32, 32, 3),
        output_size: int = 4,
        embedding_fn: Callable[[np.ndarray], np.ndarray] | None = None,
        gradcam_layer: Optional[str] = "last_conv",
        gradcam_fn: Callable[[np.ndarray, int], Optional[np.ndarray]] | None = None,
    ):
        self.logits_fn = logits_fn or (lambda b: np.tile(np.array([4.0, 0.0, 0.0, 0.0]), (b.shape[0], 1)))
        self.embedding_fn = embedding_fn or (lambda b: np.zeros((b.shape[0], EMBED_DIM)))
        self.input_shape = input_shape
        self.output_size = output_size
        self.gradcam_layer = gradcam_layer
        self.gradcam_fn = gradcam_fn or (lambda b, i: np.outer(np.hanning(7), np.hanning(7)))
        self.calls: list[np.ndarray] = []

    def predict(self, batch: np.ndarray) -> RunnerOutput:
        self.calls.append(batch.copy())
        return RunnerOutput(logits=np.asarray(self.logits_fn(batch), dtype=np.float64), embeddings=self.embedding_fn(batch))

    def gradcam(self, batch: np.ndarray, class_index: int) -> Optional[np.ndarray]:
        return self.gradcam_fn(batch, class_index)


def factory(runner: FakeRunner):
    return lambda model_dir, meta: runner
