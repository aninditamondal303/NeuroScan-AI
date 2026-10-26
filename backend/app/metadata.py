"""Schema for ``model/metadata.json``, written by ``ml/train.py``.

The backend refuses to serve predictions unless this file exists, parses, and
agrees with the loaded model. Nothing here has a default value that could stand
in for a missing training output.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .preprocessing import MODEL_CHANNELS, PREPROCESSING_ID


class ClassInfo(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    index: int = Field(ge=0)
    is_tumour: bool


class InputSpec(BaseModel):
    height: int = Field(gt=0)
    width: int = Field(gt=0)
    channels: int
    dtype: Literal["float32"]
    value_range: tuple[float, float]

    @field_validator("channels")
    @classmethod
    def _channels(cls, v: int) -> int:
        if v != MODEL_CHANNELS:
            raise ValueError(f"expected {MODEL_CHANNELS} input channels")
        return v


class PreprocessingSpec(BaseModel):
    id: str

    @field_validator("id")
    @classmethod
    def _known(cls, v: str) -> str:
        if v != PREPROCESSING_ID:
            raise ValueError(f"model was trained with preprocessing '{v}', backend implements '{PREPROCESSING_ID}'")
        return v


class CalibrationSpec(BaseModel):
    method: Literal["temperature", "none"]
    temperature: float = Field(gt=0)
    fitted_on: str


class DecisionSpec(BaseModel):
    review_threshold: float = Field(gt=0, lt=1)
    selected_on: Literal["validation"]
    target_selective_accuracy: float = Field(gt=0, le=1)
    validation_coverage: float = Field(ge=0, le=1)
    validation_selective_accuracy: Optional[float] = Field(default=None, ge=0, le=1)


class OODSpec(BaseModel):
    method: Literal["mahalanobis-embedding"]
    embedding_layer: str
    threshold: float = Field(gt=0)
    stats_file: str
    fitted_on: str
    validation_flag_rate: float = Field(ge=0, le=1)


class InputChecksSpec(BaseModel):
    colourfulness_max: float = Field(gt=0)
    derived_from: str


class ExplainabilitySpec(BaseModel):
    method: Literal["grad-cam"]
    layer: str


class DatasetSpec(BaseModel):
    name: str
    source: str
    notes: Optional[str] = None


class ModelMetadata(BaseModel):
    schema_version: Literal[1]
    model_version: str = Field(min_length=1)
    architecture: str
    framework: str
    created_at: str
    weights_file: str
    weights_sha256: Optional[str] = None
    quick_run: bool = False
    logits_layer: str
    input: InputSpec
    preprocessing: PreprocessingSpec
    classes: list[ClassInfo] = Field(min_length=2)
    calibration: CalibrationSpec
    decision: DecisionSpec
    input_checks: InputChecksSpec
    ood: Optional[OODSpec] = None
    explainability: Optional[ExplainabilitySpec] = None
    dataset: DatasetSpec

    @model_validator(mode="after")
    def _classes_consistent(self) -> "ModelMetadata":
        indices = sorted(c.index for c in self.classes)
        if indices != list(range(len(self.classes))):
            raise ValueError("class indices must be 0..n-1 with no gaps or repeats")
        ids = [c.id for c in self.classes]
        if len(set(ids)) != len(ids):
            raise ValueError("class ids must be unique")
        self.classes.sort(key=lambda c: c.index)
        return self
