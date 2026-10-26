import type { AnalysisResult, HistoryEntry } from "../api/types.ts";
import { resultHeadline, resultKind, RESULT_KIND_LABEL } from "./format.ts";

export const REPORT_DISCLAIMER =
  "Research and education prototype. This report is generated automatically from a machine learning model trained on a public dataset. " +
  "It is not a certified medical report, has not been clinically validated, and must not be used to diagnose, treat or rule out any condition.";

export interface ReportModel {
  analysisId: string;
  createdAt: string;
  kind: ReturnType<typeof resultKind>;
  kindLabel: string;
  headline: ReturnType<typeof resultHeadline>;
  scores: { label: string; score: number; isTop: boolean }[];
  uncertainty: AnalysisResult["uncertainty"];
  reasons: string[];
  warnings: string[];
  image: AnalysisResult["image"] & { filename: string | null };
  model: AnalysisResult["model"];
  explanationNote: string | null;
  disclaimer: string;
}

/** Builds report content strictly from a server result; nothing is invented. */
export function buildReport(source: AnalysisResult | HistoryEntry, filename: string | null): ReportModel {
  const top = Math.max(...source.scores.map((s) => s.score));
  const explanation = "explanation" in source ? source.explanation : null;
  return {
    analysisId: source.analysis_id,
    createdAt: source.created_at,
    kind: resultKind(source),
    kindLabel: RESULT_KIND_LABEL[resultKind(source)],
    headline: resultHeadline(source),
    scores: [...source.scores].sort((a, b) => a.index - b.index).map((s) => ({ label: s.label, score: s.score, isTop: s.score === top })),
    uncertainty: source.uncertainty,
    reasons: source.reasons.map((r) => r.message),
    warnings: source.warnings.map((w) => w.message),
    image: { ...source.image, filename },
    model: source.model,
    explanationNote: explanation && explanation.status === "available" ? explanation.note : null,
    disclaimer: REPORT_DISCLAIMER,
  };
}

/** JSON export: the server result minus the heatmap pixels. */
export function reportJson(source: AnalysisResult | HistoryEntry, filename: string | null): string {
  const copy: Record<string, unknown> = { ...source, exported_at: new Date().toISOString(), filename, disclaimer: REPORT_DISCLAIMER };
  if ("explanation" in source) {
    copy.explanation = { ...source.explanation, overlay_png: source.explanation.overlay_png ? "(omitted from export)" : null };
  }
  return JSON.stringify(copy, null, 2);
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
