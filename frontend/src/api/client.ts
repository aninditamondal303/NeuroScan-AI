import type { AnalysisResult, Evaluation, Health, HistoryEntry, ModelInfo } from "./types.ts";

const BASE = (import.meta.env?.VITE_API_BASE ?? "").replace(/\/$/, "");

export type ProblemKind = "http" | "network" | "timeout" | "aborted" | "invalid_response";

/** Every failure the UI can show. Messages are written for people, not developers. */
export interface Problem {
  kind: ProblemKind;
  status?: number;
  code: string;
  message: string;
  hint?: string;
}

export class ApiProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.message);
    this.problem = problem;
  }
}

export const isAbort = (e: unknown) => e instanceof ApiProblem && e.problem.kind === "aborted";

interface RequestOptions {
  method?: string;
  body?: BodyInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOptions = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 20_000);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort, { once: true });

  let response: Response;
  try {
    response = await fetchImpl(`${BASE}${path}`, { method: opts.method ?? "GET", body: opts.body, signal: controller.signal });
  } catch {
    if (timedOut) {
      throw new ApiProblem({
        kind: "timeout",
        code: "timeout",
        message: "The server did not respond in time.",
        hint: "Check that the backend is running, then try again.",
      });
    }
    if (opts.signal?.aborted) {
      throw new ApiProblem({ kind: "aborted", code: "aborted", message: "The request was cancelled." });
    }
    throw new ApiProblem({
      kind: "network",
      code: "network_error",
      message: "Could not reach the NeuroScan backend.",
      hint: "Start it with: uvicorn backend.app.main:app --port 8000",
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string; hint?: string } } | null)?.error;
    throw new ApiProblem({
      kind: "http",
      status: response.status,
      code: err?.code ?? `http_${response.status}`,
      message: err?.message ?? `The server returned an error (HTTP ${response.status}).`,
      hint: err?.hint,
    });
  }
  if (body === null) {
    throw new ApiProblem({ kind: "invalid_response", code: "invalid_response", message: "The server sent a response that could not be read." });
  }
  return body as T;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reject analysis responses that are malformed or internally inconsistent, so a
 * broken response can never be rendered as a result. The UI never alters a
 * prediction; it either shows the server's result as sent or shows an error.
 */
export function checkAnalysisResult(value: unknown, expectedRequestId: string | null): AnalysisResult {
  const bad = (why: string): never => {
    throw new ApiProblem({
      kind: "invalid_response",
      code: "invalid_result",
      message: "The server returned a result that failed validation, so it is not shown.",
      hint: why,
    });
  };
  const r = value as AnalysisResult;
  if (!r || typeof r !== "object") bad("Empty response.");
  if (typeof r.analysis_id !== "string" || !r.analysis_id) bad("Missing analysis ID.");
  if (r.status !== "classified" && r.status !== "inconclusive") bad("Unknown result status.");
  if (!Array.isArray(r.scores) || r.scores.length < 2) bad("Missing class scores.");
  if (!r.scores.every((s) => isFiniteNumber(s.score) && s.score >= 0 && s.score <= 1 && typeof s.class_id === "string")) bad("A class score is not a valid number.");
  const sum = r.scores.reduce((a, s) => a + s.score, 0);
  if (Math.abs(sum - 1) > 1e-3) bad("Class scores do not sum to 1.");
  if (expectedRequestId !== null && r.client_request_id !== expectedRequestId) bad("The result belongs to a different request.");
  if (r.status === "classified") {
    if (!r.prediction) bad("A classified result has no prediction.");
    const top = [...r.scores].sort((a, b) => b.score - a.score)[0];
    if (r.prediction!.class_id !== top.class_id) bad("The predicted class does not match the highest score.");
  } else if (r.prediction !== null) {
    bad("An inconclusive result must not carry a prediction.");
  }
  if (!r.model?.version) bad("Missing model version.");
  return r;
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/api/health", { signal, timeoutMs: 5_000 }),
  modelInfo: (signal?: AbortSignal) => request<ModelInfo>("/api/model-info", { signal }),
  reloadModel: () => request<ModelInfo>("/api/model/reload", { method: "POST", timeoutMs: 120_000 }),
  evaluation: (signal?: AbortSignal) => request<Evaluation>("/api/evaluation", { signal }),
  history: (signal?: AbortSignal) => request<HistoryEntry[]>("/api/history", { signal }),
  historyEntry: (id: string, signal?: AbortSignal) => request<HistoryEntry>(`/api/history/${encodeURIComponent(id)}`, { signal }),
  deleteEntry: (id: string) => request<{ deleted: number }>(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" }),
  clearHistory: () => request<{ deleted: number }>("/api/history", { method: "DELETE" }),
  async analyze(file: File, requestId: string, opts: { explain: boolean; signal?: AbortSignal; fetchImpl?: typeof fetch }) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("request_id", requestId);
    const raw = await request<unknown>(
      `/api/analyze?explain=${opts.explain ? "true" : "false"}`,
      { method: "POST", body: form, signal: opts.signal, timeoutMs: 90_000 },
      opts.fetchImpl,
    );
    return checkAnalysisResult(raw, requestId);
  },
};
