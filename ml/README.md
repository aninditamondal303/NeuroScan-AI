# ml/

| File | Needs TensorFlow | Purpose |
|---|---|---|
| `dataset.py` | no | Scan `Training/` and `Testing/`, cache preprocessed arrays, duplicate and leakage checks, grouped validation split |
| `evaluation.py` | no | Metrics, temperature scaling, calibration error, review threshold, Mahalanobis statistics |
| `models.py` | yes | Baseline CNN and EfficientNetB0 definitions, augmentation |
| `train.py` | yes | Full pipeline; writes `model/` |
| `evaluate.py` | yes | Re-evaluate the saved model on the test folder |
| `tests/` | no | Unit tests for `dataset.py` and `evaluation.py` |

Run from the repository root with the venv active:

```powershell
python -m ml.train --data-dir "C:\data\brain-tumor-mri-dataset" --quick   # pipeline check
python -m ml.train --data-dir "C:\data\brain-tumor-mri-dataset"           # full run
python -m ml.evaluate --data-dir "C:\data\brain-tumor-mri-dataset"
python -m ml.train --help                                                  # all options
```

Images are preprocessed by `backend/app/preprocessing.py`, the same module the API uses.
