"""Upload validation: signatures, corrupt files, limits and odd images."""

from __future__ import annotations

import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image

from backend.app.errors import ApiError
from backend.app.validation import decode_upload, sniff_format

from .conftest import encode, phantom

LIMITS = dict(max_bytes=2 * 1024 * 1024, max_pixels=40_000_000, max_side=8192, min_side=64)


def rejects(data: bytes, **overrides) -> ApiError:
    with pytest.raises(ApiError) as info:
        decode_upload(data, **{**LIMITS, **overrides})
    return info.value


def test_sniffs_supported_and_known_formats():
    assert sniff_format(encode(phantom(), "PNG")) == "PNG"
    assert sniff_format(encode(phantom(), "JPEG")) == "JPEG"
    assert sniff_format(encode(phantom(), "WEBP")) == "WEBP"
    assert sniff_format(b"\x00" * 128 + b"DICM" + b"\x00" * 10) == "DICOM"
    assert sniff_format(b"\x00" * 344 + b"n+1\x00") == "NIFTI"
    assert sniff_format(b"\x1f\x8b\x08\x00") == "GZIP"
    assert sniff_format(b"hello world") is None


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
def test_accepts_supported_formats(fmt):
    decoded = decode_upload(encode(phantom(), fmt), **LIMITS)
    assert decoded.format == fmt
    assert (decoded.width, decoded.height) == (120, 100)
    assert decoded.gray.shape == (100, 120)


def test_rejects_empty_file():
    assert rejects(b"").code == "empty_file"


def test_rejects_file_over_size_limit():
    err = rejects(encode(phantom(), "PNG"), max_bytes=100)
    assert err.status_code == 413 and err.code == "file_too_large"


def test_rejects_text_file_even_with_image_extension():
    err = rejects(b"this is not an image, just text renamed to scan.png")
    assert err.status_code == 415 and err.code == "unrecognised_file"


def test_rejects_dicom_with_specific_guidance():
    err = rejects(b"\x00" * 128 + b"DICM" + b"\x00" * 400)
    assert err.code == "volumetric_format_not_supported"
    assert "slice" in (err.hint or "")


def test_rejects_nifti_and_gzip():
    assert rejects(b"\x00" * 344 + b"n+1\x00" + b"\x00" * 100).code == "volumetric_format_not_supported"
    assert rejects(b"\x1f\x8b\x08" + b"\x00" * 100).code == "volumetric_format_not_supported"


def test_rejects_other_image_formats():
    buf = io.BytesIO()
    Image.fromarray(phantom()).save(buf, format="BMP")
    assert rejects(buf.getvalue()).code == "unsupported_format"


def test_rejects_truncated_jpeg():
    data = encode(phantom(200, 200), "JPEG")
    err = rejects(data[: len(data) // 2])
    assert err.status_code == 422 and err.code == "corrupt_image"


def test_rejects_png_signature_followed_by_garbage():
    err = rejects(b"\x89PNG\r\n\x1a\n" + b"garbage" * 50)
    assert err.code == "corrupt_image"


def _png_header_only(width: int, height: int) -> bytes:
    """A PNG that declares huge dimensions without containing the pixels."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"\x00" * 16)) + chunk(b"IEND", b"")


def test_rejects_decompression_bomb_dimensions_before_decoding():
    err = rejects(_png_header_only(60000, 60000))
    assert err.status_code == 413 and err.code == "dimensions_too_large"


def test_rejects_too_small_image():
    err = rejects(encode(phantom(40, 40), "PNG"))
    assert err.code == "image_too_small"


def test_rejects_blank_image():
    err = rejects(encode(np.full((100, 100), 128, dtype=np.uint8), "PNG"))
    assert err.code == "blank_image"


def test_accepts_png_with_transparency_and_notes_it():
    arr = np.zeros((100, 100, 4), dtype=np.uint8)
    arr[..., :3] = phantom(100, 100)[..., None]
    arr[..., 3] = 255
    arr[:10, :10, 3] = 0
    decoded = decode_upload(encode(arr, "PNG"), **LIMITS)
    assert decoded.mode == "RGBA"
    assert any("Transparent" in n for n in decoded.notes)


def test_colourfulness_separates_grey_and_colour_images():
    grey = decode_upload(encode(np.stack([phantom()] * 3, axis=-1), "PNG"), **LIMITS)
    rng = np.random.default_rng(0)
    colour_arr = rng.integers(0, 255, size=(100, 120, 3), dtype=np.uint8)
    colour = decode_upload(encode(colour_arr, "PNG"), **LIMITS)
    assert grey.colourfulness < 1.0
    assert colour.colourfulness > 30.0
