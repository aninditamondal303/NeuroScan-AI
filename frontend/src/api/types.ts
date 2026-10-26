// Mirrors backend/app/schemas.py. Keep the two in sync.

export type AnalysisStatus = "classified" | "inconclusive";

export interface Notice {
  code: string;
  message: string;
}

export interface ClassScore {
  class_id: string;
  label: string;
  index: number;
  is_tumour: boolean;
  score: number;
  raw_score: number;
}

export interface Prediction {
  class_id: string;
  label: string;
  is_tumour: boolean;
  score: number;
}

export interface Uncertainty {
  top_score: number;
  margin: number;
  normalized_entropy: number;
  review_threshold: number;
  calibration: string;
  ood_distance: number | null;
  ood_threshold: number | null;
}

export interface ImageInfo {
  format: string;
  width: number;
  height: number;
  mode: string;
  size_bytes: number;
}

export interface ModelRef {
  version: string;
  architecture: string;
}

export interface Explanation {
  status: "available" | "not_requested" | "not_applicable" | "unavailable" | "failed";
  method: string | null;
  target_class_id: string | null;
  layer: string | null;
  overlay_png: string | null;
  width: number | null;
  height: number | null;
  note: string;
}

export interface Timing {
  decode_ms: number;
  inference_ms: number;
  explanation_ms: number;
  total_ms: number;
}

export interface AnalysisResult {
  analysis_id: string;
  client_request_id: string | null;
  created_at: string;
  status: AnalysisStatus;
  prediction: Prediction | null;
  scores: ClassScore[];
  uncertainty: Uncertainty;
  reasons: Notice[];
  warnings: Notice[];
  image: ImageInfo;
  model: ModelRef;
  explanation: Explanation;
  timing: Timing;
}

export type HistoryEntry = Omit<AnalysisResult, "client_request_id" | "explanation" | "timing">;

export interface ReadinessCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface Health {
  status: "ok";
  app_version: string;
  model_ready: boolean;
  model_version: string | null;
  loaded_at: string | null;
}

export interface ClassInfo {
  id: string;
  label: string;
  index: number;
  is_tumour: boolean;
}

export interface ModelMetadata {
  model_version: string;
  architecture: string;
  framework: string;
  created_at: string;
  quick_run: boolean;
  input: { height: number; width: number; channels: number };
  preprocessing: { id: string };
  classes: ClassInfo[];
  calibration: { method: string; temperature: number; fitted_on: string };
  decision: {
    review_threshold: number;
    target_selective_accuracy: number;
    validation_coverage: number;
    validation_selective_accuracy: number | null;
  };
  ood: { method: string; threshold: number; validation_flag_rate: number } | null;
  explainability: { method: string; layer: string } | null;
  dataset: { name: string; source: string; notes: string | null };
}

export interface Limits {
  max_upload_bytes: number;
  max_pixels: number;
  max_side: number;
  min_side: number;
  formats: string[];
}

export interface ModelInfo {
  ready: boolean;
  checks: ReadinessCheck[];
  loaded_at: string | null;
  metadata: ModelMetadata | null;
  limits: Limits;
  history_enabled: boolean;
  app_version: string;
}

// ---- evaluation.json (written by ml/train.py) ---------------------------
export interface PerClassMetric {
  class_id: string;
  label: string;
  precision: number;
  recall: number;
  f1: number;
  specificity: number;
  support: number;
}

export interface ClassificationMetrics {
  n: number;
  accuracy: number;
  macro_f1: number;
  balanced_accuracy: number;
  per_class: PerClassMetric[];
  confusion_matrix: { labels: string[]; matrix: number[][] };
  tumour_vs_no_tumour: {
    sensitivity: number;
    specificity: number;
    tp: number;
    fn: number;
    tn: number;
    fp: number;
    note: string;
  } | null;
}

export interface HistoryRow {
  epoch: number;
  phase: string;
  loss: number;
  accuracy: number;
  val_loss: number;
  val_accuracy: number;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  confidence: number | null;
  accuracy: number | null;
}

export interface Candidate {
  name: string;
  architecture: string;
  parameters: number;
  epochs_trained: number;
  train_seconds: number;
  validation: { accuracy: number; macro_f1: number; nll: number };
}

export interface Evaluation {
  schema_version: number;
  model_version: string;
  created_at?: string;
  re_evaluated_at?: string;
  quick_run?: boolean;
  version_mismatch?: boolean;
  dataset?: {
    name: string;
    source: string;
    classes: string[];
    folder_counts: Record<string, Record<string, number>>;
    split_counts: Record<string, Record<string, number>>;
    split_method: string;
  };
  leakage?: Record<string, number | string | boolean>;
  candidates?: Candidate[];
  selected?: string;
  selection_rule?: string;
  history?: HistoryRow[];
  calibration?: {
    temperature?: number;
    validation_ece_before?: number;
    validation_ece_after?: number;
    test_ece_before: number;
    test_ece_after: number;
    test_reliability: ReliabilityBin[];
  };
  decision?: {
    review_threshold?: number;
    target_selective_accuracy?: number;
    target_met?: boolean;
    coverage?: number;
    selective_accuracy?: number | null;
    test_coverage: number;
    test_selective_accuracy: number | null;
    test_accuracy_of_flagged: number | null;
    test_flagged_count: number;
  };
  ood?: { threshold?: number; validation_flag_rate?: number; test_flag_rate: number; note?: string };
  test?: ClassificationMetrics;
  test_accepted_only?: ClassificationMetrics | null;
  test_failures?: { path: string; true: string; predicted: string; score: number; would_be_flagged: boolean }[];
  serving_consistency?: { passed: boolean; checked: number; summary: string };
  environment?: Record<string, string>;
}
