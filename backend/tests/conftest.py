from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402

from .fakes import FakeRunner, factory, write_model_dir  # noqa: E402


def phantom(width: int = 120, height: int = 100, seed: int = 0) -> np.ndarray:
    """A synthetic grey 'head phantom': concentric ellipses plus mild noise.
    Generated in code so the test suite ships no medical images."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width]
    cx, cy = width / 2, height / 2
    r = ((xx - cx) / (width * 0.42)) ** 2 + ((yy - cy) / (height * 0.45)) ** 2
    img = np.where(r < 1.0, 90.0, 0.0) + np.where(r < 0.8, 60.0, 0.0)
    img += rng.normal(0, 4, size=img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def encode(arr: np.ndarray, fmt: str = "PNG", mode: str | None = None) -> bytes:
    img = Image.fromarray(arr) if mode is None else Image.fromarray(arr).convert(mode)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture
def png_bytes() -> bytes:
    return encode(phantom())


@pytest.fixture
def jpeg_bytes() -> bytes:
    return encode(phantom(), "JPEG")


@pytest.fixture
def colour_png_bytes() -> bytes:
    rng = np.random.default_rng(1)
    arr = rng.integers(0, 255, size=(100, 120, 3), dtype=np.uint8)
    arr[..., 0] = 230  # strongly red
    return encode(arr)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        model_dir=tmp_path / "model",
        history_db=tmp_path / "data" / "history.db",
        history_enabled=True,
        max_upload_bytes=2 * 1024 * 1024,
        max_pixels=40_000_000,
        max_side=8192,
        min_side=64,
        inference_timeout_s=10.0,
        cors_origins=("http://localhost:5173",),
        frontend_dist=tmp_path / "no-dist",
    )


@pytest.fixture
def runner() -> FakeRunner:
    return FakeRunner()


@pytest.fixture
def ready_app(settings: Settings, runner: FakeRunner):
    write_model_dir(settings.model_dir)
    return create_app(settings, runner_factory=factory(runner))


@pytest.fixture
def client(ready_app):
    from fastapi.testclient import TestClient

    with TestClient(ready_app) as c:
        yield c
