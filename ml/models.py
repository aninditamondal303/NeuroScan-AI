"""Model definitions (TensorFlow / Keras 3).

Every model:
* takes (size, size, 3) float32 input in [0, 255] (see backend/app/preprocessing.py),
* does its own pixel scaling inside the graph,
* exposes layers named ``embedding`` (pooled features), ``logits`` (pre-softmax)
  and ``probabilities`` (softmax output),
* is a single flat functional graph, so Grad-CAM can read any conv layer.
"""

from __future__ import annotations

from dataclasses import dataclass

import tensorflow as tf

keras = tf.keras
layers = keras.layers


@dataclass
class BuiltModel:
    name: str
    architecture: str
    model: "keras.Model"
    gradcam_layer: str
    backbone_layers: list  # layers frozen in the first training phase (empty for the baseline)


def _head(features, n_classes: int, dropout: float):
    x = layers.GlobalAveragePooling2D(name="embedding")(features)
    x = layers.Dropout(dropout, name="head_dropout")(x)
    logits = layers.Dense(n_classes, name="logits")(x)
    return layers.Activation("softmax", name="probabilities", dtype="float32")(logits)


def build_baseline_cnn(size: int, n_classes: int) -> BuiltModel:
    inputs = keras.Input(shape=(size, size, 3), name="image")
    x = layers.Rescaling(1.0 / 255.0, name="scale_0_1")(inputs)
    for i, filters in enumerate((32, 64, 128, 256)):
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"conv{i}a")(x)
        x = layers.BatchNormalization(name=f"bn{i}a")(x)
        x = layers.Activation("relu", name=f"relu{i}a")(x)
        x = layers.Conv2D(filters, 3, padding="same", use_bias=False, name=f"conv{i}b")(x)
        x = layers.BatchNormalization(name=f"bn{i}b")(x)
        x = layers.Activation("relu", name="last_conv" if i == 3 else f"relu{i}b")(x)
        if i < 3:
            x = layers.MaxPooling2D(name=f"pool{i}")(x)
    outputs = _head(x, n_classes, dropout=0.3)
    model = keras.Model(inputs, outputs, name="baseline_cnn")
    return BuiltModel("baseline_cnn", "Baseline CNN (4 conv blocks, trained from scratch)", model, "last_conv", [])


def build_efficientnet_b0(size: int, n_classes: int) -> BuiltModel:
    """EfficientNetB0 with ImageNet weights. Keras' EfficientNet includes its own
    rescaling and normalisation layers and expects inputs in [0, 255]."""
    base = keras.applications.EfficientNetB0(include_top=False, weights="imagenet", input_shape=(size, size, 3))
    outputs = _head(base.output, n_classes, dropout=0.3)
    model = keras.Model(base.input, outputs, name="efficientnet_b0")
    backbone = [layer for layer in base.layers if not isinstance(layer, keras.layers.InputLayer)]
    return BuiltModel("efficientnet_b0", "EfficientNetB0 (ImageNet-pretrained, fine-tuned)", model, "top_activation", backbone)


BUILDERS = {"baseline_cnn": build_baseline_cnn, "efficientnet_b0": build_efficientnet_b0}


def augmentation(seed: int) -> "keras.Sequential":
    """Applied to training batches only (never to validation, test or inference)."""
    return keras.Sequential(
        [
            layers.RandomFlip("horizontal", seed=seed),
            layers.RandomRotation(0.04, fill_mode="constant", seed=seed + 1),
            layers.RandomZoom(0.08, fill_mode="constant", seed=seed + 2),
            layers.RandomTranslation(0.04, 0.04, fill_mode="constant", seed=seed + 3),
            layers.RandomContrast(0.15, seed=seed + 4),
        ],
        name="train_augmentation",
    )


def set_backbone_trainable(built: BuiltModel, trainable: bool, last_n: int | None = None) -> None:
    """Freeze/unfreeze backbone layers. BatchNorm layers stay frozen so their
    ImageNet statistics are kept during fine-tuning."""
    targets = built.backbone_layers if last_n is None else built.backbone_layers[-last_n:]
    if not trainable:
        for layer in built.backbone_layers:
            layer.trainable = False
        return
    for layer in targets:
        layer.trainable = not isinstance(layer, layers.BatchNormalization)
