import { MedicalDisclaimer, Notice, ProblemNotice } from "../components/Common.tsx";
import { Icon } from "../components/Icon.tsx";
import { ModelStatus } from "../components/ModelStatus.tsx";
import { useBackend } from "../hooks/useBackend.tsx";
import { dateTime } from "../lib/format.ts";

export function AboutPage() {
  const backend = useBackend();
  const info = backend.info;
  const meta = info?.metadata;
  const limits = info?.limits;

  return (
    <div className="page stack-lg">
      <header>
        <h1 className="page-title">About and status</h1>
        <p className="page-lede">How this installation is set up, what it checks before it will analyse an image, and how your data is handled.</p>
      </header>

      <div className="grid-2">
        <section className="sheet">
          <div className="sheet__head">
            <h2 className="sheet__title">Model readiness</h2>
            <button type="button" className="btn" onClick={() => void backend.reload()} disabled={backend.reloading || backend.status === "offline"}>
              <Icon name="refresh" size={16} />
              {backend.reloading ? "Reloading…" : "Reload model"}
            </button>
          </div>
          <div className="sheet__pad stack">
            <div style={{ color: "var(--ink)" }}>
              <ModelStatus />
            </div>
            {backend.status === "offline" && backend.problem ? <ProblemNotice problem={backend.problem} /> : null}
            {info ? (
              <ul className="check-list" aria-label="Readiness checks">
                {info.checks.map((c) => (
                  <li key={c.id}>
                    <span className={c.passed ? "check-list__ok" : "check-list__fail"}>
                      <Icon name={c.passed ? "check" : "x"} size={16} title={c.passed ? "Passed" : "Failed"} />
                    </span>
                    <span>
                      <b style={{ fontWeight: 600 }}>{c.label}</b>
                      <br />
                      <span className="muted">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {info && !info.ready ? (
              <Notice tone="info" title="Analysis stays off until every check passes">
                The app never falls back to another model or to made-up results. Train a model (see below), then press Reload model.
              </Notice>
            ) : null}
            <p className="xsmall muted">Last checked {backend.lastChecked ? dateTime(backend.lastChecked.toISOString()) : "never"}.</p>
          </div>
        </section>

        <section className="sheet sheet__pad stack">
          <h2 className="sheet__title">This installation</h2>
          <dl className="facts">
            <dt>App version</dt>
            <dd>{info?.app_version ?? "unknown"}</dd>
            <dt>Model version</dt>
            <dd>{meta?.model_version ?? "none loaded"}</dd>
            <dt>Architecture</dt>
            <dd>{meta?.architecture ?? "n/a"}</dd>
            <dt>Framework</dt>
            <dd>{meta?.framework ?? "n/a"}</dd>
            <dt>Model input</dt>
            <dd>{meta ? `${meta.input.width} × ${meta.input.height} px, greyscale copied to 3 channels, padded to square` : "n/a"}</dd>
            <dt>Preprocessing</dt>
            <dd>{meta?.preprocessing.id ?? "n/a"}</dd>
            <dt>Explanations</dt>
            <dd>{meta?.explainability ? `Grad-CAM on layer ${meta.explainability.layer}` : "n/a"}</dd>
            <dt>File formats</dt>
            <dd>{limits ? limits.formats.join(", ") : "PNG, JPEG, WEBP"}</dd>
            <dt>Largest upload</dt>
            <dd>{limits ? `${Math.round(limits.max_upload_bytes / (1024 * 1024))} MB` : "10 MB"}</dd>
            <dt>Image size</dt>
            <dd>{limits ? `${limits.min_side} to ${limits.max_side} px per side, at most ${(limits.max_pixels / 1e6).toFixed(0)} megapixels` : "n/a"}</dd>
            <dt>History</dt>
            <dd>{info ? (info.history_enabled ? "On (local SQLite file)" : "Off") : "n/a"}</dd>
          </dl>
        </section>
      </div>

      <div className="grid-2">
        <section className="stack">
          <h2 className="section-title">Your data</h2>
          <ul className="small">
            <li>Images go only to the NeuroScan backend running on your computer. No image is sent to any third-party service.</li>
            <li>The backend analyses the image in memory and does not save it. Heatmaps are sent back to your browser and not stored.</li>
            <li>
              History stores results only, in <code>backend/data/history.db</code>: ID, time, result, scores, image format and size, and model version. File names are not
              stored because they often contain patient details. Delete entries in History, or delete the file.
            </li>
            <li>This is not a medical records system. Do not upload images that identify a patient.</li>
            <li>The interface loads its two typefaces from Google Fonts; nothing about your images is included in those requests.</li>
          </ul>
        </section>
        <section className="stack">
          <h2 className="section-title">Run it locally (Windows PowerShell)</h2>
          <p className="small">Terminal 1, from the project folder:</p>
          <code className="codeblock">{`.\\.venv\\Scripts\\Activate.ps1\nuvicorn backend.app.main:app --port 8000`}</code>
          <p className="small">Terminal 2:</p>
          <code className="codeblock">{`cd frontend\nnpm run dev`}</code>
          <p className="small">
            Then open <code>http://localhost:5173</code>. Full setup, training and testing steps are in <code>README.md</code>.
          </p>
        </section>
      </div>

      <MedicalDisclaimer />
    </div>
  );
}
