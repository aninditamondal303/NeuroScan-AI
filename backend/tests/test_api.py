"""HTTP API tests through FastAPI's TestClient (real routing, validation and
error handling; the model is a FakeRunner test double)."""

from __future__ import annotations

import json
import threading

import numpy as np
from fastapi.testclient import TestClient

from backend.app.main import create_app

from .conftest import encode, phantom
from .fakes import FakeRunner, factory, make_metadata, write_model_dir


def post_image(client: TestClient, data: bytes, name="slice.png", mime="image/png", **params):
    form = {"request_id": params.pop("request_id")} if "request_id" in params else None
    return client.post("/api/analyze", files={"file": (name, data, mime)}, data=form, params=params)


# ------------------------------------------------------------------ health
def test_health_reports_backend_and_model_separately(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["model_ready"] is True
    assert body["model_version"] == "test-0.0.1"


def test_health_when_model_missing(settings):
    app = create_app(settings, runner_factory=factory(FakeRunner()))
    with TestClient(app) as c:
        body = c.get("/api/health").json()
        assert body["status"] == "ok" and body["model_ready"] is False and body["model_version"] is None
        info = c.get("/api/model-info").json()
        assert info["ready"] is False and info["metadata"] is None
        assert info["checks"][0]["id"] == "metadata_file" and info["checks"][0]["passed"] is False


def test_model_info_exposes_classes_limits_and_no_paths(client, settings):
    res = client.get("/api/model-info")
    body = res.json()
    assert body["ready"] is True
    assert [c["id"] for c in body["metadata"]["classes"]] == ["glioma", "meningioma", "notumor", "pituitary"]
    assert body["limits"]["formats"] == ["JPEG", "PNG", "WEBP"]
    assert str(settings.model_dir) not in res.text


# ---------------------------------------------------------------- analysis
def test_analyze_valid_png_returns_structured_result(client, png_bytes):
    res = post_image(client, png_bytes, request_id="req-123")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "classified"
    assert body["prediction"]["class_id"] == "glioma"
    assert body["client_request_id"] == "req-123"
    assert len(body["scores"]) == 4 and abs(sum(s["score"] for s in body["scores"]) - 1) < 1e-9
    assert body["image"] == {"format": "PNG", "width": 120, "height": 100, "mode": "L", "size_bytes": len(png_bytes)}
    assert body["model"]["version"] == "test-0.0.1"
    assert body["explanation"]["status"] == "available"
    assert body["timing"]["total_ms"] >= body["timing"]["inference_ms"] >= 0


def test_analyze_jpeg_and_webp(client):
    for fmt, mime in (("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
        res = post_image(client, encode(phantom(), fmt), name="x", mime=mime)
        assert res.status_code == 200 and res.json()["image"]["format"] == fmt


def test_explain_can_be_switched_off(client, png_bytes):
    body = post_image(client, png_bytes, explain="false").json()
    assert body["explanation"]["status"] == "not_requested"


def test_backend_analyses_exact_uploaded_bytes(settings, png_bytes):
    runner = FakeRunner()
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(runner))) as c:
        a = encode(phantom(seed=1))
        b = encode(phantom(seed=2))
        post_image(c, a)
        post_image(c, b)
    # calls[0] is the readiness smoke test
    assert not np.array_equal(runner.calls[1], runner.calls[2])


def test_rejects_non_image(client):
    res = post_image(client, b"plain text pretending to be a scan", name="scan.png")
    assert res.status_code == 415 and res.json()["error"]["code"] == "unrecognised_file"


def test_rejects_corrupt_image(client):
    data = encode(phantom(200, 200), "JPEG")
    res = post_image(client, data[: len(data) // 3], mime="image/jpeg")
    assert res.status_code == 422 and res.json()["error"]["code"] == "corrupt_image"


def test_rejects_dicom(client):
    res = post_image(client, b"\x00" * 128 + b"DICM" + b"\x00" * 200, name="scan.dcm", mime="application/dicom")
    assert res.status_code == 415 and res.json()["error"]["code"] == "volumetric_format_not_supported"


def test_rejects_oversized_upload_by_content_length(client):
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (3 * 1024 * 1024)
    res = post_image(client, big)
    assert res.status_code == 413 and res.json()["error"]["code"] == "file_too_large"
    assert res.headers.get("access-control-allow-origin") is None  # no Origin header sent


def test_rejects_oversized_streamed_upload_without_content_length(client):
    def chunks():
        boundary = b"--xBOUNDARYx"
        yield boundary + b'\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'
        for _ in range(40):
            yield b"\x00" * (128 * 1024)
        yield b"\r\n" + boundary + b"--\r\n"

    res = client.post(
        "/api/analyze",
        content=chunks(),
        headers={"content-type": "multipart/form-data; boundary=xBOUNDARYx"},
    )
    assert res.status_code == 413 and res.json()["error"]["code"] == "file_too_large"


def test_413_carries_cors_header_for_the_frontend(client):
    big = b"\x00" * (3 * 1024 * 1024)
    res = client.post(
        "/api/analyze",
        files={"file": ("a.png", big, "image/png")},
        headers={"Origin": "http://localhost:5173"},
    )
    assert res.status_code == 413
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_missing_file_field(client):
    res = client.post("/api/analyze", data={"request_id": "x"})
    assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_request"


def test_model_unavailable_returns_503_and_stores_nothing(settings, png_bytes):
    app = create_app(settings, runner_factory=factory(FakeRunner()))
    with TestClient(app) as c:
        res = post_image(c, png_bytes)
        assert res.status_code == 503 and res.json()["error"]["code"] == "model_unavailable"
        assert c.get("/api/history").json() == []


def test_invalid_model_output_returns_500_and_stores_nothing(settings, png_bytes):
    runner = FakeRunner()
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(runner))) as c:
        runner.logits_fn = lambda b: np.array([[np.nan, 1, 1, 1]])
        res = post_image(c, png_bytes)
        assert res.status_code == 500 and res.json()["error"]["code"] == "invalid_model_output"
        assert "prediction" not in res.json()
        assert c.get("/api/history").json() == []


def test_internal_errors_hide_paths_and_tracebacks(settings, png_bytes):
    runner = FakeRunner()
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(runner)), raise_server_exceptions=False) as c:

        def explode(b):
            raise RuntimeError(f"Traceback: secret at {settings.model_dir}")

        runner.logits_fn = explode
        res = post_image(c, png_bytes)
        assert res.status_code == 500
        assert "Traceback" not in res.text and str(settings.model_dir) not in res.text


def test_inconclusive_result_over_http(settings, png_bytes):
    write_model_dir(settings.model_dir)
    runner = FakeRunner(lambda b: np.array([[0.1, 0.0, 0.2, 0.0]]))
    with TestClient(create_app(settings, runner_factory=factory(runner))) as c:
        body = post_image(c, png_bytes).json()
        assert body["status"] == "inconclusive" and body["prediction"] is None
        assert body["reasons"][0]["code"] == "low_confidence"
        assert c.get("/api/history").json()[0]["status"] == "inconclusive"


def test_concurrent_requests_all_succeed(client):
    images = [encode(phantom(seed=i)) for i in range(8)]
    results: list[int] = []

    def worker(data):
        results.append(post_image(client, data).status_code)

    threads = [threading.Thread(target=worker, args=(d,)) for d in images]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [200] * 8
    assert len(client.get("/api/history").json()) == 8


# ----------------------------------------------------------------- history
def test_history_round_trip_without_image_or_filename(client, png_bytes):
    assert client.get("/api/history").json() == []
    first = post_image(client, png_bytes, name="Jane_Doe_MRN12345.png").json()
    second = post_image(client, png_bytes).json()
    listing = client.get("/api/history")
    ids = [e["analysis_id"] for e in listing.json()]
    assert set(ids) == {first["analysis_id"], second["analysis_id"]}
    assert "Jane_Doe" not in listing.text and "MRN12345" not in listing.text
    assert "base64" not in listing.text and "overlay_png" not in listing.text

    entry = client.get(f"/api/history/{first['analysis_id']}").json()
    assert entry["prediction"] == first["prediction"] and entry["scores"] == first["scores"]

    assert client.delete(f"/api/history/{first['analysis_id']}").json() == {"deleted": 1}
    assert client.get(f"/api/history/{first['analysis_id']}").status_code == 404
    assert client.delete(f"/api/history/{first['analysis_id']}").status_code == 404
    assert client.delete("/api/history").json() == {"deleted": 1}
    assert client.get("/api/history").json() == []


def test_history_persists_across_restarts(settings, png_bytes):
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(FakeRunner()))) as c:
        analysis_id = post_image(c, png_bytes).json()["analysis_id"]
    with TestClient(create_app(settings, runner_factory=factory(FakeRunner()))) as c:
        assert c.get(f"/api/history/{analysis_id}").status_code == 200


def test_history_can_be_disabled(settings, png_bytes):
    from dataclasses import replace

    settings = replace(settings, history_enabled=False)
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(FakeRunner()))) as c:
        assert post_image(c, png_bytes).status_code == 200
        assert c.get("/api/history").json()["error"]["code"] == "history_disabled"
        assert c.get("/api/model-info").json()["history_enabled"] is False


# --------------------------------------------------------- reload / restart
def test_reload_picks_up_a_newly_trained_model(settings, png_bytes):
    with TestClient(create_app(settings, runner_factory=factory(FakeRunner()))) as c:
        assert post_image(c, png_bytes).status_code == 503
        write_model_dir(settings.model_dir)
        info = c.post("/api/model/reload").json()
        assert info["ready"] is True
        assert post_image(c, png_bytes).status_code == 200


def test_reload_to_broken_model_disables_analysis(settings, png_bytes):
    write_model_dir(settings.model_dir)
    with TestClient(create_app(settings, runner_factory=factory(FakeRunner()))) as c:
        assert post_image(c, png_bytes).status_code == 200
        (settings.model_dir / "metadata.json").write_text(json.dumps(make_metadata(classes=[])), encoding="utf-8")
        assert c.post("/api/model/reload").json()["ready"] is False
        assert post_image(c, png_bytes).status_code == 503


# -------------------------------------------------------------- evaluation
def test_evaluation_unavailable_until_generated(client, settings):
    res = client.get("/api/evaluation")
    assert res.status_code == 404 and res.json()["error"]["code"] == "evaluation_unavailable"
    (settings.model_dir / "evaluation.json").write_text(
        json.dumps({"model_version": "test-0.0.1", "test": {"accuracy": 0.5}}), encoding="utf-8"
    )
    body = client.get("/api/evaluation").json()
    assert body["test"]["accuracy"] == 0.5 and "version_mismatch" not in body


def test_evaluation_flags_version_mismatch(client, settings):
    (settings.model_dir / "evaluation.json").write_text(json.dumps({"model_version": "other"}), encoding="utf-8")
    assert client.get("/api/evaluation").json()["version_mismatch"] is True


def test_unknown_route_returns_json_error(client):
    res = client.get("/api/nope")
    assert res.status_code == 404 and res.json()["error"]["code"] == "not_found"
