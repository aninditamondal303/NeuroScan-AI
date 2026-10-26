# model/

`ml/train.py` writes the trained model here. The backend loads it from this folder (or from `NEUROSCAN_MODEL_DIR`).

| File | Size | In Git? | Purpose |
|---|---|---|---|
| `best_model.keras` | ~20 MB | No | Weights of the selected model |
| `ood_stats.npz` | ~6 MB | No | Class means and precision matrix for the atypical-input detector |
| `metadata.json` | small | Yes, optional | Version, classes and their index order, input shape, preprocessing id, temperature, review threshold, weights SHA-256 |
| `evaluation.json` | small | Yes, optional | Held-out test results, training history, calibration, leakage checks |
| `split_manifest.json` | ~300 KB | No | Which dataset file went to train, validation and test |
| `candidates/` | large | No | Every trained candidate, kept for inspection |

The backend refuses to serve unless `metadata.json`, the weights and `ood_stats.npz` all exist and agree with each other. That includes the weights hash, which is recorded at training time.

## Sharing a trained model

GitHub rejects files over 100 MB and Git history keeps every version of a binary forever, so the weights are not committed. Two options:

1. **GitHub Release (recommended).** Zip `best_model.keras`, `ood_stats.npz` and `metadata.json` and attach the zip to a release. Others unzip it into `model\`. The weights hash in `metadata.json` confirms they have the right file.
2. **Git LFS.** `git lfs install`, then `git lfs track "model/*.keras" "model/*.npz"` and remove those patterns from `.gitignore`. Free GitHub accounts have limited LFS storage and bandwidth.

Never commit the dataset or any MRI image.
