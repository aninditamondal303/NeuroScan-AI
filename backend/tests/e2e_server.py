"""Test-only server for browser end-to-end tests.

Runs the real FastAPI app (validation, preprocessing, API, history, static
frontend) with a deterministic STAND-IN model whose scores are a simple function
of image brightness. It exists only to test software behaviour in a browser
(state handling, stale responses, rendering). Its outputs are not predictions
and it must never be used to demonstrate the model.

    python -m backend.tests.e2e_server --port 8765 --dist frontend/dist [--no-model] [--delay 1.5]
"""

from __future__ import annotations

import argparse
import tempfile
import time
from pathlib import Path

import numpy as np
import uvicorn

from backend.app.config import Settings
from backend.app.main import create_app

from .fakes import FakeRunner, factory, make_metadata, write_model_dir


def brightness_runner(delay: float) -> FakeRunner:
    def logits(batch: np.ndarray) -> np.ndarray:
        if delay and batch.shape[1] > 32:  # skip the delay for the startup smoke test
            time.sleep(delay)
        mean = float(batch.mean()) / 255.0
        # Dark images -> class 0, mid -> 1/3, bright -> 2. Very uniform mid-grey -> low confidence.
        centre = np.array([0.12, 0.3, 0.55, 0.42])
        return (-((mean - centre) ** 2) * 400.0)[None, :]

    def cam(batch: np.ndarray, class_index: int):
        g = batch[0, :, :, 0]
        return (g - g.min()) / (np.ptp(g) or 1.0)

    return FakeRunner(logits, input_shape=(64, 64, 3), gradcam_fn=cam, embedding_fn=lambda b: np.zeros((b.shape[0], 8)))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--dist", type=Path, required=True)
    p.add_argument("--no-model", action="store_true")
    p.add_argument("--delay", type=float, default=0.0)
    args = p.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="neuroscan-e2e-"))
    if not args.no_model:
        meta = make_metadata(
            model_version="E2E-TEST-DOUBLE",
            architecture="Stand-in for software tests (not a trained model)",
            input={"height": 64, "width": 64, "channels": 3, "dtype": "float32", "value_range": [0, 255]},
            decision={
                "review_threshold": 0.5,
                "selected_on": "validation",
                "target_selective_accuracy": 0.95,
                "validation_coverage": 0.9,
                "validation_selective_accuracy": 0.95,
            },
        )
        write_model_dir(tmp / "model", meta)
    settings = Settings(
        model_dir=tmp / "model",
        history_db=tmp / "history.db",
        history_enabled=True,
        max_upload_bytes=10 * 1024 * 1024,
        max_pixels=40_000_000,
        max_side=8192,
        min_side=64,
        inference_timeout_s=30,
        cors_origins=(),
        frontend_dist=args.dist.resolve(),
    )
    app = create_app(settings, runner_factory=factory(brightness_runner(args.delay)))
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
