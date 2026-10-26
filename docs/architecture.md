# Architecture

## Request flow

1. **Browser pre-checks** (`frontend/src/lib/fileCheck.ts`): reads the first 512 bytes to identify PNG, JPEG, WebP, DICOM or NIfTI by signature, checks the size, and decodes the image to read its dimensions. These checks give fast feedback; the server repeats all of them.
2. **Upload** (`frontend/src/api/client.ts`): multipart `POST /api/analyze` with the file and a fresh `request_id`. Requests time out after 90 s and are aborted when the image changes.
3. **Body limit** (`BodySizeLimit` in `backend/app/main.py`): rejects oversized bodies by `Content-Length`, and counts streamed bytes when the header is absent.
4. **Decode and validate** (`backend/app/validation.py`): signature sniffing; Pillow format must match the signature; dimension limits checked before pixels are decoded (decompression-bomb guard); `verify()` plus a full load to catch truncation; animated, too-small and blank images are rejected.
5. **Preprocessing** (`backend/app/preprocessing.py`, shared with training): EXIF orientation → transparency flattened onto black → 8-bit grey → pad to a centred square → bilinear resize → grey copied to 3 channels, float32 in [0, 255]. All pixel scaling happens inside the saved model.
6. **Inference** (`backend/app/runner.py`, `inference.py`): one Keras model loaded at startup, guarded by a lock. It returns logits and the pooled embedding.
7. **Output checks**: shape and finiteness (otherwise a 500 `invalid_model_output`, nothing stored), then temperature scaling, the review threshold, a colourfulness check and the Mahalanobis feature-distance check. Any failed check gives `inconclusive` with no class.
8. **Grad-CAM** (optional, `explain.py`): computed on the logit of the predicted class at the last convolutional layer, cropped back from the padded square, aligned to the original image and returned as a transparent PNG. Failure here never affects the classification.
9. **History** (`history.py`): the result without image, heatmap or file name.
10. **Rendering**: the client validates the response (`checkAnalysisResult`). Scores must sum to 1, the predicted class must be the top score, inconclusive results must carry no prediction, and the `request_id` must match. Only then does it go to the state machine.

## Readiness gate

`InferenceService.load()` runs these checks in order and stops at the first failure. Analysis stays disabled until all of them pass, and the app never falls back to another model.

| Check | Fails when |
|---|---|
| Model metadata file | `model/metadata.json` missing |
| Model metadata contents | invalid JSON or schema; class indices not 0..n-1; duplicate ids; unknown preprocessing id |
| Model weights file | weights file missing |
| Weights match metadata | SHA-256 differs from the one recorded at training |
| Model loads | TensorFlow missing or Keras cannot load the file |
| Input shape matches metadata | model input differs from metadata |
| Output size matches class list | number of outputs differs from number of classes |
| Atypical-input detector | `ood_stats.npz` missing or wrong shape |
| Inference smoke test | a synthetic input gives non-finite or wrongly shaped output |

## Frontend state

`frontend/src/lib/analysisMachine.ts` is a pure reducer with the phases `idle → validating → ready → analyzing → classified | inconclusive | failed`, plus `invalid`. Every event carries the image id or request id it belongs to. Events for anything that is no longer current are ignored, so a slow response can never be shown against a newer image. Selecting a new image always clears the result, heatmap, error and report data. The workspace lives above the router, so a result survives a trip to the report view, but nothing survives a page reload.

## Why these choices

- **One preprocessing module**: the cached training arrays and the inference arrays are produced by the same functions, and a test asserts they are byte-identical for the same file.
- **Scaling inside the model**: prevents double normalisation at serving time.
- **Grey + letterbox**: MRI slices are greyscale. Padding instead of stretching keeps anatomy proportions for any aspect ratio.
- **Flat Keras graph**: makes Grad-CAM read the real last convolutional layer without nested-model workarounds.
- **No external services**: images go only to the local backend.
