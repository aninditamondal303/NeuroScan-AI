"""Create synthetic test images for the browser end-to-end checks.

    python -m backend.tests.make_e2e_images e2e-images

The 'slices' are drawn in code (ellipses and texture); they are not real MRI
scans and are only used to exercise the software.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def phantom(w: int, h: int, lesion: bool = True, gain: float = 1.0, seed: int = 0) -> Image.Image:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    r = ((xx - cx) / (w * 0.40)) ** 2 + ((yy - cy) / (h * 0.46)) ** 2
    img = np.zeros((h, w))
    img[(r < 1) & (r > 0.86)] = 200
    img[r < 0.86] = 95
    img += (r < 0.86) * rng.normal(0, 10, (h, w))
    img += (r < 0.8) * 18 * np.sin(xx / 9.0 + np.sin(yy / 13.0) * 2) * np.cos(yy / 11.0)
    v = ((xx - cx) / (w * 0.06)) ** 2 + ((yy - cy + h * 0.03) / (h * 0.12)) ** 2
    img[v < 1] = 25
    if lesion:
        lz = ((xx - cx * 1.35) / (w * 0.09)) ** 2 + ((yy - cy * 0.8) / (h * 0.08)) ** 2
        img[lz < 1] = 175
    return Image.fromarray(np.clip(img * gain, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    phantom(512, 512).save(out / "slice_a.jpg", quality=92)
    phantom(480, 560, lesion=False, gain=1.9, seed=2).save(out / "slice_b_bright.png")
    phantom(512, 512, gain=0.55, seed=3).save(out / "slice_c_dark.png")
    rng = np.random.default_rng(0)
    Image.fromarray(rng.integers(0, 255, (300, 400, 3), dtype=np.uint8)).save(out / "colour_photo.png")
    (out / "notes.png").write_bytes(b"this is text, not an image")
    data = (out / "slice_a.jpg").read_bytes()
    (out / "truncated.jpg").write_bytes(data[: len(data) // 3])
    (out / "study.dcm").write_bytes(b"\0" * 128 + b"DICM" + b"\0" * 500)
    print(f"Wrote test images to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "e2e-images"))
