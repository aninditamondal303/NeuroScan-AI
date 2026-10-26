import { api } from "../api/client.ts";
import { EmptyState, KindMark, Notice } from "../components/Common.tsx";
import { ModelStatus } from "../components/ModelStatus.tsx";
import { useBackend } from "../hooks/useBackend.tsx";
import { useFetch } from "../hooks/useFetch.ts";
import { dateTime, pct, resultKind } from "../lib/format.ts";
import { href } from "../lib/router.ts";

export function OverviewPage() {
  const backend = useBackend();
  const meta = backend.info?.metadata;
  const evaluation = useFetch((s) => api.evaluation(s), [backend.status, meta?.model_version]);
  const history = useFetch((s) => api.history(s), [backend.status]);
  const ev = evaluation.data;
  const classes = meta?.classes ?? null;
  const limits = backend.info?.limits;

  return (
    <div className="page">
      <section className="overview-hero">
        <div>
          <h1 className="overview-hero__title">Read a single brain MRI slice with a model you can inspect.</h1>
          <p className="overview-hero__lede">
            NeuroScan sorts one 2D slice into glioma, meningioma, pituitary tumour or no tumour, shows the score for every class, and says when it cannot decide. It is a
            research and teaching prototype, not a diagnostic device.
          </p>
          <div className="row" style={{ marginTop: "var(--s-5)" }}>
            <a className="btn btn--primary btn--large" href={href("/analyze")}>
              Start MRI analysis
            </a>
            <a className="btn btn--large" href={href("/performance")}>
              See how it was tested
            </a>
          </div>
        </div>

        <div className="sheet sheet__pad stack">
          <p className="subhead">Model service</p>
          <div style={{ color: "var(--ink)" }}>
            <ModelStatus />
          </div>
          {meta ? (
            <dl className="facts">
              <dt>Version</dt>
              <dd>{meta.model_version}</dd>
              <dt>Architecture</dt>
              <dd>{meta.architecture}</dd>
              <dt>Loaded</dt>
              <dd>{dateTime(backend.info?.loaded_at)}</dd>
              <dt>Dataset</dt>
              <dd>{meta.dataset.name}</dd>
            </dl>
          ) : backend.status === "model_unavailable" ? (
            <p className="small muted">
              No trained model is loaded, so analysis is turned off. <a href={href("/about")}>See what is missing</a>.
            </p>
          ) : backend.status === "offline" ? (
            <p className="small muted">The backend is not running. Start it to enable analysis.</p>
          ) : null}
          {meta?.quick_run ? (
            <Notice tone="warning" title="Quick test model">
              This model came from a shortened pipeline check. Its results are not meaningful.
            </Notice>
          ) : null}
        </div>
      </section>

      <div className="grid-3" style={{ marginBottom: "var(--s-6)" }}>
        <section className="stack">
          <h2 className="section-title">What it accepts</h2>
          <p className="small">One greyscale 2D brain MRI slice per analysis, as PNG, JPEG or WebP.</p>
          <dl className="facts">
            <dt>Largest file</dt>
            <dd>{limits ? `${Math.round(limits.max_upload_bytes / (1024 * 1024))} MB` : "10 MB"}</dd>
            <dt>Image size</dt>
            <dd>
              {limits ? `${limits.min_side} to ${limits.max_side}` : "64 to 8192"} px per side
            </dd>
            <dt>Not supported</dt>
            <dd>DICOM, NIfTI, 3D volumes, photographs</dd>
          </dl>
          <p className="subhead" style={{ marginTop: "var(--s-4)" }}>
            Classes the loaded model can output
          </p>
          {classes ? (
            <ul className="class-list" style={{ marginTop: 0 }}>
              {classes.map((c) => (
                <li key={c.id}>{c.label}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Shown once a trained model is loaded.</p>
          )}
        </section>

        <section className="stack">
          <h2 className="section-title">Measured on held-out images</h2>
          {ev?.test ? (
            <>
              <div className="metric-strip">
                <div className="metric">
                  <div className="metric__value">{pct(ev.test.accuracy)}</div>
                  <div className="metric__label">Test accuracy</div>
                </div>
                <div className="metric">
                  <div className="metric__value">{pct(ev.test.macro_f1)}</div>
                  <div className="metric__label">Macro F1</div>
                </div>
                {ev.test.tumour_vs_no_tumour ? (
                  <>
                    <div className="metric">
                      <div className="metric__value">{pct(ev.test.tumour_vs_no_tumour.sensitivity)}</div>
                      <div className="metric__label">Tumour sensitivity</div>
                    </div>
                    <div className="metric">
                      <div className="metric__value">{pct(ev.test.tumour_vs_no_tumour.specificity)}</div>
                      <div className="metric__label">Tumour specificity</div>
                    </div>
                  </>
                ) : null}
              </div>
              <p className="xsmall muted">
                {ev.test.n} images from the dataset's Testing folder, never used for training or tuning. This is internal test performance on one public dataset, not
                clinical accuracy.
              </p>
              {ev.quick_run ? <Notice tone="warning" title="From a quick pipeline check, not a full training run." /> : null}
              <a href={href("/performance")} className="small">
                Full evaluation
              </a>
            </>
          ) : (
            <EmptyState title="Evaluation unavailable">
              {evaluation.loading ? "Loading…" : "No evaluation report exists yet. It is created when you train a model with ml/train.py."}
            </EmptyState>
          )}
        </section>

        <section className="stack">
          <h2 className="section-title">Recent analyses</h2>
          {history.data && history.data.length ? (
            <ul className="recent">
              {history.data.slice(0, 5).map((h) => (
                <li key={h.analysis_id}>
                  <a href={href(`/history/${encodeURIComponent(h.analysis_id)}`)} className="num">
                    {h.analysis_id}
                  </a>
                  <KindMark kind={resultKind(h)} />
                  <span className="xsmall muted">{dateTime(h.created_at)}</span>
                  <span className="xsmall">{h.prediction?.label ?? "No class reported"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No analyses yet">
              {history.problem ? history.problem.message : "Results you run appear here. Images are never stored."}
            </EmptyState>
          )}
        </section>
      </div>

      <section>
        <h2 className="section-title">How an analysis works</h2>
        <ol className="steps">
          <li>
            <p className="subhead">Load a slice</p>
            <p className="small muted">The file is checked by its contents, not its name. It is shown at real pixel size with rulers and a pixel readout.</p>
          </li>
          <li>
            <p className="subhead">Run the model</p>
            <p className="small muted">Your local backend converts the slice to grey, pads it to a square, resizes it and runs the trained model on your CPU.</p>
          </li>
          <li>
            <p className="subhead">Review scores and warnings</p>
            <p className="small muted">You see every class score, how certain the model is, a Grad-CAM heatmap, and an inconclusive result when checks fail.</p>
          </li>
        </ol>
      </section>
    </div>
  );
}
