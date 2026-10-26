"""Dataset scanning, caching, duplicate detection and leakage-safe splitting."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from backend.app.preprocessing import load_slice_for_training
from ml.dataset import build_cache, class_info, dhash, grouped_validation_split, hamming_pairs, leakage_check, scan

CLASSES = ["glioma", "meningioma", "notumor", "pituitary"]


def slice_image(seed: int, size: int = 96) -> np.ndarray:
    """Distinct synthetic slices: an ellipse at a seed-dependent position plus texture."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size]
    cx, cy = rng.uniform(25, 70, size=2)
    rx, ry = rng.uniform(12, 30, size=2)
    img = 40 + 150 * (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1)
    img = img + rng.normal(0, 25, size=(size, size))
    return np.clip(img, 0, 255).astype(np.uint8)


def make_dataset(root: Path, per_class: int = 6, test_per_class: int = 3) -> Path:
    seed = 0
    for source, n in (("Training", per_class), ("Testing", test_per_class)):
        for c in CLASSES:
            folder = root / source / c
            folder.mkdir(parents=True)
            for i in range(n):
                Image.fromarray(slice_image(seed)).save(folder / f"{c}_{i}.jpg", quality=95)
                seed += 1
    return root


def test_scan_counts_and_sorted_class_order(tmp_path):
    ds = scan(make_dataset(tmp_path))
    assert ds.class_ids == CLASSES
    assert ds.counts["Training"] == {c: 6 for c in CLASSES}
    assert ds.counts["Testing"] == {c: 3 for c in CLASSES}
    info = class_info(ds.class_ids)
    assert [c["index"] for c in info] == [0, 1, 2, 3]
    assert [c["is_tumour"] for c in info] == [True, True, False, True]


def test_scan_rejects_mismatched_folders(tmp_path):
    make_dataset(tmp_path)
    (tmp_path / "Testing" / "extra").mkdir()
    with pytest.raises(ValueError):
        scan(tmp_path)


def test_unknown_class_folder_needs_explicit_label():
    with pytest.raises(ValueError):
        class_info(["glioma", "astrocytoma"])


def test_cache_matches_training_loader_and_is_reused(tmp_path):
    root = make_dataset(tmp_path / "data")
    ds = scan(root)
    cache_file = tmp_path / "cache.npz"
    cache = build_cache(ds, root, 64, cache_file, log=lambda m: None)
    assert cache.images.shape == (len(ds.samples), 64, 64)
    np.testing.assert_array_equal(cache.images[0], load_slice_for_training(str(ds.samples[0].path), 64))
    messages = []
    again = build_cache(ds, root, 64, cache_file, log=messages.append)
    assert any("cached" in m for m in messages)
    np.testing.assert_array_equal(again.images, cache.images)


def test_dhash_matches_recompressed_copy_but_not_different_slice():
    a = slice_image(1)
    jpeg_like = np.clip(a.astype(int) + np.random.default_rng(9).integers(-3, 4, a.shape), 0, 255).astype(np.uint8)
    other = slice_image(2)
    ha, hb, hc = dhash(a), dhash(jpeg_like), dhash(other)
    pairs = hamming_pairs(np.stack([ha]), np.stack([hb, hc]), max_distance=12)
    assert [(i, j) for i, j, _ in pairs] == [(0, 0)]


def test_leakage_check_removes_training_copies_of_test_images(tmp_path):
    root = make_dataset(tmp_path / "data")
    # Copy one test image into Training (different name) and one into a second class.
    leaked = root / "Testing" / "glioma" / "glioma_0.jpg"
    (root / "Training" / "glioma" / "copy_of_test.jpg").write_bytes(leaked.read_bytes())
    dup = root / "Training" / "meningioma" / "meningioma_0.jpg"
    (root / "Training" / "pituitary" / "mislabelled_copy.jpg").write_bytes(dup.read_bytes())

    ds = scan(root)
    cache = build_cache(ds, root, 64, None, log=lambda m: None)
    report = leakage_check(cache, max_distance=12)
    kept_paths = set(cache.paths[report.train_pool].tolist())
    assert "Training/glioma/copy_of_test.jpg" not in kept_paths
    assert "Training/meningioma/meningioma_0.jpg" not in kept_paths
    assert "Training/pituitary/mislabelled_copy.jpg" not in kept_paths
    assert report.summary["training_removed_exact_match_in_test"] >= 1
    assert report.summary["training_removed_label_conflicts"] == 2
    assert len(report.test) == 12  # the test set is never altered
    assert report.summary["patient_ids_available"] is False


def test_near_duplicates_stay_on_one_side_of_the_validation_split():
    rng = np.random.default_rng(0)
    labels = np.repeat(np.arange(4), 30)
    groups = np.arange(len(labels))
    groups[1:6] = 0  # five near-duplicates of image 0
    groups[40:44] = 40
    rng.shuffle(groups)
    train, val = grouped_validation_split(labels, groups, 0.2, seed=1)
    assert not set(groups[train]) & set(groups[val])
    assert set(train) | set(val) == set(range(len(labels)))
    # every class appears in validation
    assert set(labels[val]) == {0, 1, 2, 3}
