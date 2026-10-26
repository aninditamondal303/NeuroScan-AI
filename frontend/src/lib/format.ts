import type { HistoryEntry } from "../api/types.ts";

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${(v * 100).toFixed(digits)}%`;

export const score = (v: number | null | undefined, digits = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(digits));

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export type ResultKind = "tumour" | "no_tumour" | "inconclusive";

export function resultKind(r: Pick<HistoryEntry, "status" | "prediction">): ResultKind {
  if (r.status !== "classified" || !r.prediction) return "inconclusive";
  return r.prediction.is_tumour ? "tumour" : "no_tumour";
}

/** The exact wording used everywhere a result is described. */
export function resultHeadline(r: Pick<HistoryEntry, "status" | "prediction">): { title: string; summary: string; caveat: string } {
  const kind = resultKind(r);
  if (kind === "inconclusive") {
    return {
      title: "No class reported",
      summary: "The model could not give a sufficiently reliable classification for this image, so no class is reported.",
      caveat: "Treat this image as unclassified. It needs review by a qualified reader.",
    };
  }
  const label = r.prediction!.label;
  if (kind === "no_tumour") {
    return {
      title: label,
      summary: "No tumour class predicted by the model for this image.",
      caveat: "This does not rule out a tumour and does not replace radiological interpretation.",
    };
  }
  return {
    title: label,
    summary: `The model's highest-scoring class for this image is ${label.toLowerCase()}.`,
    caveat: "This is a model output, not a confirmed diagnosis. Only clinical and radiological assessment can establish whether a tumour is present.",
  };
}

export const RESULT_KIND_SHORT: Record<ResultKind, string> = {
  tumour: "Tumour class",
  no_tumour: "No tumour class",
  inconclusive: "Inconclusive",
};

export const RESULT_KIND_LABEL: Record<ResultKind, string> = {
  tumour: "Tumour class predicted",
  no_tumour: "No tumour class predicted",
  inconclusive: "Inconclusive",
};
