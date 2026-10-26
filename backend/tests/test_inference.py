"""InferenceService: readiness gate, class mapping, result states, explanations.

These use FakeRunner, so they test the service's handling of model outputs,
not the accuracy of any model."""

from __future__ import annotations

import base64
import io
import json

import numpy as np
import pytest
from PIL import Image

from backend.app.errors import ApiError
from backend.app.inference import InferenceService, softmax
from backend.app.runner import RunnerLoadError
from backend.app.validation import decode_upload

from .conftest import encode, phantom
from .fakes import CLASSES, FakeRunner, factory, make_metadata, write_model_dir

LIMITS = dict(max_bytes=10 * 1024 * 1024, max_pixels=40_000_000, max_side=8192, min_side=64)


def grey_image(width=120, height=100):
    return decode_upload(encode(phantom(width, height)), **LIMITS)


def ready_service(tmp_path, runner=None, meta=None) -> InferenceService:
    model_dir = tmp_path / "model"
    write_model_dir(model_dir, meta)
    service = InferenceService(model_dir, factory(runner or FakeRunner()))
    assert service.load().ready, service.readiness.first_failure()
    return service


def failed_check(service: InferenceService) -> str:
    return next(c.id for c in service.readiness.checks if not c.passed)


# ------------------------------------------------------------------ readiness
def test_not_ready_without_metadata(tmp_path):
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    assert not service.load().ready
    assert failed_check(service) == "metadata_file"
    with pytest.raises(ApiError) as err:
        service.analyze(grey_image(), explain=False, client_request_id=None)
    assert err.value.status_code == 503


def test_not_ready_with_invalid_json(tmp_path):
    (tmp_path / "model").mkdir()
    (tmp_path / "model" / "metadata.json").write_text("{not json", encoding="utf-8")
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    assert not service.load().ready and failed_check(service) == "metadata_valid"


@pytest.mark.parametrize(
    "overrides",
    [
        {"classes": [{**CLASSES[0], "index": 0}, {**CLASSES[1], "index": 2}]},  # gap in indices
        {"classes": [CLASSES[0], {**CLASSES[1], "id": "glioma"}]},  # duplicate id
        {"preprocessing": {"id": "something-else"}},
        {"model_version": ""},
        {"decision": {"review_threshold": 1.5, "selected_on": "validation", "target_selective_accuracy": 0.9, "validation_coverage": 0.5}},
    ],
)
def test_not_ready_when_metadata_is_inconsistent(tmp_path, overrides):
    write_model_dir(tmp_path / "model", make_metadata(**overrides))
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    assert not service.load().ready and failed_check(service) == "metadata_valid"


def test_not_ready_without_weights(tmp_path):
    write_model_dir(tmp_path / "model", weights=False)
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    assert not service.load().ready and failed_check(service) == "weights_file"


def test_not_ready_when_model_fails_to_load(tmp_path):
    write_model_dir(tmp_path / "model")

    def broken(model_dir, meta):
        raise RunnerLoadError("TensorFlow is not installed in this Python environment.")

    service = InferenceService(tmp_path / "model", broken)
    assert not service.load().ready and failed_check(service) == "model_loaded"
    assert "TensorFlow" in service.readiness.first_failure()


def test_not_ready_when_input_shape_differs(tmp_path):
    write_model_dir(tmp_path / "model")
    service = InferenceService(tmp_path / "model", factory(FakeRunner(input_shape=(64, 64, 3))))
    assert not service.load().ready and failed_check(service) == "input_shape"


def test_not_ready_when_output_size_differs_from_class_list(tmp_path):
    write_model_dir(tmp_path / "model")
    runner = FakeRunner(lambda b: np.zeros((b.shape[0], 3)), output_size=3)
    service = InferenceService(tmp_path / "model", factory(runner))
    assert not service.load().ready and failed_check(service) == "output_classes"


def test_not_ready_without_ood_statistics(tmp_path):
    write_model_dir(tmp_path / "model", ood=False)
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    assert not service.load().ready and failed_check(service) == "ood_stats"


def test_not_ready_when_smoke_test_returns_nan(tmp_path):
    write_model_dir(tmp_path / "model")
    runner = FakeRunner(lambda b: np.full((b.shape[0], 4), np.nan))
    service = InferenceService(tmp_path / "model", factory(runner))
    assert not service.load().ready and failed_check(service) == "smoke_test"


def test_readiness_details_contain_no_absolute_paths(tmp_path):
    service = InferenceService(tmp_path / "model", factory(FakeRunner()))
    service.load()
    assert all(str(tmp_path) not in c.detail for c in service.readiness.checks)


# ------------------------------------------------------------- classification
@pytest.mark.parametrize("index", [0, 1, 2, 3])
def test_output_index_maps_to_the_class_at_that_index(tmp_path, index):
    logits = np.zeros(4)
    logits[index] = 6.0
    service = ready_service(tmp_path, FakeRunner(lambda b: logits[None, :]))
    result = service.analyze(grey_image(), explain=False, client_request_id="r1")
    assert result.status == "classified"
    assert result.prediction is not None
    assert result.prediction.class_id == CLASSES[index]["id"]
    assert result.prediction.is_tumour == CLASSES[index]["is_tumour"]
    assert [s.class_id for s in result.scores] == [c["id"] for c in CLASSES]
    assert result.client_request_id == "r1"


def test_mapping_follows_metadata_not_alphabetical_order(tmp_path):
    shuffled = [
        {"id": "pituitary", "label": "Pituitary", "index": 0, "is_tumour": True},
        {"id": "notumor", "label": "No tumour", "index": 1, "is_tumour": False},
        {"id": "glioma", "label": "Glioma", "index": 2, "is_tumour": True},
        {"id": "meningioma", "label": "Meningioma", "index": 3, "is_tumour": True},
    ]
    service = ready_service(tmp_path, FakeRunner(lambda b: np.array([[0.0, 7.0, 0.0, 0.0]])), make_metadata(classes=shuffled))
    result = service.analyze(grey_image(), explain=False, client_request_id=None)
    assert result.prediction.class_id == "notumor" and result.prediction.is_tumour is False


def test_scores_are_calibrated_softmax_and_raw_scores_are_kept(tmp_path):
    logits = np.array([3.0, 1.0, 0.5, 0.0])
    meta = make_metadata(calibration={"method": "temperature", "temperature": 2.0, "fitted_on": "validation"})
    service = ready_service(tmp_path, FakeRunner(lambda b: logits[None, :]), meta)
    result = service.analyze(grey_image(), explain=False, client_request_id=None)
    np.testing.assert_allclose([s.score for s in result.scores], softmax(logits, 2.0), rtol=1e-9)
    np.testing.assert_allclose([s.raw_score for s in result.scores], softmax(logits), rtol=1e-9)
    assert abs(sum(s.score for s in result.scores) - 1.0) < 1e-9


def test_model_receives_preprocessed_batch_of_the_uploaded_image(tmp_path):
    runner = FakeRunner()
    service = ready_service(tmp_path, runner)
    image = grey_image()
    service.analyze(image, explain=False, client_request_id=None)
    batch = runner.calls[-1]
    assert batch.shape == (1, 32, 32, 3) and batch.dtype == np.float32
    from backend.app.preprocessing import prepare_slice, to_model_batch

    expected = to_model_batch(prepare_slice(image.gray, 32)[0])
    assert np.array_equal(batch, expected)


def test_repeated_inference_is_consistent(tmp_path):
    def logits_from_pixels(b):
        m = float(b.mean()) / 255.0
        return np.array([[m * 5, 1.0, 0.5, 0.2]])

    service = ready_service(tmp_path, FakeRunner(logits_from_pixels))
    image = grey_image()
    first = service.analyze(image, explain=False, client_request_id=None)
    for _ in range(5):
        again = service.analyze(image, explain=False, client_request_id=None)
        np.testing.assert_allclose([s.score for s in again.scores], [s.score for s in first.scores], atol=1e-12)
        assert again.analysis_id != first.analysis_id


# ---------------------------------------------------------------- inconclusive
def test_low_confidence_is_inconclusive_and_never_no_tumour(tmp_path):
    # notumor has the highest score but below the 0.6 review threshold
    service = ready_service(tmp_path, FakeRunner(lambda b: np.array([[0.0, 0.0, 0.6, 0.0]])))
    result = service.analyze(grey_image(), explain=True, client_request_id=None)
    assert result.status == "inconclusive"
    assert result.prediction is None
    assert [r.code for r in result.reasons] == ["low_confidence"]
    assert result.explanation.status == "not_applicable"


def test_colour_image_is_inconclusive(tmp_path):
    rng = np.random.default_rng(0)
    colour = decode_upload(encode(rng.integers(0, 255, (100, 120, 3), dtype=np.uint8)), **LIMITS)
    service = ready_service(tmp_path)
    result = service.analyze(colour, explain=False, client_request_id=None)
    assert result.status == "inconclusive" and "colour_image" in [r.code for r in result.reasons]


def test_atypical_embedding_is_inconclusive(tmp_path):
    runner = FakeRunner(embedding_fn=lambda b: np.full((1, 8), 50.0))
    service = ready_service(tmp_path, runner)
    result = service.analyze(grey_image(), explain=False, client_request_id=None)
    assert result.status == "inconclusive"
    assert "atypical_input" in [r.code for r in result.reasons]
    assert result.uncertainty.ood_distance == pytest.approx(np.sqrt(8 * 50.0**2))


def test_missing_ood_detector_is_disclosed_as_a_warning(tmp_path):
    service = ready_service(tmp_path, meta=make_metadata(ood=None))
    result = service.analyze(grey_image(), explain=False, client_request_id=None)
    assert result.status == "classified"
    assert "ood_check_unavailable" in [w.code for w in result.warnings]


# ---------------------------------------------------------------- bad outputs
@pytest.mark.parametrize(
    "bad",
    [
        lambda b: np.array([[np.nan, 0.0, 0.0, 0.0]]),
        lambda b: np.array([[np.inf, 0.0, 0.0, 0.0]]),
        lambda b: np.zeros((1, 3)),
        lambda b: np.zeros((2, 4)),
    ],
)
def test_invalid_model_output_never_produces_a_result(tmp_path, bad):
    runner = FakeRunner()
    service = ready_service(tmp_path, runner)
    runner.logits_fn = bad  # break the model after it passed the readiness gate
    with pytest.raises(ApiError) as err:
        service.analyze(grey_image(), explain=False, client_request_id=None)
    assert err.value.code == "invalid_model_output"


def test_runner_exception_becomes_safe_error(tmp_path):
    runner = FakeRunner()
    service = ready_service(tmp_path, runner)

    def explode(b):
        raise RuntimeError(f"failure in {tmp_path}/secret/path")

    runner.logits_fn = explode
    with pytest.raises(ApiError) as err:
        service.analyze(grey_image(), explain=False, client_request_id=None)
    assert err.value.code == "inference_failed"
    assert str(tmp_path) not in err.value.message + (err.value.hint or "")


# -------------------------------------------------------------- explanations
def test_gradcam_overlay_matches_original_aspect_ratio(tmp_path):
    service = ready_service(tmp_path)
    result = service.analyze(grey_image(200, 100), explain=True, client_request_id=None)
    exp = result.explanation
    assert exp.status == "available" and exp.method == "grad-cam"
    assert exp.target_class_id == result.prediction.class_id
    assert (exp.width, exp.height) == (200, 100)
    png = base64.b64decode(exp.overlay_png.split(",", 1)[1])
    with Image.open(io.BytesIO(png)) as img:
        assert img.mode == "RGBA" and img.size == (200, 100)


def test_gradcam_failure_does_not_break_classification(tmp_path):
    def broken(b, i):
        raise RuntimeError("boom")

    service = ready_service(tmp_path, FakeRunner(gradcam_fn=broken))
    result = service.analyze(grey_image(), explain=True, client_request_id=None)
    assert result.status == "classified"
    assert result.explanation.status == "failed" and result.explanation.overlay_png is None


def test_model_without_gradcam_layer_reports_unavailable(tmp_path):
    service = ready_service(tmp_path, FakeRunner(gradcam_layer=None))
    result = service.analyze(grey_image(), explain=True, client_request_id=None)
    assert result.explanation.status == "unavailable"


def test_flat_gradcam_map_reports_failure_instead_of_fake_heatmap(tmp_path):
    service = ready_service(tmp_path, FakeRunner(gradcam_fn=lambda b, i: None))
    result = service.analyze(grey_image(), explain=True, client_request_id=None)
    assert result.explanation.status == "failed" and result.explanation.overlay_png is None


def test_metadata_on_disk_is_never_mutated(tmp_path):
    service = ready_service(tmp_path)
    before = (tmp_path / "model" / "metadata.json").read_text(encoding="utf-8")
    service.analyze(grey_image(), explain=True, client_request_id=None)
    assert json.loads(before) == json.loads((tmp_path / "model" / "metadata.json").read_text(encoding="utf-8"))


def test_weights_integrity_check(tmp_path):
    import hashlib

    model_dir = tmp_path / "model"
    good = hashlib.sha256(b"not-a-real-model").hexdigest()
    write_model_dir(model_dir, make_metadata(weights_sha256=good))
    service = InferenceService(model_dir, factory(FakeRunner()))
    assert service.load().ready
    assert any(c.id == "weights_integrity" and c.passed for c in service.readiness.checks)

    (model_dir / "best_model.keras").write_bytes(b"tampered")
    assert not service.load().ready and failed_check(service) == "weights_integrity"
