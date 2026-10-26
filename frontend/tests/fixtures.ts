// Hand-written API responses for software tests of the UI logic. They are not
// model outputs and are never imported by application code.
import type { AnalysisResult, ClassScore } from "../src/api/types.ts";

const CLASSES = [
  { class_id: "glioma", label: "Glioma", index: 0, is_tumour: true },
  { class_id: "meningioma", label: "Meningioma", index: 1, is_tumour: true },
  { class_id: "notumor", label: "No tumour", index: 2, is_tumour: false },
  { class_id: "pituitary", label: "Pituitary", index: 3, is_tumour: true },
];

export function scores(values: number[]): ClassScore[] {
  return CLASSES.map((c, i) => ({ ...c, score: values[i], raw_score: values[i] }));
}

export function makeResult(overrides: Partial<AnalysisResult> & { values?: number[] } = {}): AnalysisResult {
  const values = overrides.values ?? [0.05, 0.85, 0.06, 0.04];
  const s = scores(values);
  const top = s.reduce((a, b) => (b.score > a.score ? b : a));
  const status = overrides.status ?? "classified";
  const { values: _ignored, ...rest } = overrides;
  return {
    analysis_id: "NS-20260101-ABC123",
    client_request_id: "req-1",
    created_at: "2026-01-01T10:00:00+00:00",
    status,
    prediction: status === "classified" ? { class_id: top.class_id, label: top.label, is_tumour: top.is_tumour, score: top.score } : null,
    scores: s,
    uncertainty: {
      top_score: top.score,
      margin: 0.7,
      normalized_entropy: 0.3,
      review_threshold: 0.6,
      calibration: "temperature scaling (T = 1.000, fitted on validation)",
      ood_distance: 3.2,
      ood_threshold: 10,
    },
    reasons: status === "inconclusive" ? [{ code: "low_confidence", message: "The highest score (45%) is below the review threshold (60%) chosen on validation data." }] : [],
    warnings: [],
    image: { format: "PNG", width: 512, height: 512, mode: "L", size_bytes: 12345 },
    model: { version: "test-1", architecture: "test double" },
    explanation: { status: "not_requested", method: null, target_class_id: null, layer: null, overlay_png: null, width: null, height: null, note: "" },
    timing: { decode_ms: 1, inference_ms: 10, explanation_ms: 0, total_ms: 12 },
    ...rest,
  };
}
