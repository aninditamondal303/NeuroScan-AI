"""Turn a Grad-CAM map into a transparent PNG aligned with the original upload."""

from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image

from .preprocessing import LetterboxGeometry

# Anchor colours sampled from matplotlib's "inferno" colormap (low -> high).
# The frontend legend uses the same anchors.
INFERNO_ANCHORS = np.array(
    [
        [0, 0, 4],
        [87, 16, 110],
        [188, 55, 84],
        [249, 142, 9],
        [252, 255, 164],
    ],
    dtype=np.float64,
)
MAX_OVERLAY_SIDE = 768


def _colourise(values: np.ndarray) -> np.ndarray:
    positions = np.linspace(0.0, 1.0, len(INFERNO_ANCHORS))
    flat = np.clip(values.ravel(), 0.0, 1.0)
    rgb = np.stack([np.interp(flat, positions, INFERNO_ANCHORS[:, c]) for c in range(3)], axis=-1)
    return rgb.reshape(values.shape + (3,))


def heatmap_overlay_png(cam: np.ndarray, geometry: LetterboxGeometry, model_size: int) -> tuple[str, int, int]:
    """Return (data URL, width, height) of an RGBA heatmap that lines up with the
    original image. Alpha follows the map value, so weak regions stay clear."""
    if cam.ndim != 2 or not np.all(np.isfinite(cam)):
        raise ValueError("invalid activation map")

    cam_img = Image.fromarray((np.clip(cam, 0, 1) * 255).astype(np.uint8))
    full = np.asarray(cam_img.resize((model_size, model_size), Image.Resampling.BILINEAR), dtype=np.float64) / 255.0

    # Crop away the black padding that was added to make the slice square.
    scale = model_size / geometry.side
    left = int(round(geometry.left * scale))
    top = int(round(geometry.top * scale))
    right = max(left + 1, int(round((geometry.left + geometry.width) * scale)))
    bottom = max(top + 1, int(round((geometry.top + geometry.height) * scale)))
    region = full[top:bottom, left:right]

    ratio = min(1.0, MAX_OVERLAY_SIDE / max(geometry.width, geometry.height))
    out_w = max(1, int(round(geometry.width * ratio)))
    out_h = max(1, int(round(geometry.height * ratio)))
    region_img = Image.fromarray((region * 255).astype(np.uint8)).resize((out_w, out_h), Image.Resampling.BILINEAR)
    values = np.asarray(region_img, dtype=np.float64) / 255.0

    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[..., :3] = np.rint(_colourise(values)).astype(np.uint8)
    rgba[..., 3] = np.rint(np.power(values, 0.8) * 255).astype(np.uint8)

    buffer = io.BytesIO()
    Image.fromarray(rgba).save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}", out_w, out_h
