"""Inference service: readiness gate, prediction, uncertainty and result states.

Result states
-------------
* ``classified``   valid output, every reliability check passed.
* ``inconclusive`` valid output, but at least one check failed (low score, colour
                   image, atypical features). No class is reported.
* error            the API raises ``ApiError`` (model unavailable, invalid
                   output, rejected input). Nothing is stored or displayed as a
                   result.
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import numpy as np
from pydantic import ValidationError

from .errors import ApiError, model_unavailable
from .explain import heatmap_overlay_png
from .metadata import ModelMetadata
from .preprocessing import prepare_slice, to_model_batch
from .runner import ModelRunner, RunnerLoadError, load_keras_runner
from .schemas import (
    AnalysisResult,
    ClassScore,
    Explanation,
    ImageInfo,
    ModelRef,
    Notice,
    Prediction,
    ReadinessCheck,
    Timing,
    Uncertainty,
)
from .validation import DecodedImage

logger = logging.getLogger("neuroscan.inference")

RunnerFactory = Callable[[Path, ModelMetadata], ModelRunner]

GRADCAM_NOTE = (
    "Grad-CAM shows which regions most increased the model's score for the predicted class. "
    "It is not a tumour outline and does not establish where, or whether, a tumour is present."
)


def default_runner_factory(model_dir: Path, meta: ModelMetadata) -> ModelRunner:
    return load_keras_runner(
        model_dir / meta.weights_file,
        logits_layer=meta.logits_layer,
        embedding_layer=meta.ood.embedding_layer if meta.ood else None,
        gradcam_layer=meta.explainability.layer if meta.explainability else None,
    )


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = logits / temperature
    z = z - np.max(z, axis=-1, keepdims=True)
    e = np.exp(z)
    return e / np.sum(e, axis=-1, keepdims=True)


@dataclass
class OODStats:
    means: np.ndarray  # (n_classes, dim)
    precision: np.ndarray  # (dim, dim)

    def distance(self, embedding: np.ndarray) -> float:
        diffs = self.means - embedding[None, :]
        d2 = np.einsum("kd,de,ke->k", diffs, self.precision, diffs)
        return float(np.sqrt(max(float(np.min(d2)), 0.0)))


@dataclass
class Readiness:
    ready: bool = False
    checks: list[ReadinessCheck] = field(default_factory=list)
    loaded_at: Optional[str] = None

    def first_failure(self) -> str:
        for c in self.checks:
            if not c.passed:
                return f"{c.label}: {c.detail}"
        return "The model has not been loaded."


class InferenceService:
    def __init__(self, model_dir: Path, runner_factory: RunnerFactory = default_runner_factory):
        self.model_dir = model_dir
        self.runner_factory = runner_factory
        self.meta: Optional[ModelMetadata] = None
        self.runner: Optional[ModelRunner] = None
        self.ood: Optional[OODStats] = None
        self.readiness = Readiness()

    # ------------------------------------------------------------------ loading
    def load(self) -> Readiness:
        checks: list[ReadinessCheck] = []
        self.meta, self.runner, self.ood = None, None, None

        def add(check_id: str, label: str, passed: bool, detail: str) -> bool:
            checks.append(ReadinessCheck(id=check_id, label=label, passed=passed, detail=detail))
            return passed

        def finish() -> Readiness:
            ready = bool(checks) and all(c.passed for c in checks)
            self.readiness = Readiness(
                ready=ready,
                checks=checks,
                loaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds") if ready else None,
            )
            if not ready:
                self.runner = None
                logger.warning("Model not ready: %s", self.readiness.first_failure())
            else:
                logger.info("Model %s ready", self.meta.model_version if self.meta else "?")
            return self.readiness

        meta_path = self.model_dir / "metadata.json"
        if not add(
            "metadata_file",
            "Model metadata file",
            meta_path.is_file(),
            "Found model/metadata.json." if meta_path.is_file() else "model/metadata.json was not found. Train a model with ml/train.py.",
        ):
            return finish()

        try:
            meta = ModelMetadata.model_validate(json.loads(meta_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, ValidationError, UnicodeDecodeError) as exc:
            detail = (
                "metadata.json is not valid JSON."
                if isinstance(exc, json.JSONDecodeError)
                else "metadata.json does not match the expected schema."
            )
            if isinstance(exc, ValidationError):
                first = exc.errors()[0]
                detail += f" First problem: {'.'.join(str(p) for p in first['loc'])}: {first['msg']}."
            add("metadata_valid", "Model metadata contents", False, detail)
            return finish()
        add("metadata_valid", "Model metadata contents", True, f"Model version {meta.model_version}, {len(meta.classes)} classes.")

        weights = self.model_dir / meta.weights_file
        if not add(
            "weights_file",
            "Model weights file",
            weights.is_file(),
            f"Found model/{meta.weights_file}." if weights.is_file() else f"model/{meta.weights_file} was not found.",
        ):
            return finish()

        if meta.weights_sha256:
            digest = hashlib.sha256()
            with open(weights, "rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    digest.update(chunk)
            matches = digest.hexdigest() == meta.weights_sha256
            if not add(
                "weights_integrity",
                "Weights match metadata",
                matches,
                "SHA-256 of the weights file matches metadata.json."
                if matches
                else "The weights file does not match the SHA-256 recorded at training time. It may have been replaced or corrupted.",
            ):
                return finish()

        try:
            runner = self.runner_factory(self.model_dir, meta)
        except RunnerLoadError as exc:
            add("model_loaded", "Model loads", False, str(exc))
            return finish()
        except Exception:  # pragma: no cover - defensive
            logger.exception("Unexpected error while loading the model")
            add("model_loaded", "Model loads", False, "The model could not be loaded.")
            return finish()
        add("model_loaded", "Model loads", True, f"Loaded {meta.architecture}.")

        expected_shape = (meta.input.height, meta.input.width, meta.input.channels)
        if not add(
            "input_shape",
            "Input shape matches metadata",
            tuple(runner.input_shape) == expected_shape,
            f"Model expects {tuple(runner.input_shape)}, metadata declares {expected_shape}.",
        ):
            return finish()

        if not add(
            "output_classes",
            "Output size matches class list",
            runner.output_size == len(meta.classes),
            f"Model outputs {runner.output_size} scores; metadata lists {len(meta.classes)} classes "
            f"({', '.join(c.id for c in meta.classes)}).",
        ):
            return finish()

        ood: Optional[OODStats] = None
        if meta.ood is not None:
            try:
                with np.load(self.model_dir / meta.ood.stats_file) as data:
                    ood = OODStats(
                        means=np.asarray(data["means"], dtype=np.float64), precision=np.asarray(data["precision"], dtype=np.float64)
                    )
                ok = ood.means.shape[0] == len(meta.classes) and ood.precision.shape == (ood.means.shape[1], ood.means.shape[1])
                detail = (
                    f"Loaded statistics for a {ood.means.shape[1]}-dimensional embedding."
                    if ok
                    else "Statistics file has unexpected shapes."
                )
            except (OSError, KeyError, ValueError):
                ok, detail = False, f"model/{meta.ood.stats_file} is missing or unreadable."
            if not add("ood_stats", "Atypical-input detector", ok, detail):
                return finish()

        # Smoke test on a deterministic synthetic ramp: checks the full numeric path.
        ramp = np.tile(np.linspace(0, 255, meta.input.width, dtype=np.float32), (meta.input.height, 1))
        batch = np.repeat(ramp[None, :, :, None], meta.input.channels, axis=-1).astype(np.float32)
        try:
            out = runner.predict(batch)
            logits = np.asarray(out.logits)
            ok = logits.shape == (1, len(meta.classes)) and bool(np.all(np.isfinite(logits)))
            if ok and ood is not None:
                ok = (
                    out.embeddings is not None
                    and out.embeddings.shape == (1, ood.means.shape[1])
                    and bool(np.all(np.isfinite(out.embeddings)))
                )
            detail = (
                "Synthetic input produced finite scores of the expected shape."
                if ok
                else f"Unexpected output shape {logits.shape} or non-finite values."
            )
        except Exception:
            logger.exception("Smoke test failed")
            ok, detail = False, "Running the model on a synthetic input raised an error."
        if not add("smoke_test", "Inference smoke test", ok, detail):
            return finish()

        self.meta, self.runner, self.ood = meta, runner, ood
        return finish()

    # ---------------------------------------------------------------- analysis
    def analyze(self, image: DecodedImage, *, explain: bool, client_request_id: Optional[str]) -> AnalysisResult:
        if not self.readiness.ready or self.runner is None or self.meta is None:
            raise model_unavailable(self.readiness.first_failure())
        meta, runner = self.meta, self.runner
        t0 = time.perf_counter()

        prepared, geometry = prepare_slice(image.gray, meta.input.height)
        batch = to_model_batch(prepared)
        t1 = time.perf_counter()

        try:
            out = runner.predict(batch)
        except Exception:
            logger.exception("Model execution failed")
            raise ApiError(
                500,
                "inference_failed",
                "The model failed while analysing this image.",
                "Try again. If it keeps failing, restart the backend.",
            ) from None
        t2 = time.perf_counter()

        logits = np.asarray(out.logits, dtype=np.float64)
        n = len(meta.classes)
        if logits.shape != (1, n) or not np.all(np.isfinite(logits)):
            logger.error("Invalid model output: shape=%s finite=%s", logits.shape, bool(np.all(np.isfinite(logits))))
            raise ApiError(
                500,
                "invalid_model_output",
                "The model returned an invalid output, so no result was produced.",
                "This points to a problem with the model files. Re-run training or check model/metadata.json.",
            )
        raw = softmax(logits[0])
        calibrated = softmax(logits[0], meta.calibration.temperature) if meta.calibration.method == "temperature" else raw

        order = np.argsort(calibrated)[::-1]
        top_i = int(order[0])
        top = float(calibrated[top_i])
        margin = float(calibrated[order[0]] - calibrated[order[1]])
        entropy = float(-np.sum(calibrated * np.log(np.clip(calibrated, 1e-12, 1.0))) / np.log(n))

        reasons: list[Notice] = []
        warnings: list[Notice] = [Notice(code="conversion", message=m) for m in image.notes]

        if image.colourfulness > meta.input_checks.colourfulness_max:
            reasons.append(
                Notice(
                    code="colour_image",
                    message="The image contains colour, but the training slices are greyscale. "
                    "It is probably not an MRI slice of the kind this model was trained on.",
                )
            )

        ood_distance: Optional[float] = None
        if meta.ood is not None and self.ood is not None:
            if out.embeddings is None or not np.all(np.isfinite(out.embeddings)):
                raise ApiError(500, "invalid_model_output", "The model returned an invalid output, so no result was produced.")
            ood_distance = self.ood.distance(np.asarray(out.embeddings[0], dtype=np.float64))
            if ood_distance > meta.ood.threshold:
                reasons.append(
                    Notice(
                        code="atypical_input",
                        message="The image's features are unlike those of the training slices "
                        f"(distance {ood_distance:.1f}, limit {meta.ood.threshold:.1f}). "
                        "It may not be a brain MRI slice of the supported kind.",
                    )
                )
        else:
            warnings.append(
                Notice(
                    code="ood_check_unavailable",
                    message="This model has no atypical-input detector, so unusual images are screened by colour only.",
                )
            )

        if top < meta.decision.review_threshold:
            reasons.append(
                Notice(
                    code="low_confidence",
                    message=f"The highest score ({top:.0%}) is below the review threshold "
                    f"({meta.decision.review_threshold:.0%}) chosen on validation data.",
                )
            )

        if abs(image.width - image.height) / max(image.width, image.height) > 0.05:
            warnings.append(
                Notice(code="letterboxed", message="The slice is not square, so it was padded with black to a square before analysis.")
            )

        status = "inconclusive" if reasons else "classified"
        top_class = meta.classes[top_i]
        prediction = (
            Prediction(class_id=top_class.id, label=top_class.label, is_tumour=top_class.is_tumour, score=top)
            if status == "classified"
            else None
        )

        explanation, t3 = self._explain(explain, status, batch, top_i, geometry), time.perf_counter()

        result = AnalysisResult(
            analysis_id=f"NS-{datetime.now(timezone.utc):%Y%m%d}-{secrets.token_hex(3).upper()}",
            client_request_id=client_request_id,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            status=status,
            prediction=prediction,
            scores=[
                ClassScore(
                    class_id=c.id,
                    label=c.label,
                    index=c.index,
                    is_tumour=c.is_tumour,
                    score=float(calibrated[c.index]),
                    raw_score=float(raw[c.index]),
                )
                for c in meta.classes
            ],
            uncertainty=Uncertainty(
                top_score=top,
                margin=margin,
                normalized_entropy=entropy,
                review_threshold=meta.decision.review_threshold,
                calibration=(
                    f"temperature scaling (T = {meta.calibration.temperature:.3f}, fitted on {meta.calibration.fitted_on})"
                    if meta.calibration.method == "temperature"
                    else "none"
                ),
                ood_distance=ood_distance,
                ood_threshold=meta.ood.threshold if meta.ood else None,
            ),
            reasons=reasons,
            warnings=warnings,
            image=ImageInfo(format=image.format, width=image.width, height=image.height, mode=image.mode, size_bytes=image.size_bytes),
            model=ModelRef(version=meta.model_version, architecture=meta.architecture),
            explanation=explanation[0],
            timing=Timing(
                decode_ms=0.0,
                inference_ms=round((t2 - t1) * 1000, 1),
                explanation_ms=round(explanation[1] * 1000, 1),
                total_ms=round((t3 - t0) * 1000, 1),
            ),
        )
        return result

    def _explain(self, requested: bool, status: str, batch: np.ndarray, class_index: int, geometry) -> tuple[Explanation, float]:
        assert self.meta is not None and self.runner is not None
        if not requested:
            return Explanation(status="not_requested", note="A heatmap was not requested."), 0.0
        if self.meta.explainability is None or self.runner.gradcam_layer is None:
            return (
                Explanation(
                    status="unavailable", note="This model does not expose a convolutional layer for Grad-CAM, so no heatmap is shown."
                ),
                0.0,
            )
        if status != "classified":
            return (
                Explanation(
                    status="not_applicable",
                    method="grad-cam",
                    note="No heatmap is produced for an inconclusive result because there is no prediction to explain.",
                ),
                0.0,
            )
        start = time.perf_counter()
        try:
            cam = self.runner.gradcam(batch, class_index)
            if cam is None:
                return (
                    Explanation(
                        status="failed", method="grad-cam", note="Grad-CAM found no region with a positive influence on this prediction."
                    ),
                    time.perf_counter() - start,
                )
            png, w, h = heatmap_overlay_png(cam, geometry, self.meta.input.height)
        except Exception:
            logger.exception("Grad-CAM failed")
            return (
                Explanation(
                    status="failed", method="grad-cam", note="The heatmap could not be computed. The classification itself is unaffected."
                ),
                time.perf_counter() - start,
            )
        return (
            Explanation(
                status="available",
                method="grad-cam",
                target_class_id=self.meta.classes[class_index].id,
                layer=self.runner.gradcam_layer,
                overlay_png=png,
                width=w,
                height=h,
                note=GRADCAM_NOTE,
            ),
            time.perf_counter() - start,
        )
