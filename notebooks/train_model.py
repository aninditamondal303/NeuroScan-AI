"""
🧠 NeuroScan AI - Brain Tumor MRI Classifier Training Pipeline
Backbone: Fine-tuned EfficientNetB0 (ImageNet weights)
Author: Senior AI Engineer / DevOps Architect
Purpose: Academic placement defense & training demonstration
"""

import os
import argparse
import json
import numpy as np
import matplotlib.pyplot as plt
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks, optimizers
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score

def build_arg_parser():
    parser = argparse.ArgumentParser(description="NeuroScan AI Training Script")
    parser.add_argument("--data_dir", type=str, required=True, help="Path to 'brain-tumor-mri-dataset/' containing Training and Testing folders")
    parser.add_argument("--batch_size", type=int, default=32, help="Inference and training batch sizing")
    parser.add_argument("--epochs", type=int, default=25, help="Number of training epochs")
    parser.add_argument("--img_size", type=int, default=224, help="Target image dimension matches EfficientNet specification")
    parser.add_argument("--output_dir", type=str, default="../model", help="Target directory to dump weights and class maps")
    return parser

def train_model():
    parser = build_arg_parser()
    args = parser.parse_args()
    
    os.makedirs(args.output_dir, exist_ok=True)
    print(f"🧬 Booting Training Protocol. TensorFlow Version: {tf.__version__}")
    
    # 1. Data augmentation structures of training inputs
    train_dir = os.path.join(args.data_dir, "Training")
    test_dir = os.path.join(args.data_dir, "Testing")
    
    if not os.path.exists(train_dir):
        raise FileNotFoundError(f"Missing Training subdirectory inside data path: {train_dir}")
        
    print("📂 Configuring Data Generators with Augmentations...")
    train_datagen = ImageDataGenerator(
        rescale=1.0 / 255.0,
        rotation_range=20,
        width_shift_range=0.15,
        height_shift_range=0.15,
        zoom_range=0.15,
        horizontal_flip=True,
        validation_split=0.15 # 15% of training directory saved for inline validation
    )
    
    test_datagen = ImageDataGenerator(rescale=1.0 / 255.0)
    
    train_generator = train_datagen.flow_from_directory(
        train_dir,
        target_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="training",
        shuffle=True
    )
    
    val_generator = train_datagen.flow_from_directory(
        train_dir,
        target_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="validation",
        shuffle=False
    )
    
    test_generator = test_datagen.flow_from_directory(
        test_dir,
        target_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        class_mode="categorical",
        shuffle=False
    )
    
    # Save classes map
    class_indices = train_generator.class_indices
    class_names = {v: k for k, v in class_indices.items()}
    with open(os.path.join(args.output_dir, "class_names.json"), "w") as f:
        json.dump(class_names, f, indent=4)
    print(f"✅ Logged Class Map Indices: {class_names}")

    # 2. Build model architecture via Transfer Learning on EfficientNetB0
    print("🛰️ Downloading pre-trained EfficientNetB0 base backbone (ImageNet weights)...")
    base_model = tf.keras.applications.EfficientNetB0(
        weights="imagenet",
        include_top=False,
        input_shape=(args.img_size, args.img_size, 3)
    )
    
    # Freeze the initial base connections first
    base_model.trainable = False
    
    # Build classification head
    inputs = layers.Input(shape=(args.img_size, args.img_size, 3))
    x = base_model(inputs, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.BatchNormalization()(x)
    x = layers.Dropout(0.3)(x)
    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(len(class_indices), activation="softmax")(x)
    
    model = models.Model(inputs, outputs)
    
    # 3. Phase 1 Calibration compilation
    model.compile(
        optimizer=optimizers.Adam(learning_rate=1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"]
    )
    
    model.summary()
    
    # Callbacks structures
    checkpoint_path = os.path.join(args.output_dir, "best_model.keras")
    early_stop = callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True)
    reduce_lr = callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.2, patience=3, min_lr=1e-6)
    model_checkpoint = callbacks.ModelCheckpoint(checkpoint_path, monitor="val_loss", save_best_only=True)
    
    print("\n🚀 Phase 1: Training Output Head with Frozen Base model...")
    history_phase1 = model.fit(
        train_generator,
        validation_data=val_generator,
        epochs=10,
        callbacks=[early_stop, reduce_lr, model_checkpoint]
    )
    
    # Phase 2: Unfreeze fine tuning layers (unfreeze top 30 layers)
    print("\n🔮 Phase 2: Unfreezing Top 30 layers of EfficientNet for Fine Tuning...")
    base_model.trainable = True
    # Freeze everything except top 30 layers
    for layer in base_model.layers[:-30]:
        layer.trainable = False
        
    model.compile(
        optimizer=optimizers.Adam(learning_rate=1e-5), # Tiny learning rate prevents catastrophic interference
        loss="categorical_crossentropy",
        metrics=["accuracy"]
    )
    
    history_phase2 = model.fit(
        train_generator,
        validation_data=val_generator,
        epochs=args.epochs - 10,
        callbacks=[early_stop, reduce_lr, model_checkpoint]
    )
    
    print(f"💾 Training completed! Best model parameters successfully saved: {checkpoint_path}")
    
    # 4. Comprehensive Evaluation Protocol on test dataset
    print("\n📊 Executing Metric Evaluations on Test Set...")
    predictions = model.predict(test_generator)
    pred_labels = np.argmax(predictions, axis=1)
    true_labels = test_generator.classes
    
    acc = accuracy_score(true_labels, pred_labels)
    f1 = f1_score(true_labels, pred_labels, average="weighted")
    print(f"🔥 Evaluation Metrics: Accuracy = {acc:.4%}, F1-Score = {f1:.4%}")
    
    print("\n📋 Classification Report:")
    print(classification_report(true_labels, pred_labels, target_names=list(class_indices.keys())))
    
    print("\n🧩 Confusion Matrix:")
    print(confusion_matrix(true_labels, pred_labels))
    
    # Plotting training convergence curves
    plt.figure(figsize=(12, 4))
    plt.subplot(1, 2, 1)
    plt.plot(history_phase1.history["accuracy"] + history_phase2.history["accuracy"], label="Train Acc")
    plt.plot(history_phase1.history["val_accuracy"] + history_phase2.history["val_accuracy"], label="Val Acc")
    plt.title("Model Accuracy Progression")
    plt.xlabel("Epoch")
    plt.ylabel("Accuracy")
    plt.legend()
    
    plt.subplot(1, 2, 2)
    plt.plot(history_phase1.history["loss"] + history_phase2.history["loss"], label="Train Loss")
    plt.plot(history_phase1.history["val_loss"] + history_phase2.history["val_loss"], label="Val Loss")
    plt.title("Model Cross Entropy Loss")
    plt.xlabel("Epoch")
    plt.ylabel("Loss")
    plt.legend()
    
    plt.savefig(os.path.join(args.output_dir, "training_curves.png"))
    print(f"📈 Matplotlib Training curves saved to output directory!")

if __name__ == "__main__":
    train_model()
