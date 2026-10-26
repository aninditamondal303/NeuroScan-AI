import assert from "node:assert/strict";
import { test } from "node:test";
import { canAnalyze, initialState, workspaceReducer as reduce, type WorkspaceState } from "../src/lib/analysisMachine.ts";
import { makeResult } from "./fixtures.ts";

const file = (name = "a.png") => ({ name }) as unknown as File;
const problem = { kind: "http" as const, code: "x", message: "failed" };

function ready(id = "img-1"): WorkspaceState {
  let s = reduce(initialState, { type: "select", image: { id, file: file(), url: "blob:1" } });
  s = reduce(s, { type: "validated", imageId: id, width: 100, height: 80 });
  return s;
}

test("select -> validate -> ready", () => {
  const s = ready();
  assert.equal(s.phase, "ready");
  assert.equal(s.image?.width, 100);
  assert.ok(canAnalyze(s));
});

test("invalid file blocks analysis", () => {
  let s = reduce(initialState, { type: "select", image: { id: "i", file: file(), url: "blob:1" } });
  s = reduce(s, { type: "invalid", imageId: "i", problem });
  assert.equal(s.phase, "invalid");
  assert.equal(canAnalyze(s), false);
  assert.equal(reduce(s, { type: "analyze", requestId: "r" }), s);
});

test("successful analysis reaches classified or inconclusive", () => {
  let s = reduce(ready(), { type: "analyze", requestId: "req-1" });
  assert.equal(s.phase, "analyzing");
  assert.equal(canAnalyze(s), false, "no duplicate submission while analysing");
  s = reduce(s, { type: "succeeded", requestId: "req-1", result: makeResult() });
  assert.equal(s.phase, "classified");
  let t = reduce(ready(), { type: "analyze", requestId: "req-1" });
  t = reduce(t, { type: "succeeded", requestId: "req-1", result: makeResult({ status: "inconclusive", values: [0.3, 0.3, 0.2, 0.2] }) });
  assert.equal(t.phase, "inconclusive");
  assert.equal(t.result?.prediction, null);
});

test("a new image clears the previous result", () => {
  let s = reduce(ready(), { type: "analyze", requestId: "req-1" });
  s = reduce(s, { type: "succeeded", requestId: "req-1", result: makeResult() });
  s = reduce(s, { type: "select", image: { id: "img-2", file: file("b.png"), url: "blob:2" } });
  assert.equal(s.result, null);
  assert.equal(s.problem, null);
  assert.equal(s.phase, "validating");
});

test("a late response for an old request is ignored", () => {
  let s = reduce(ready("img-1"), { type: "analyze", requestId: "old" });
  s = reduce(s, { type: "select", image: { id: "img-2", file: file("b.png"), url: "blob:2" } });
  s = reduce(s, { type: "validated", imageId: "img-2", width: 50, height: 50 });
  s = reduce(s, { type: "analyze", requestId: "new" });
  const stale = reduce(s, { type: "succeeded", requestId: "old", result: makeResult({ client_request_id: "old" }) });
  assert.equal(stale, s, "stale success must not change state");
  const staleFail = reduce(s, { type: "failed", requestId: "old", problem });
  assert.equal(staleFail, s, "stale failure must not change state");
  const fresh = reduce(s, { type: "succeeded", requestId: "new", result: makeResult({ client_request_id: "new" }) });
  assert.equal(fresh.phase, "classified");
});

test("a response whose request id does not match is ignored", () => {
  const s = reduce(ready(), { type: "analyze", requestId: "req-1" });
  const next = reduce(s, { type: "succeeded", requestId: "req-1", result: makeResult({ client_request_id: "someone-else" }) });
  assert.equal(next, s);
});

test("late validation for a replaced image is ignored", () => {
  let s = reduce(initialState, { type: "select", image: { id: "a", file: file(), url: "blob:a" } });
  s = reduce(s, { type: "select", image: { id: "b", file: file(), url: "blob:b" } });
  const next = reduce(s, { type: "validated", imageId: "a", width: 1, height: 1 });
  assert.equal(next, s);
});

test("failure allows retry and never becomes a result", () => {
  let s = reduce(ready(), { type: "analyze", requestId: "r1" });
  s = reduce(s, { type: "failed", requestId: "r1", problem });
  assert.equal(s.phase, "failed");
  assert.equal(s.result, null);
  assert.ok(canAnalyze(s));
  s = reduce(s, { type: "analyze", requestId: "r2" });
  assert.equal(s.phase, "analyzing");
  assert.equal(s.problem, null);
});

test("cancel returns to ready without leaving a spinner", () => {
  let s = reduce(ready(), { type: "analyze", requestId: "r1" });
  s = reduce(s, { type: "cancel", requestId: "r1" });
  assert.equal(s.phase, "ready");
  assert.equal(reduce(s, { type: "succeeded", requestId: "r1", result: makeResult({ client_request_id: "r1" }) }), s);
});

test("remove resets everything", () => {
  let s = reduce(ready(), { type: "analyze", requestId: "r1" });
  s = reduce(s, { type: "remove" });
  assert.deepEqual(s, initialState);
});
