// Browser end-to-end checks for software behaviour.
//
// Needs two test servers (real FastAPI app, stand-in model from backend/tests/e2e_server.py):
//   python -m backend.tests.e2e_server --port 8765 --dist frontend/dist --delay 1.2
//   python -m backend.tests.e2e_server --port 8766 --dist frontend/dist --no-model
// and test images made by:  python -m backend.tests.make_e2e_images <folder>
// Then:  node frontend/e2e/workspace.e2e.mjs <folder-with-images> [screenshot-folder]
// Requires the "playwright" package and a Chromium build (npx playwright install chromium).
//
// The stand-in model's scores depend only on image brightness. These checks say
// nothing about model accuracy.

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const IMG = process.argv[2];
const SHOTS = process.argv[3] ?? null;
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:8765";
const BASE_NO_MODEL = process.env.E2E_BASE_NO_MODEL ?? "http://127.0.0.1:8766";
if (!IMG) throw new Error("usage: node workspace.e2e.mjs <image-folder> [screenshot-folder]");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message ?? e) });
    console.log(`FAIL ${name}\n     ${String(e?.message ?? e).split("\n")[0]}`);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const shot = async (name, p = page) => SHOTS && p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
const panel = () => page.locator("aside.ws-report");
const upload = (file) => page.locator('input[type="file"]').setInputFiles(join(IMG, file));
const analyzeBtn = () => page.getByRole("button", { name: "Analyze MRI" });

await check("overview loads with live model status and no invented metrics", async () => {
  await page.goto(`${BASE}/#/`);
  await page.getByText("Model ready").first().waitFor();
  await page.getByText("Evaluation unavailable").waitFor();
  const text = await page.locator("main").innerText();
  assert.ok(!/\d+\.\d+%/.test(text), "no percentage should appear without an evaluation report");
  await shot("01-overview");
});

await check("upload shows the actual image and marks it as not analysed", async () => {
  await page.goto(`${BASE}/#/analyze`);
  await upload("slice_a.jpg");
  await page.getByText("Not analysed yet").waitFor();
  const natural = await page.locator('img[alt="Uploaded MRI slice"]').evaluate((img) => [img.naturalWidth, img.naturalHeight, img.src.startsWith("blob:")]);
  assert.deepEqual(natural, [512, 512, true]);
  await page.getByText("512 × 512").first().waitFor();
  assert.ok(await analyzeBtn().isEnabled());
  await shot("02-ready");
});

let firstResult;
await check("analysis calls the real endpoint and renders exactly the returned class", async () => {
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/analyze"));
  await analyzeBtn().click();
  await page.getByRole("button", { name: "Cancel analysis" }).waitFor();
  assert.equal(await analyzeBtn().count(), 0, "no second Analyze button while running");
  await shot("03-analysing");
  const response = await responsePromise;
  firstResult = await response.json();
  assert.equal(response.status(), 200);
  await panel().getByText(firstResult.prediction.label, { exact: true }).first().waitFor();
  for (const s of firstResult.scores) assert.ok((await panel().innerText()).includes(s.score.toFixed(3)), `score for ${s.label}`);
  await page.getByText(`Showing result ${firstResult.analysis_id}`).waitFor();
  await shot("04-result");
});

await check("heatmap controls appear only with a real overlay and change the view", async () => {
  const heat = page.getByRole("button", { name: "Heatmap" });
  assert.ok(await heat.isEnabled());
  await page.locator('img[alt="Grad-CAM heatmap overlay"]').waitFor();
  await page.getByRole("button", { name: "Compare" }).click();
  const clip = await page.locator('img[alt="Grad-CAM heatmap overlay"]').evaluate((el) => el.style.clipPath);
  assert.match(clip, /inset/);
  await page.getByRole("button", { name: "Original" }).click();
  assert.equal(await page.locator('img[alt="Grad-CAM heatmap overlay"]').count(), 0);
});

await check("a new image clears the previous result and heatmap immediately", async () => {
  await upload("slice_c_dark.png");
  await page.getByText("Not analysed yet").waitFor();
  const text = await panel().innerText();
  assert.ok(!text.includes(firstResult.analysis_id), "old analysis id must disappear");
  assert.equal(await page.getByRole("button", { name: "Open report" }).count(), 0);
  assert.equal(await page.locator('img[alt="Grad-CAM heatmap overlay"]').count(), 0);
  assert.ok(await page.getByRole("button", { name: "Heatmap" }).isDisabled());
});

await check("a slow response for a replaced image never appears", async () => {
  await upload("slice_a.jpg");
  await page.getByText("Not analysed yet").waitFor();
  await analyzeBtn().click();
  await page.getByRole("button", { name: "Cancel analysis" }).waitFor();
  await upload("slice_c_dark.png"); // replace while the first request is in flight (server delay 1.2 s)
  await page.waitForTimeout(2500);
  await page.getByText("Not analysed yet").waitFor();
  const text = await panel().innerText();
  assert.ok(!/Tumour class predicted|No tumour class predicted|Inconclusive/.test(text), "no result may be shown for the new image");
});

await check("cancel returns to ready without a stuck spinner", async () => {
  await analyzeBtn().click();
  await page.getByRole("button", { name: "Cancel analysis" }).click();
  await analyzeBtn().waitFor();
  assert.equal(await page.locator(".progress").count(), 0);
  await page.waitForTimeout(1600);
  assert.ok(!(await panel().innerText()).includes("Showing result"));
});

await check("different images give their own results", async () => {
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/analyze"));
  await analyzeBtn().click();
  const second = await (await responsePromise).json();
  await panel().getByText(second.prediction.label, { exact: true }).first().waitFor();
  assert.notEqual(second.analysis_id, firstResult.analysis_id);
  assert.notEqual(second.prediction.class_id, firstResult.prediction.class_id, "stand-in model maps these two images to different classes");
});

await check("truncated JPEG is rejected by the backend even if the browser can preview it", async () => {
  await upload("truncated.jpg");
  // Browsers often render a partial JPEG, so the client check may pass; the server must still reject it.
  const clientRejected = page.getByText("could not decode", { exact: false }).first();
  await Promise.race([clientRejected.waitFor(), page.getByText("Not analysed yet").waitFor()]);
  if (await analyzeBtn().isEnabled()) {
    const responsePromise = page.waitForResponse((r) => r.url().includes("/api/analyze"));
    await analyzeBtn().click();
    const res = await responsePromise;
    assert.equal(res.status(), 422);
    await panel().getByText("could not be decoded", { exact: false }).waitFor();
    assert.ok(!/Tumour class predicted|No tumour class predicted/.test(await panel().innerText()));
  }
});

for (const [file, expected] of [
  ["notes.png", "not a PNG, JPEG or WebP"],
  ["study.dcm", "DICOM and NIfTI files are not supported"],
]) {
  await check(`rejects ${file} with a useful message`, async () => {
    await upload(file);
    await page.getByText(expected, { exact: false }).first().waitFor();
    assert.ok(await analyzeBtn().isDisabled());
    assert.equal(await page.locator('img[alt="Uploaded MRI slice"]').count(), 0);
    if (file === "study.dcm") await shot("05-rejected");
  });
}

await check("colour image is reported as inconclusive, not as a class", async () => {
  await upload("colour_photo.png");
  await analyzeBtn().waitFor();
  await page.getByText("Not analysed yet").waitFor();
  await analyzeBtn().click();
  await panel().getByText("Why no class is reported").waitFor();
  const text = await panel().innerText();
  assert.match(text, /Inconclusive/);
  assert.match(text, /contains colour/);
  assert.ok(!/Tumour class predicted|No tumour class predicted/.test(text));
  await shot("06-inconclusive");
});

await check("report contains the actual result and model metadata", async () => {
  await upload("slice_a.jpg");
  await page.getByText("Not analysed yet").waitFor();
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/analyze"));
  await analyzeBtn().click();
  const r = await (await responsePromise).json();
  await page.getByRole("button", { name: "Open report" }).click();
  const report = page.locator("article.report");
  await report.waitFor();
  const text = await report.innerText();
  assert.ok(text.includes(r.analysis_id));
  assert.ok(text.includes(r.prediction.label));
  assert.ok(text.includes(r.model.version));
  assert.ok(text.includes("slice_a.jpg"));
  assert.match(text, /not a certified medical report/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download data" }).click();
  assert.equal((await downloadPromise).suggestedFilename(), `${r.analysis_id}.json`);
  await shot("07-report");
  await page.getByRole("button", { name: "Back to viewer" }).click();
  await page.getByText(`Showing result ${r.analysis_id}`).waitFor();
});

await check("history lists saved results without file names, supports search and delete", async () => {
  await page.goto(`${BASE}/#/history`);
  await page.locator("table.table tbody tr").first().waitFor();
  const before = await page.locator("table.table tbody tr").count();
  assert.ok(before >= 4);
  assert.ok(!(await page.locator("main").innerText()).includes("slice_a.jpg"));
  const saved = await (await page.request.get(`${BASE}/api/history`)).json();
  assert.equal(before, saved.length, "table shows every saved analysis");
  await page.getByLabel("Result").selectOption("inconclusive");
  assert.equal(await page.locator("table.table tbody tr").count(), saved.filter((e) => e.status === "inconclusive").length);
  await page.getByLabel("Result").selectOption("all");
  await page.locator("table.table tbody tr a").first().click();
  await page.getByRole("button", { name: "Delete", exact: true }).waitFor();
  await shot("08-history");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll("table.table tbody tr").length === n - 1, before);
});

await check("network failure shows an error and no result", async () => {
  await page.goto(`${BASE}/#/analyze`);
  await upload("slice_a.jpg");
  await page.getByText("Not analysed yet").waitFor();
  await page.route("**/api/analyze**", (route) => route.abort("failed"));
  await analyzeBtn().click();
  await page.getByText("Could not reach the NeuroScan backend.").waitFor();
  assert.ok(await page.getByRole("button", { name: "Try again" }).isEnabled());
  assert.ok(!/Tumour class predicted|No tumour class predicted/.test(await panel().innerText()));
  await page.unroute("**/api/analyze**");
  await page.getByRole("button", { name: "Try again" }).click();
  await panel().getByText("Tumour class predicted").or(panel().getByText("No tumour class predicted")).first().waitFor();
});

await check("refreshing during analysis does not resurrect a result", async () => {
  await upload("slice_c_dark.png");
  await page.getByText("Not analysed yet").waitFor();
  await analyzeBtn().click();
  await page.reload();
  await page.getByText("Drop a brain MRI slice here").waitFor();
  await page.waitForTimeout(1500);
  assert.ok(!(await panel().innerText()).includes("Showing result"));
});

await check("model unavailable disables analysis and explains why", async () => {
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE_NO_MODEL}/#/analyze`);
  await p2.getByText("Analysis is disabled").waitFor();
  await p2.locator('input[type="file"]').setInputFiles(join(IMG, "slice_a.jpg"));
  await p2.getByText("Not analysed yet").waitFor();
  assert.ok(await p2.getByRole("button", { name: "Analyze MRI" }).isDisabled());
  await p2.goto(`${BASE_NO_MODEL}/#/about`);
  await p2.getByText("model/metadata.json was not found").waitFor();
  await p2.goto(`${BASE_NO_MODEL}/#/performance`);
  await p2.getByText("Evaluation unavailable").waitFor();
  await shot("09-model-unavailable", p2);
  await p2.close();
});

await check("backend offline is reported", async () => {
  const p3 = await ctx.newPage();
  await p3.route("**/api/**", (route) => route.abort("connectionrefused"));
  await p3.goto(`${BASE}/#/analyze`);
  await p3.getByText("Backend offline").first().waitFor();
  await p3.close();
});

await check("mobile layout has no horizontal overflow", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const path of ["/", "/analyze", "/history", "/performance", "/about"]) {
    await m.goto(`${BASE}/#${path}`);
    await m.waitForTimeout(400);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
  }
  await m.goto(`${BASE}/#/analyze`);
  await m.locator('input[type="file"]').setInputFiles(join(IMG, "slice_a.jpg"));
  await m.getByText("Not analysed yet").waitFor();
  await shot("10-mobile", m);
  await m.close();
});

await check("keyboard: skip link and visible focus", async () => {
  await page.goto(`${BASE}/#/`);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert.notEqual(outline, "none");
});

await check("no console errors and no server internals in the page", async () => {
  assert.deepEqual(consoleErrors, []);
  const html = await page.content();
  assert.ok(!/Traceback|\/home\/|C:\\Users/.test(html));
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
