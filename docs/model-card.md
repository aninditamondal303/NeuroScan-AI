# Model card: NeuroScan AI slice classifier

*Model `2026.10.26-efficientnet_b0-8c7d9591`. Every number in "Measured results" comes from `model/evaluation.json` (`python -m ml.report_md`).*

## Intended use

Research, teaching and portfolio demonstration of a careful image-classification pipeline. **Not** for diagnosis, triage, screening or any clinical decision.

## Inputs and outputs

- **Input:** one 2D brain MRI slice (PNG, JPEG or WebP), converted to grey, padded to a square and resized to 224 × 224 (preprocessing id `grayscale-letterbox-v1`).
- **Output:** scores for glioma, meningioma, no tumour and pituitary tumour. The class index order is the sorted dataset folder names, stored in `metadata.json`. The output is reported as *inconclusive* when the top score is below the review threshold, the image is in colour, or its features are far from the training data.

## Training data

*Brain Tumor MRI Dataset* (Masoud Nickparvar, Kaggle): about 7,000 JPEG slices in `Training` and `Testing` folders, combining the figshare, SARTAJ and Br35H collections. According to the dataset's description, SARTAJ glioma images were mislabelled and were replaced with figshare images. The no-tumour class comes from Br35H. No patient identifiers are available.

This copy of the dataset has 1,400 images per class in `Training` and 400 per class in `Testing`. It includes pre-augmented meningioma copies (`*aug*` files: 100 in `Training`, 103 in `Testing`).

Known risks:

- Images of one patient can appear in several splits.
- Classes come from different source collections, so a model can learn *which collection* an image came from (contrast, framing, resolution) rather than tumour appearance. Strong test results on this dataset do not show the model learned the anatomy.
- Mixed planes and sequences. Unknown scanners and protocols.

## Procedure (ml/train.py)

1. Exact (pixel SHA-256) and near-duplicate (256-bit dHash, Hamming distance ≤ 12) detection. Training images that match a test image are removed, as are images filed under two classes.
2. Validation taken from `Training` (15%), stratified by class and grouped by near-duplicate cluster.
3. Candidates: a baseline CNN trained from scratch, and EfficientNetB0 with ImageNet weights (classification head first, then the top 40 layers fine-tuned with BatchNorm frozen). Augmentation on training batches only: horizontal flip, rotation of ±4% of a turn, zoom, translation, contrast. Balanced class weights. Early stopping on validation loss.
4. Selection by validation macro-F1.
5. Temperature scaling, review threshold (lowest threshold that reaches the target selective accuracy on validation, default 97%) and atypical-input limit (99th percentile of validation Mahalanobis distance) all fitted on validation data.
6. One evaluation on the `Testing` folder, plus a serving-consistency check through the backend code.

## Measured results

Held-out `Testing` folder, 1,600 images, Windows laptop CPU.

| Metric | Value |
|---|---|
| Accuracy | 90.9% |
| Macro F1 | 0.908 |
| Balanced accuracy | 90.9% |
| Tumour vs no tumour: sensitivity | 95.3% (57 of 1,200 missed) |
| Tumour vs no tumour: specificity | 96.8% (13 of 400 flagged) |
| Calibration error (ECE), before / after temperature scaling | 0.055 / 0.048 (T = 1.239) |
| Images classified at the review threshold (0.445) | 99.9% (2 flagged), accuracy 91.0% |
| Normal test slices flagged as atypical | 1.8% |

| Class | Precision | Recall | F1 | Specificity |
|---|---|---|---|---|
| Glioma | 0.970 | 0.818 | 0.887 | 0.992 |
| Meningioma | 0.927 | 0.855 | 0.889 | 0.978 |
| No tumour | 0.872 | 0.968 | 0.917 | 0.953 |
| Pituitary | 0.887 | 0.998 | 0.939 | 0.958 |

Confusion matrix (rows = true class, columns = predicted; glioma, meningioma, no tumour, pituitary):

| | Glioma | Meningioma | No tumour | Pituitary |
|---|---|---|---|---|
| Glioma | 327 | 21 | 35 | 17 |
| Meningioma | 4 | 342 | 22 | 32 |
| No tumour | 6 | 5 | 387 | 2 |
| Pituitary | 0 | 1 | 0 | 399 |

**Leakage removed:** 115 exact and 672 near-duplicate matches between `Training` and `Testing` were dropped from training (4,813 of 5,600 training images kept).

**Two training runs.** Run 1 (default settings) compared a baseline CNN (validation macro F1 0.910) with EfficientNetB0 fine-tuned in its top 40 layers (0.937, selected; test accuracy 86.1%). Run 2 (`-FullFineTune`) fine-tuned every EfficientNetB0 layer (validation macro F1 0.971; test accuracy 90.9%) and was adopted under a rule fixed before it finished: replace run 1 only if validation macro F1 is higher. The test set was therefore evaluated twice; no setting was tuned on it.

**Validation vs test gap.** Validation accuracy (97%) exceeds test accuracy (91%), so the review threshold chosen on validation keeps almost every test image. The threshold should not be read as a 97% accuracy guarantee on new data.

## Limitations

See the README's *Limitations and responsible use* section. In particular: one slice, four classes, one public dataset, no external validation, and no measured ability to reject non-MRI images.
