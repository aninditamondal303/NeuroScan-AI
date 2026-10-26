// Bundles each tests/*.test.ts(x) with esbuild and runs it with Node's built-in
// test runner. No extra test framework is needed.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = join(root, "tests");
const outDir = join(root, "node_modules", ".cache", "neuroscan-tests");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entries = readdirSync(testsDir).filter((f) => /\.test\.tsx?$/.test(f));
if (entries.length === 0) {
  console.error("No tests found in", testsDir);
  process.exit(1);
}

await build({
  entryPoints: entries.map((f) => join(testsDir, f)),
  outdir: outDir,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  loader: { ".css": "empty" },
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

const files = readdirSync(outDir).filter((f) => f.endsWith(".mjs")).map((f) => join(outDir, f));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
