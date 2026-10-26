"""Runtime configuration read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw not in (None, "") else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw not in (None, "") else default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


@dataclass(frozen=True)
class Settings:
    model_dir: Path = field(default_factory=lambda: _env_path("NEUROSCAN_MODEL_DIR", REPO_ROOT / "model"))
    history_db: Path = field(default_factory=lambda: _env_path("NEUROSCAN_HISTORY_DB", REPO_ROOT / "backend" / "data" / "history.db"))
    history_enabled: bool = field(default_factory=lambda: _env_bool("NEUROSCAN_HISTORY_ENABLED", True))
    max_upload_bytes: int = field(default_factory=lambda: _env_int("NEUROSCAN_MAX_UPLOAD_MB", 10) * 1024 * 1024)
    max_pixels: int = field(default_factory=lambda: _env_int("NEUROSCAN_MAX_PIXELS", 40_000_000))
    max_side: int = field(default_factory=lambda: _env_int("NEUROSCAN_MAX_SIDE", 8192))
    min_side: int = field(default_factory=lambda: _env_int("NEUROSCAN_MIN_SIDE", 64))
    inference_timeout_s: float = field(default_factory=lambda: _env_float("NEUROSCAN_INFERENCE_TIMEOUT_S", 60.0))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.environ.get("NEUROSCAN_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        )
    )
    frontend_dist: Path = field(default_factory=lambda: _env_path("NEUROSCAN_FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))


APP_VERSION = "1.0.0"
