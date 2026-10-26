"""Single source of truth for image preprocessing.

Both the training pipeline (``ml/``) and the inference service import these
functions, so a slice is converted to model input in exactly one way.

Pipeline (preprocessing id ``grayscale-letterbox-v1``):

1. Apply the EXIF orientation tag.
2. Flatten transparency onto a black background (MRI backgrounds are black).
3. Convert to 8-bit grayscale with Pillow's ITU-R 601 luma transform.
   16-bit / float images are min-max rescaled to 0-255 first.
4. Pad the image with black to a centred square (no cropping, no stretching).
5. Resize the square to the model size with bilinear interpolation.
6. Replicate the grey channel three times and cast to float32 in [0, 255].

Pixel scaling *beyond* step 6 lives inside the saved model (a Rescaling layer
for the baseline CNN, EfficientNet's own built-in rescaling/normalisation), so
inference code never normalises a second time.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageOps

PREPROCESSING_ID = "grayscale-letterbox-v1"
DEFAULT_IMAGE_SIZE = 224
MODEL_CHANNELS = 3


@dataclass(frozen=True)
class LetterboxGeometry:
    """Where the original image sits inside the padded square (in square pixels)."""

    side: int
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class GrayscaleResult:
    pixels: np.ndarray  # (H, W) uint8
    notes: tuple[str, ...]  # human-readable notes about conversions applied


def _flatten_transparency(img: Image.Image) -> tuple[Image.Image, bool]:
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    if not has_alpha:
        return img, False
    rgba = img.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (0, 0, 0, 255))
    background.alpha_composite(rgba)
    return background.convert("RGB"), True


def to_grayscale(img: Image.Image) -> GrayscaleResult:
    """Convert any supported Pillow image into an (H, W) uint8 grey array."""
    notes: list[str] = []
    img = ImageOps.exif_transpose(img)

    if img.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
        arr = np.asarray(img, dtype=np.float64)
        lo, hi = float(np.min(arr)), float(np.max(arr))
        if hi > lo:
            arr = (arr - lo) / (hi - lo) * 255.0
        else:
            arr = np.zeros_like(arr)
        notes.append("High bit-depth image was rescaled to 8-bit using its own min/max.")
        return GrayscaleResult(np.clip(np.rint(arr), 0, 255).astype(np.uint8), tuple(notes))

    img, flattened = _flatten_transparency(img)
    if flattened:
        notes.append("Transparent pixels were flattened onto black.")
    if img.mode == "CMYK":
        img = img.convert("RGB")
    if img.mode != "L":
        img = img.convert("L")
    return GrayscaleResult(np.asarray(img, dtype=np.uint8).copy(), tuple(notes))


def letterbox_geometry(height: int, width: int) -> LetterboxGeometry:
    side = max(height, width)
    return LetterboxGeometry(
        side=side,
        left=(side - width) // 2,
        top=(side - height) // 2,
        width=width,
        height=height,
    )


def letterbox_square(gray: np.ndarray) -> tuple[np.ndarray, LetterboxGeometry]:
    if gray.ndim != 2:
        raise ValueError("letterbox_square expects a 2-D grayscale array")
    geo = letterbox_geometry(*gray.shape)
    square = np.zeros((geo.side, geo.side), dtype=np.uint8)
    square[geo.top : geo.top + geo.height, geo.left : geo.left + geo.width] = gray
    return square, geo


def resize_square(square: np.ndarray, size: int) -> np.ndarray:
    resized = Image.fromarray(square).resize((size, size), Image.Resampling.BILINEAR)
    return np.asarray(resized, dtype=np.uint8)


def prepare_slice(gray: np.ndarray, size: int = DEFAULT_IMAGE_SIZE) -> tuple[np.ndarray, LetterboxGeometry]:
    """Grey (H, W) uint8 -> model-sized (size, size) uint8 plus letterbox geometry.

    This is the array cached by the training pipeline.
    """
    square, geo = letterbox_square(gray)
    return resize_square(square, size), geo


def to_model_batch(prepared: np.ndarray) -> np.ndarray:
    """(size, size) uint8 -> (1, size, size, 3) float32 in [0, 255]."""
    if prepared.ndim != 2 or prepared.dtype != np.uint8:
        raise ValueError("to_model_batch expects a 2-D uint8 array from prepare_slice")
    x = prepared.astype(np.float32)[None, :, :, None]
    return np.repeat(x, MODEL_CHANNELS, axis=-1)


def load_slice_for_training(path: str, size: int = DEFAULT_IMAGE_SIZE) -> np.ndarray:
    """Open an image file and return the cached training representation."""
    with Image.open(path) as img:
        img.load()
        gray = to_grayscale(img).pixels
    prepared, _ = prepare_slice(gray, size)
    return prepared


def colourfulness(img: Image.Image, max_side: int = 256) -> float:
    """Hasler & Suesstrunk (2003) colourfulness on a downsampled RGB copy.

    Brain MRI slices are greyscale, so a high value is a strong hint that the
    upload is a photograph or a colour-coded rendering rather than an MRI slice.
    """
    if img.mode in ("L", "LA", "I", "I;16", "I;16B", "I;16L", "F", "1"):
        return 0.0
    rgb, _ = _flatten_transparency(ImageOps.exif_transpose(img))
    rgb = rgb.convert("RGB")
    rgb.thumbnail((max_side, max_side))
    arr = np.asarray(rgb, dtype=np.float64)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    rg = r - g
    yb = 0.5 * (r + g) - b
    std = np.sqrt(np.std(rg) ** 2 + np.std(yb) ** 2)
    mean = np.sqrt(np.mean(rg) ** 2 + np.mean(yb) ** 2)
    return float(std + 0.3 * mean)
