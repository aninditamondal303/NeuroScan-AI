"""Response models for the public API. The frontend mirrors these in
``frontend/src/api/types.ts``."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

AnalysisStatus = Literal["classified", "inconclusive"]


class Notice(BaseModel):
    code: str
    message: str


class ClassScore(BaseModel):
    class_id: str
    label: str
    index: int
    is_tumour: bool
    score: float  # calibrated softmax score (temperature scaled)
    raw_score: float  # uncalibrated softmax score, kept for transparency


class Prediction(BaseModel):
    class_id: str
    label: str
    is_tumour: bool
    score: float


class Uncertainty(BaseModel):
    top_score: float
    margin: float  # difference between the two highest scores
    normalized_entropy: float  # 0 = all mass on one class, 1 = uniform
    review_threshold: float
    calibration: str
    ood_distance: Optional[float] = None
    ood_threshold: Optional[float] = None


class ImageInfo(BaseModel):
    format: str
    width: int
    height: int
    mode: str
    size_bytes: int


class ModelRef(BaseModel):
    version: str
    architecture: str


class Explanation(BaseModel):
    status: Literal["available", "not_requested", "not_applicable", "unavailable", "failed"]
    method: Optional[str] = None
    target_class_id: Optional[str] = None
    layer: Optional[str] = None
    overlay_png: Optional[str] = None  # data URL, aligned to the original image
    width: Optional[int] = None
    height: Optional[int] = None
    note: str


class Timing(BaseModel):
    decode_ms: float
    inference_ms: float
    explanation_ms: float
    total_ms: float


class AnalysisResult(BaseModel):
    analysis_id: str
    client_request_id: Optional[str] = None
    created_at: str
    status: AnalysisStatus
    prediction: Optional[Prediction]
    scores: list[ClassScore]
    uncertainty: Uncertainty
    reasons: list[Notice]  # why a result is inconclusive (empty when classified)
    warnings: list[Notice]
    image: ImageInfo
    model: ModelRef
    explanation: Explanation
    timing: Timing


class HistoryEntry(BaseModel):
    analysis_id: str
    created_at: str
    status: AnalysisStatus
    prediction: Optional[Prediction]
    scores: list[ClassScore]
    uncertainty: Uncertainty
    reasons: list[Notice]
    warnings: list[Notice]
    image: ImageInfo
    model: ModelRef


class ReadinessCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    app_version: str
    model_ready: bool
    model_version: Optional[str]
    loaded_at: Optional[str]


class Limits(BaseModel):
    max_upload_bytes: int
    max_pixels: int
    max_side: int
    min_side: int
    formats: list[str]


class ModelInfoResponse(BaseModel):
    ready: bool
    checks: list[ReadinessCheck]
    loaded_at: Optional[str]
    metadata: Optional[dict]
    limits: Limits
    history_enabled: bool
    app_version: str
