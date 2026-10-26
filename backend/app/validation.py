"""Upload validation: identify the file by its bytes, decode it safely and
reject anything the model pipeline cannot handle correctly."""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

import numpy as np
from PIL import Image, UnidentifiedImageError

from .errors import ApiError
from .preprocessing import colourfulness, to_grayscale

SUPPORTED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MIN_GREY_STD = 2.0  # below this the slice is essentially a flat colour


@dataclass(frozen=True)
class DecodedImage:
    format: str
    mime_type: str
    width: int
    height: int
    mode: str
    size_bytes: int
    gray: np.ndarray
    colourfulness: float
    notes: tuple[str, ...]


def sniff_format(data: bytes) -> str | None:
    """Identify a file from its leading bytes. Returns a short format name."""
    if data[:3] == b"\xff\xd8\xff":
        return "JPEG"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    if len(data) >= 132 and data[128:132] == b"DICM":
        return "DICOM"
    if len(data) >= 348 and data[344:348] in (b"n+1\x00", b"ni1\x00"):
        return "NIFTI"
    if data[:2] == b"\x1f\x8b":
        return "GZIP"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "TIFF"
    if data[:2] == b"BM":
        return "BMP"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "GIF"
    return None


def _reject_unsupported(kind: str | None) -> ApiError:
    if kind in ("DICOM", "NIFTI", "GZIP"):
        return ApiError(
            415,
            "volumetric_format_not_supported",
            "DICOM and NIfTI files are not supported. The model was trained on single 2D slices saved as JPEG.",
            "Export one axial, coronal or sagittal slice as a PNG or JPEG and upload that image.",
        )
    if kind in ("TIFF", "BMP", "GIF"):
        return ApiError(
            415,
            "unsupported_format",
            f"{kind} images are not supported.",
            "Convert the slice to PNG, JPEG or WebP and try again.",
        )
    return ApiError(
        415,
        "unrecognised_file",
        "This file is not a PNG, JPEG or WebP image.",
        "Check that you selected an image file. Renaming a file does not change its format.",
    )


def decode_upload(data: bytes, *, max_bytes: int, max_pixels: int, max_side: int, min_side: int) -> DecodedImage:
    if len(data) == 0:
        raise ApiError(400, "empty_file", "The uploaded file is empty.", "Choose an image file and try again.")
    if len(data) > max_bytes:
        raise ApiError(
            413,
            "file_too_large",
            f"The file is larger than the {max_bytes // (1024 * 1024)} MB limit.",
            "Export the slice at a smaller size.",
        )

    kind = sniff_format(data)
    if kind not in SUPPORTED_FORMATS:
        raise _reject_unsupported(kind)

    corrupt = ApiError(
        422,
        "corrupt_image",
        "The image could not be decoded. It may be damaged or incomplete.",
        "Re-export the slice from your viewer and upload it again.",
    )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                width, height = probe.size
                actual_format = probe.format
                n_frames = getattr(probe, "n_frames", 1)
                if width * height > max_pixels or max(width, height) > max_side:
                    raise ApiError(
                        413,
                        "dimensions_too_large",
                        f"The image is {width} x {height} pixels, which exceeds the processing limit.",
                        f"Use an image no larger than {max_side} pixels on its longest side.",
                    )
                probe.verify()

            if actual_format != kind:
                raise corrupt
            if n_frames > 1:
                raise ApiError(
                    422,
                    "animated_image",
                    "Animated images are not supported.",
                    "Upload a single still slice.",
                )
            if min(width, height) < min_side:
                raise ApiError(
                    422,
                    "image_too_small",
                    f"The image is {width} x {height} pixels; at least {min_side} pixels per side is required.",
                    "Export the slice at a higher resolution.",
                )

            with Image.open(io.BytesIO(data)) as img:
                img.load()
                mode = img.mode
                colour = colourfulness(img)
                grey = to_grayscale(img)
    except ApiError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ApiError(
            413,
            "dimensions_too_large",
            "The image dimensions exceed the processing limit.",
            f"Use an image no larger than {max_side} pixels on its longest side.",
        ) from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError):
        raise corrupt from None

    if float(np.std(grey.pixels)) < MIN_GREY_STD:
        raise ApiError(
            422,
            "blank_image",
            "The image is almost a single flat colour, so there is nothing to analyse.",
            "Check that the exported slice contains the scan.",
        )

    return DecodedImage(
        format=kind,
        mime_type=SUPPORTED_FORMATS[kind],
        width=width,
        height=height,
        mode=mode,
        size_bytes=len(data),
        gray=grey.pixels,
        colourfulness=colour,
        notes=grey.notes,
    )
