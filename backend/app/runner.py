"""Model execution. This is the only backend module that imports TensorFlow.

``ModelRunner`` is the interface the inference service depends on. The real
implementation is ``KerasRunner``. Software tests provide their own runner from
``backend/tests``; the application never constructs anything except
``KerasRunner``, so there is no fallback path that could produce a prediction
without the trained model.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol

import numpy as np


@dataclass(frozen=True)
class RunnerOutput:
    logits: np.ndarray  # (batch, n_classes)
    embeddings: Optional[np.ndarray]  # (batch, dim) or None


class ModelRunner(Protocol):
    input_shape: tuple[int, int, int]
    output_size: int
    gradcam_layer: Optional[str]

    def predict(self, batch: np.ndarray) -> RunnerOutput: ...

    def gradcam(self, batch: np.ndarray, class_index: int) -> Optional[np.ndarray]: ...


class RunnerLoadError(Exception):
    """Raised with a short, path-free explanation when a model cannot be loaded."""


class KerasRunner:
    def __init__(self, model_path: Path, logits_layer: str, embedding_layer: Optional[str], gradcam_layer: Optional[str]):
        try:
            import tensorflow as tf  # noqa: F401  (imported lazily: heavy, optional in tests)
        except Exception as exc:  # pragma: no cover - depends on local install
            raise RunnerLoadError("TensorFlow is not installed in this Python environment.") from exc

        import tensorflow as tf

        self._tf = tf
        keras = tf.keras
        try:
            model = keras.models.load_model(str(model_path), compile=False)
        except Exception as exc:  # pragma: no cover - depends on artifact
            raise RunnerLoadError("The model file exists but could not be loaded by Keras.") from exc

        try:
            logits_tensor = model.get_layer(logits_layer).output
        except ValueError as exc:
            raise RunnerLoadError(f"The model has no layer named '{logits_layer}'.") from exc

        outputs = [logits_tensor]
        self._has_embedding = False
        if embedding_layer:
            try:
                outputs.append(model.get_layer(embedding_layer).output)
                self._has_embedding = True
            except ValueError:
                self._has_embedding = False
        self._model = model
        self._infer = keras.Model(model.inputs[0], outputs)

        self.gradcam_layer: Optional[str] = None
        self._grad_model = None
        if gradcam_layer:
            try:
                conv = model.get_layer(gradcam_layer).output
                self._grad_model = keras.Model(model.inputs[0], [conv, logits_tensor])
                self.gradcam_layer = gradcam_layer
            except ValueError:
                self._grad_model = None

        shape = tuple(int(d) for d in model.inputs[0].shape[1:])
        if len(shape) != 3:
            raise RunnerLoadError("The model input is not a single image tensor.")
        self.input_shape = shape  # type: ignore[assignment]
        self.output_size = int(logits_tensor.shape[-1])
        self._lock = threading.Lock()

    def predict(self, batch: np.ndarray) -> RunnerOutput:
        with self._lock:
            result = self._infer(batch, training=False)
        if not isinstance(result, (list, tuple)):
            result = [result]
        logits = np.asarray(result[0], dtype=np.float64)
        embeddings = np.asarray(result[1], dtype=np.float64) if self._has_embedding and len(result) > 1 else None
        return RunnerOutput(logits=logits, embeddings=embeddings)

    def gradcam(self, batch: np.ndarray, class_index: int) -> Optional[np.ndarray]:
        """Grad-CAM (Selvaraju et al., 2017) for one class, on the logit (pre-softmax)."""
        if self._grad_model is None:
            return None
        tf = self._tf
        x = tf.convert_to_tensor(batch)
        with self._lock:
            with tf.GradientTape() as tape:
                conv, logits = self._grad_model(x, training=False)
                score = logits[:, class_index]
            grads = tape.gradient(score, conv)
        if grads is None:
            return None
        weights = tf.reduce_mean(grads, axis=(1, 2))  # (1, channels)
        cam = tf.reduce_sum(conv * weights[:, None, None, :], axis=-1)[0]
        cam = tf.nn.relu(cam).numpy().astype(np.float64)
        peak = float(cam.max())
        if not np.isfinite(peak) or peak <= 1e-12:
            return None
        return cam / peak


def load_keras_runner(model_path: Path, logits_layer: str, embedding_layer: Optional[str], gradcam_layer: Optional[str]) -> KerasRunner:
    return KerasRunner(model_path, logits_layer, embedding_layer, gradcam_layer)
