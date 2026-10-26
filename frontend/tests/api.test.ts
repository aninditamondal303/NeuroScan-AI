import assert from "node:assert/strict";
import { test } from "node:test";
import { api, ApiProblem, checkAnalysisResult } from "../src/api/client.ts";
import { checkDimensions, checkHeader, sniffBytes } from "../src/lib/fileCheck.ts";
import { makeResult, scores } from "./fixtures.ts";

const bytesOf = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("sniffs formats from file contents", () => {
  assert.equal(sniffBytes(bytesOf([0xff, 0xd8, 0xff, 0xe0])), "JPEG");
  assert.equal(sniffBytes(bytesOf([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a])), "PNG");
  assert.equal(sniffBytes(bytesOf("RIFF", [0, 0, 0, 0], "WEBP")), "WEBP");
  const dicom = new Uint8Array(140);
  dicom.set(bytesOf("DICM"), 128);
  assert.equal(sniffBytes(dicom), "DICOM");
  const nifti = new Uint8Array(352);
  nifti.set(bytesOf("n+1", [0]), 344);
  assert.equal(sniffBytes(nifti), "NIFTI");
  assert.equal(sniffBytes(bytesOf("hello, world")), "UNKNOWN");
});

test("header checks: empty, oversized, DICOM and unknown files are rejected", () => {
  assert.equal(checkHeader("PNG", 0, 1000)?.code, "empty_file");
  assert.equal(checkHeader("PNG", 2000, 1000)?.code, "file_too_large");
  assert.equal(checkHeader("DICOM", 10, 1000)?.code, "volumetric_format_not_supported");
  assert.equal(checkHeader("UNKNOWN", 10, 1000)?.code, "unrecognised_file");
  assert.equal(checkHeader("JPEG", 10, 1000), null);
});

test("dimension checks", () => {
  assert.equal(checkDimensions(32, 400, 64, 8192)?.code, "image_too_small");
  assert.equal(checkDimensions(9000, 400, 64, 8192)?.code, "dimensions_too_large");
  assert.equal(checkDimensions(512, 512, 64, 8192), null);
});

test("accepts a consistent result", () => {
  const r = makeResult();
  assert.equal(checkAnalysisResult(r, "req-1"), r);
});

test("rejects results that could mislead", () => {
  const cases: [string, unknown][] = [
    ["wrong request", makeResult({ client_request_id: "other" })],
    ["prediction not top score", { ...makeResult(), prediction: { class_id: "notumor", label: "No tumour", is_tumour: false, score: 0.06 } }],
    ["inconclusive with prediction", { ...makeResult(), status: "inconclusive" }],
    ["classified without prediction", { ...makeResult(), prediction: null }],
    ["NaN score", { ...makeResult(), scores: scores([NaN, 0.5, 0.25, 0.25]) }],
    ["scores do not sum to 1", { ...makeResult(), scores: scores([0.9, 0.9, 0.1, 0.1]) }],
    ["missing model version", { ...makeResult(), model: { version: "", architecture: "" } }],
    ["unknown status", { ...makeResult(), status: "success" }],
    ["empty", null],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => checkAnalysisResult(value, "req-1"), ApiProblem, name);
  }
});

function fakeFetch(respond: () => Promise<Response>): typeof fetch {
  return (async () => respond()) as typeof fetch;
}

const file = new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" });

test("analyze returns a validated result", async () => {
  const result = makeResult();
  const r = await api.analyze(file, "req-1", { explain: false, fetchImpl: fakeFetch(async () => new Response(JSON.stringify(result), { status: 200 })) });
  assert.equal(r.analysis_id, result.analysis_id);
});

test("analyze surfaces the server's error message", async () => {
  const body = { error: { code: "model_unavailable", message: "Model not ready.", hint: "Train it." } };
  await assert.rejects(
    api.analyze(file, "req-1", { explain: false, fetchImpl: fakeFetch(async () => new Response(JSON.stringify(body), { status: 503 })) }),
    (e: unknown) => e instanceof ApiProblem && e.problem.status === 503 && e.problem.code === "model_unavailable" && e.problem.hint === "Train it.",
  );
});

test("network failure becomes a readable problem, not a result", async () => {
  await assert.rejects(
    api.analyze(file, "req-1", { explain: false, fetchImpl: fakeFetch(async () => Promise.reject(new TypeError("Failed to fetch"))) }),
    (e: unknown) => e instanceof ApiProblem && e.problem.kind === "network",
  );
});

test("non-JSON error pages are handled", async () => {
  await assert.rejects(
    api.analyze(file, "req-1", { explain: false, fetchImpl: fakeFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 })) }),
    (e: unknown) => e instanceof ApiProblem && e.problem.status === 502 && !e.problem.message.includes("<html>"),
  );
});

test("cancelling reports 'aborted'", async () => {
  const ctrl = new AbortController();
  const slow: typeof fetch = ((_: unknown, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
  const pending = api.analyze(file, "req-1", { explain: false, signal: ctrl.signal, fetchImpl: slow });
  ctrl.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof ApiProblem && e.problem.kind === "aborted");
});
