import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultSummary } from "../src/components/ResultPanel.tsx";
import { ScoreBars } from "../src/components/ScoreBars.tsx";
import { resultHeadline, resultKind } from "../src/lib/format.ts";
import { buildReport, reportJson } from "../src/lib/report.ts";
import { filterAndSort } from "../src/pages/History.tsx";
import { makeResult } from "./fixtures.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("tumour-class result names the class without claiming a diagnosis", () => {
  const html = text(renderToStaticMarkup(<ResultSummary result={makeResult()} />));
  assert.match(html, /Tumour class predicted/);
  assert.match(html, /Meningioma/);
  assert.match(html, /not a confirmed diagnosis/);
});

test("no-tumour result uses the required wording and caveat", () => {
  const r = makeResult({ values: [0.02, 0.03, 0.9, 0.05] });
  const html = text(renderToStaticMarkup(<ResultSummary result={r} />));
  assert.match(html, /No tumour class predicted by the model for this image\./);
  assert.match(html, /does not rule out a tumour/);
});

test("inconclusive result never shows a class or a no-tumour label", () => {
  const r = makeResult({ status: "inconclusive", values: [0.1, 0.2, 0.45, 0.25] });
  assert.equal(resultKind(r), "inconclusive");
  const html = text(renderToStaticMarkup(<ResultSummary result={r} />));
  assert.match(html, /Inconclusive/);
  assert.doesNotMatch(html, /No tumour class predicted/);
  assert.doesNotMatch(html, /Tumour class predicted/);
  assert.equal(resultHeadline(r).title, "No class reported");
});

test("score bars show every class in model order with exact values", () => {
  const r = makeResult({ values: [0.1, 0.2, 0.3, 0.4] });
  const html = renderToStaticMarkup(<ScoreBars scores={r.scores} threshold={0.6} caption="Scores" />);
  const labels = [...html.matchAll(/class="score-row__label[^"]*">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Glioma", "Meningioma", "No tumour", "Pituitary"]);
  for (const v of ["0.100", "0.200", "0.300", "0.400"]) assert.ok(html.includes(v), v);
  assert.match(html, /width:40%/);
  assert.match(html, /left:60%/);
});

test("report is built only from the result and omits heatmap pixels from JSON", () => {
  const r = makeResult({
    explanation: { status: "available", method: "grad-cam", target_class_id: "meningioma", layer: "x", overlay_png: "data:image/png;base64,AAAA", width: 1, height: 1, note: "note" },
  });
  const report = buildReport(r, "scan.png");
  assert.equal(report.analysisId, r.analysis_id);
  assert.equal(report.model.version, "test-1");
  assert.equal(report.headline.title, "Meningioma");
  assert.deepEqual(
    report.scores.map((s) => s.score),
    r.scores.map((s) => s.score),
  );
  assert.equal(report.image.filename, "scan.png");
  const json = reportJson(r, "scan.png");
  assert.ok(!json.includes("base64,AAAA"));
  assert.match(json, /not a certified medical report/);
});

test("history filter and sort", () => {
  const a = { ...makeResult({ values: [0.9, 0.05, 0.03, 0.02] }), analysis_id: "NS-1", created_at: "2026-01-01T00:00:00Z" };
  const b = { ...makeResult({ values: [0.02, 0.03, 0.9, 0.05] }), analysis_id: "NS-2", created_at: "2026-01-02T00:00:00Z" };
  const c = { ...makeResult({ status: "inconclusive", values: [0.3, 0.3, 0.2, 0.2] }), analysis_id: "NS-3", created_at: "2026-01-03T00:00:00Z" };
  const all = [a, b, c];
  assert.deepEqual(filterAndSort(all, "", "all", "newest").map((e) => e.analysis_id), ["NS-3", "NS-2", "NS-1"]);
  assert.deepEqual(filterAndSort(all, "", "no_tumour", "newest").map((e) => e.analysis_id), ["NS-2"]);
  assert.deepEqual(filterAndSort(all, "", "inconclusive", "newest").map((e) => e.analysis_id), ["NS-3"]);
  assert.deepEqual(filterAndSort(all, "glioma", "all", "newest").map((e) => e.analysis_id), ["NS-1"]);
  assert.deepEqual(filterAndSort(all, "", "all", "score_asc").map((e) => e.analysis_id), ["NS-3", "NS-1", "NS-2"]);
});

test("chart ticks are round numbers", async () => {
  const { niceTicks } = await import("../src/components/Charts.tsx");
  assert.deepEqual(niceTicks(0, 1.5), [0, 0.5, 1, 1.5]);
  assert.deepEqual(niceTicks(0.4, 1), [0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(0, 1500), [0, 500, 1000, 1500]);
});
