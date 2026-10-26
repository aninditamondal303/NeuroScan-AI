"""Dataset scanning, caching and leakage checks (no TensorFlow needed).

Expected layout (Kaggle "Brain Tumor MRI Dataset" by Masoud Nickparvar):

    <data-dir>/Training/{glioma,meningioma,notumor,pituitary}/*.jpg
    <data-dir>/Testing/{glioma,meningioma,notumor,pituitary}/*.jpg
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.preprocessing import colourfulness, prepare_slice, to_grayscale  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
SPLIT_FOLDERS = ("Training", "Testing")

# Human-readable labels for the folder names used by the Kaggle dataset.
KNOWN_LABELS = {
    "glioma": ("Glioma", True),
    "meningioma": ("Meningioma", True),
    "notumor": ("No tumour", False),
    "no_tumor": ("No tumour", False),
    "pituitary": ("Pituitary", True),
}


@dataclass
class Sample:
    path: Path
    source: str  # "Training" or "Testing"
    class_id: str


@dataclass
class ScannedDataset:
    class_ids: list[str]
    samples: list[Sample]
    counts: dict[str, dict[str, int]] = field(default_factory=dict)


def class_info(class_ids: list[str]) -> list[dict]:
    info = []
    for i, cid in enumerate(class_ids):
        if cid not in KNOWN_LABELS:
            raise ValueError(
                f"Unknown class folder '{cid}'. Add it to KNOWN_LABELS in ml/dataset.py with its label and whether it is a tumour class."
            )
        label, is_tumour = KNOWN_LABELS[cid]
        info.append({"id": cid, "label": label, "index": i, "is_tumour": is_tumour})
    return info


def scan(data_dir: Path) -> ScannedDataset:
    data_dir = Path(data_dir)
    missing = [s for s in SPLIT_FOLDERS if not (data_dir / s).is_dir()]
    if missing:
        raise FileNotFoundError(f"{data_dir} must contain Training/ and Testing/ folders (missing: {', '.join(missing)}).")
    class_sets = {s: sorted(p.name for p in (data_dir / s).iterdir() if p.is_dir()) for s in SPLIT_FOLDERS}
    if class_sets["Training"] != class_sets["Testing"]:
        raise ValueError(f"Training and Testing have different class folders: {class_sets}")
    class_ids = class_sets["Training"]  # sorted -> stable, documented index order
    if len(class_ids) < 2:
        raise ValueError("At least two class folders are required.")
    samples: list[Sample] = []
    counts: dict[str, dict[str, int]] = {}
    for source in SPLIT_FOLDERS:
        counts[source] = {}
        for cid in class_ids:
            files = sorted(p for p in (data_dir / source / cid).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES)
            counts[source][cid] = len(files)
            samples.extend(Sample(p, source, cid) for p in files)
    return ScannedDataset(class_ids=class_ids, samples=samples, counts=counts)


HASH_GRID = 16  # 16 x 16 comparisons -> 256-bit hash
HASH_BYTES = HASH_GRID * HASH_GRID // 8


def dhash(prepared: np.ndarray) -> np.ndarray:
    """256-bit difference hash of a prepared slice, as 32 uint8 bytes.

    A 16 x 16 grid is used instead of the common 8 x 8 because brain slices from
    different patients look alike at very low resolution."""
    small = np.asarray(Image.fromarray(prepared).resize((HASH_GRID + 1, HASH_GRID), Image.Resampling.BILINEAR), dtype=np.int16)
    bits = (small[:, 1:] > small[:, :-1]).ravel()
    return np.packbits(bits)


@dataclass
class Cache:
    images: np.ndarray  # (N, size, size) uint8
    labels: np.ndarray  # (N,) int
    sources: np.ndarray  # (N,) str
    sha256: np.ndarray  # (N,) str, of the prepared pixels
    dhash: np.ndarray  # (N, 32) uint8
    colourfulness: np.ndarray  # (N,) float
    paths: np.ndarray  # (N,) str, relative to data dir


def build_cache(dataset: ScannedDataset, data_dir: Path, size: int, cache_file: Path | None, log=print) -> Cache:
    rel_paths = [str(s.path.relative_to(data_dir)).replace("\\", "/") for s in dataset.samples]
    fingerprint = hashlib.sha256(json.dumps([size, rel_paths]).encode()).hexdigest()[:16]
    if cache_file is not None and cache_file.is_file():
        with np.load(cache_file, allow_pickle=False) as data:
            if str(data["fingerprint"]) == fingerprint:
                log(f"Using cached preprocessed images from {cache_file.name}")
                return Cache(*(data[k] for k in ("images", "labels", "sources", "sha256", "dhash", "colourfulness", "paths")))

    n = len(dataset.samples)
    images = np.zeros((n, size, size), dtype=np.uint8)
    labels = np.zeros(n, dtype=np.int64)
    sha = np.empty(n, dtype="U64")
    dh = np.zeros((n, HASH_BYTES), dtype=np.uint8)
    colour = np.zeros(n, dtype=np.float64)
    index = {c: i for i, c in enumerate(dataset.class_ids)}
    for i, s in enumerate(dataset.samples):
        with Image.open(s.path) as img:
            img.load()
            colour[i] = colourfulness(img)
            gray = to_grayscale(img).pixels
        prepared, _ = prepare_slice(gray, size)
        images[i] = prepared
        labels[i] = index[s.class_id]
        sha[i] = hashlib.sha256(prepared.tobytes()).hexdigest()
        dh[i] = dhash(prepared)
        if (i + 1) % 500 == 0 or i + 1 == n:
            log(f"  preprocessed {i + 1}/{n}")
    cache = Cache(images, labels, np.array([s.source for s in dataset.samples]), sha, dh, colour, np.array(rel_paths))
    if cache_file is not None:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            cache_file,
            fingerprint=fingerprint,
            images=images,
            labels=labels,
            sources=cache.sources,
            sha256=sha,
            dhash=dh,
            colourfulness=colour,
            paths=cache.paths,
        )
    return cache


_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def hamming_pairs(a: np.ndarray, b: np.ndarray, max_distance: int, same: bool = False, block: int = 128) -> list[tuple[int, int, int]]:
    """All (i, j, distance) with Hamming distance <= max_distance between two
    (N, bytes) uint8 hash arrays. When ``same`` is true, only i < j is returned."""
    a8 = np.ascontiguousarray(a, dtype=np.uint8)
    b8 = np.ascontiguousarray(b, dtype=np.uint8)
    out: list[tuple[int, int, int]] = []
    for start in range(0, len(a8), block):
        chunk = a8[start : start + block]
        dist = _POPCOUNT[chunk[:, None, :] ^ b8[None, :, :]].sum(axis=-1, dtype=np.int32)
        ii, jj = np.nonzero(dist <= max_distance)
        for i, j in zip(ii.tolist(), jj.tolist()):
            gi = start + i
            if same and gi >= j:
                continue
            out.append((gi, j, int(dist[i, j])))
    return out


class UnionFind:
    def __init__(self, n: int):
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


@dataclass
class LeakageReport:
    train_pool: np.ndarray  # indices into the cache usable for training/validation
    groups: np.ndarray  # group id for each index in train_pool
    test: np.ndarray  # indices of the held-out test set
    summary: dict


def leakage_check(cache: Cache, max_distance: int) -> LeakageReport:
    """Remove training images that duplicate (or nearly duplicate) a test image,
    drop label conflicts, and group near-duplicates so validation can be split
    by group rather than by image."""
    train_idx = np.nonzero(cache.sources == "Training")[0]
    test_idx = np.nonzero(cache.sources == "Testing")[0]

    # Exact duplicates are found by pixel hash; near duplicates by dHash distance.
    test_sha = set(cache.sha256[test_idx].tolist())
    exact_overlap = {int(i) for i in train_idx if cache.sha256[i] in test_sha}
    near = hamming_pairs(cache.dhash[train_idx], cache.dhash[test_idx], max_distance)
    near_overlap = {int(train_idx[i]) for i, _, _ in near}
    overlapping_test = exact_overlap | near_overlap

    # Label conflicts: identical pixels filed under different classes in Training.
    by_hash: dict[str, set[int]] = defaultdict(set)
    for i in train_idx:
        by_hash[str(cache.sha256[i])].add(int(cache.labels[i]))
    conflict_hashes = {h for h, labs in by_hash.items() if len(labs) > 1}
    conflicts = {int(i) for i in train_idx if cache.sha256[i] in conflict_hashes}

    keep = np.array([int(i) for i in train_idx if int(i) not in overlapping_test and int(i) not in conflicts], dtype=np.int64)

    # Group near-duplicates within the remaining training pool.
    uf = UnionFind(len(keep))
    within = hamming_pairs(cache.dhash[keep], cache.dhash[keep], max_distance, same=True)
    for i, j, _ in within:
        uf.union(i, j)
    groups = np.array([uf.find(i) for i in range(len(keep))], dtype=np.int64)
    group_sizes = Counter(groups.tolist())

    test_pairs = hamming_pairs(cache.dhash[test_idx], cache.dhash[test_idx], max_distance, same=True)
    test_exact = len(test_idx) - len(set(cache.sha256[test_idx].tolist()))

    summary = {
        "method": "SHA-256 of preprocessed pixels (exact) and 256-bit dHash Hamming distance (near-duplicate)",
        "near_duplicate_max_distance": max_distance,
        "training_images_scanned": int(len(train_idx)),
        "training_removed_exact_match_in_test": len(exact_overlap),
        "training_removed_near_match_in_test": len(near_overlap - exact_overlap),
        "training_removed_label_conflicts": len(conflicts - overlapping_test),
        "training_pool_after_removal": int(len(keep)),
        "near_duplicate_pairs_within_training": len(within),
        "groups_with_more_than_one_image": sum(1 for v in group_sizes.values() if v > 1),
        "largest_group_size": max(group_sizes.values()) if group_sizes else 0,
        "test_images": int(len(test_idx)),
        "test_exact_duplicate_images": int(test_exact),
        "test_near_duplicate_pairs": len(test_pairs),
        "patient_ids_available": False,
        "note": "The dataset has no patient identifiers, so slices from the same patient cannot be grouped "
        "reliably. Near-duplicate grouping reduces, but cannot eliminate, patient-level leakage.",
    }
    return LeakageReport(train_pool=keep, groups=groups, test=test_idx, summary=summary)


def grouped_validation_split(labels: np.ndarray, groups: np.ndarray, fraction: float, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Stratified split that never puts members of one near-duplicate group on both sides.
    Returns positions (into ``labels``) for train and validation."""
    from sklearn.model_selection import StratifiedGroupKFold

    n_splits = max(2, int(round(1.0 / fraction)))
    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    train_pos, val_pos = next(splitter.split(np.zeros(len(labels)), labels, groups))
    return np.sort(train_pos), np.sort(val_pos)
