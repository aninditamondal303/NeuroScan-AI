"""Preprocessing behaviour and training/inference consistency."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from backend.app.preprocessing import (
    PREPROCESSING_ID,
    letterbox_geometry,
    letterbox_square,
    load_slice_for_training,
    prepare_slice,
    to_grayscale,
    to_model_batch,
)
from backend.app.validation import decode_upload

from .conftest import encode, phantom

LIMITS = dict(max_bytes=10 * 1024 * 1024, max_pixels=40_000_000, max_side=8192, min_side=64)


def test_preprocessing_id_is_versioned():
    assert PREPROCESSING_ID == "grayscale-letterbox-v1"


def test_rgb_and_grey_versions_of_same_slice_match():
    grey = phantom()
    rgb = np.stack([grey] * 3, axis=-1)
    a = to_grayscale(Image.fromarray(grey)).pixels
    b = to_grayscale(Image.fromarray(rgb)).pixels
    assert np.array_equal(a, b)


def test_transparency_is_flattened_onto_black():
    rgba = np.zeros((10, 10, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = 0  # fully transparent white
    result = to_grayscale(Image.fromarray(rgba))
    assert result.pixels.max() == 0
    assert any("Transparent" in n for n in result.notes)


def test_sixteen_bit_image_is_rescaled_to_full_8bit_range():
    arr = np.linspace(1000, 3000, 64 * 64).reshape(64, 64).astype(np.uint16)
    result = to_grayscale(Image.fromarray(arr))
    assert result.pixels.dtype == np.uint8
    assert result.pixels.min() == 0 and result.pixels.max() == 255
    assert result.notes


def test_exif_orientation_is_applied():
    arr = np.zeros((40, 80), dtype=np.uint8)
    arr[:, :10] = 255  # bright stripe on the left
    img = Image.fromarray(arr)
    exif = img.getexif()
    exif[0x0112] = 6  # rotate 90 degrees clockwise when displayed
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    with Image.open(io.BytesIO(buf.getvalue())) as reopened:
        out = to_grayscale(reopened).pixels
    assert out.shape == (80, 40)
    assert out[:10, :].mean() > 200  # stripe now at the top


def test_letterbox_centres_without_stretching():
    gray = np.full((50, 100), 200, dtype=np.uint8)
    square, geo = letterbox_square(gray)
    assert square.shape == (100, 100)
    assert (geo.left, geo.top, geo.width, geo.height) == (0, 25, 100, 50)
    assert square[:25].max() == 0 and square[75:].max() == 0
    assert square[25:75].min() == 200


def test_geometry_for_tall_image():
    geo = letterbox_geometry(height=300, width=100)
    assert (geo.side, geo.left, geo.top) == (300, 100, 0)


def test_model_batch_shape_dtype_range_and_channels():
    prepared, _ = prepare_slice(phantom(), 224)
    batch = to_model_batch(prepared)
    assert batch.shape == (1, 224, 224, 3)
    assert batch.dtype == np.float32
    assert batch.min() >= 0 and batch.max() <= 255
    assert batch.max() > 1.0, "values must stay in [0, 255]; scaling happens inside the model"
    assert np.array_equal(batch[..., 0], batch[..., 1]) and np.array_equal(batch[..., 1], batch[..., 2])


def test_training_and_inference_produce_identical_arrays(tmp_path):
    """The cached training array and the inference array for the same file must match exactly."""
    for fmt, suffix in (("PNG", ".png"), ("JPEG", ".jpg")):
        data = encode(phantom(140, 110, seed=3), fmt)
        path = tmp_path / f"slice{suffix}"
        path.write_bytes(data)
        training = load_slice_for_training(str(path), 224)
        inference, _ = prepare_slice(decode_upload(data, **LIMITS).gray, 224)
        assert np.array_equal(training, inference), fmt


def test_preprocessing_is_deterministic():
    a, _ = prepare_slice(phantom(seed=5), 224)
    b, _ = prepare_slice(phantom(seed=5), 224)
    assert np.array_equal(a, b)
