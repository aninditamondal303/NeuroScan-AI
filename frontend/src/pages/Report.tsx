import { useEffect, useState } from "react";
import { api, ApiProblem, type Problem } from "../api/client.ts";
import type { AnalysisResult, HistoryEntry } from "../api/types.ts";
import { EmptyState, KindMark, Loading, ProblemNotice } from "../components/Common.tsx";
import { Icon } from "../components/Icon.tsx";
import { UncertaintyFigures } from "../components/ResultPanel.tsx";
import { ScoreBars } from "../components/ScoreBars.tsx";
import { useWorkspace } from "../hooks/useWorkspace.tsx";
import { bytes, dateTime } from "../lib/format.ts";
import { buildReport, downloadText, reportJson } from "../lib/report.ts";
import { href, navigate } from "../lib/router.ts";

export function ReportPage({ id }: { id: string }) {
  const ws = useWorkspace();
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const isCurrent = id === "current";

  useEffect(() => {
    if (isCurrent) return;
    const ctrl = new AbortController();
    setEntry(null);
    setProblem(null);
    api
      .historyEntry(id, ctrl.signal)
      .then(setEntry)
      .catch((e) => {
        if (e instanceof ApiProblem && e.problem.kind !== "aborted") setProblem(e.problem);
      });
    return () => ctrl.abort();
  }, [id, isCurrent]);

  if (isCurrent && !ws.state.result) {
    return (
      <div className="page">
        <EmptyState
          title="No result to report"
          action={
            <a className="btn btn--primary" href={href("/analyze")}>
              Go to New analysis
            </a>
          }
        >
          The current report only exists while its analysis is open in this tab. Saved results can be reopened from History.
        </EmptyState>
      </div>
    );
  }
  if (!isCurrent && problem) {
    return (
      <div className="page">
        <ProblemNotice problem={problem} />
      </div>
    );
  }
  const source: AnalysisResult | HistoryEntry | null = isCurrent ? ws.state.result : entry;
  if (!source) {
    return (
      <div className="page">
        <Loading label="Loading report" />
      </div>
    );
  }

  const filename = isCurrent ? (ws.state.image?.file.name ?? null) : null;
  const report = buildReport(source, filename);
  const imageUrl = isCurrent ? ws.state.image?.url : null;
  const current = isCurrent ? ws.state.result : null;
  const overlay = current?.explanation.status === "available" ? current.explanation.overlay_png : null;

  return (
    <div className="page">
      <div className="report-actions">
        <div className="row">
          {isCurrent ? (
            <button type="button" className="btn" onClick={() => navigate("/analyze")}>
              <Icon name="back" size={16} />
              Back to viewer
            </button>
          ) : (
            <a className="btn" href={href(`/history/${encodeURIComponent(report.analysisId)}`)}>
              <Icon name="back" size={16} />
              Back to history
            </a>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              ws.remove();
              navigate("/analyze");
            }}
          >
            Analyse another image
          </button>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => downloadText(`${report.analysisId}.json`, reportJson(source, filename))}>
            <Icon name="download" size={16} />
            Download data
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <Icon name="printer" size={16} />
            Print or save as PDF
          </button>
        </div>
      </div>

      <article className="report stack-lg" aria-label="Analysis report">
        <header className="report__head">
          <div>
            <p className="small muted">NeuroScan AI research report (not a certified medical report)</p>
            <h1 className="page-title" style={{ marginTop: 6 }}>
              Analysis {report.analysisId}
            </h1>
          </div>
          <dl className="facts" style={{ alignSelf: "end" }}>
            <dt>Created</dt>
            <dd>{dateTime(report.createdAt)}</dd>
            <dt>Model</dt>
            <dd>{report.model.version}</dd>
          </dl>
        </header>

        <section className="stack">
          <KindMark kind={report.kind} />
          <p className="result-title" style={{ fontSize: "var(--t-2xl)" }}>
            {report.headline.title}
          </p>
          <p>{report.headline.summary}</p>
          <p className="muted small">{report.headline.caveat}</p>
        </section>

        {imageUrl ? (
          <section className="report__images">
            <figure className="report__figure">
              <div className="report__img-box">
                <img src={imageUrl} alt="Uploaded MRI slice" />
              </div>
              <figcaption>Uploaded slice, as provided</figcaption>
            </figure>
            <figure className="report__figure">
              <div className="report__img-box">
                <img src={imageUrl} alt="" />
                {overlay ? <img src={overlay} alt="Grad-CAM heatmap overlay" style={{ opacity: 0.6 }} /> : null}
              </div>
              <figcaption>{overlay ? "Grad-CAM overlay for the predicted class. Regions of influence, not a tumour outline." : "No heatmap for this result."}</figcaption>
            </figure>
          </section>
        ) : (
          <p className="small muted">The image is not stored with saved results, so this report contains no images.</p>
        )}

        <section className="grid-2">
          <div className="stack">
            <ScoreBars
              scores={source.scores}
              threshold={source.uncertainty.review_threshold}
              muted={source.status !== "classified"}
              caption={source.status === "classified" ? "Score for each class" : "Scores (not a classification)"}
            />
          </div>
          <div className="stack">
            <p className="subhead">Uncertainty</p>
            <UncertaintyFigures result={source} />
          </div>
        </section>

        {report.reasons.length ? (
          <section className="stack">
            <p className="subhead">Why the result is inconclusive</p>
            <ul className="small">
              {report.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="grid-2">
          <div>
            <p className="subhead">Image</p>
            <dl className="facts">
              {report.image.filename ? (
                <>
                  <dt>File name</dt>
                  <dd>{report.image.filename}</dd>
                </>
              ) : null}
              <dt>Format</dt>
              <dd>{report.image.format}</dd>
              <dt>Pixels</dt>
              <dd className="num">
                {report.image.width} × {report.image.height}
              </dd>
              <dt>File size</dt>
              <dd>{bytes(report.image.size_bytes)}</dd>
              <dt>Colour mode</dt>
              <dd>{report.image.mode}</dd>
            </dl>
          </div>
          <div>
            <p className="subhead">Model</p>
            <dl className="facts">
              <dt>Version</dt>
              <dd>{report.model.version}</dd>
              <dt>Architecture</dt>
              <dd>{report.model.architecture}</dd>
              <dt>Review threshold</dt>
              <dd className="num">{report.uncertainty.review_threshold.toFixed(3)}</dd>
            </dl>
          </div>
        </section>

        {report.warnings.length ? (
          <section className="stack">
            <p className="subhead">Notes about this input</p>
            <ul className="small">
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="stack">
          <p className="subhead">Limitations</p>
          <ul className="small">
            <li>The model analyses one 2D slice. It does not see the rest of the scan, other sequences, contrast phases or clinical history.</li>
            <li>It was trained and tested on one public dataset of JPEG slices. Its accuracy on images from other scanners or hospitals is unknown.</li>
            <li>It chooses among four classes only. Other abnormalities are not detected and may be assigned to any class.</li>
            {report.explanationNote ? <li>{report.explanationNote}</li> : null}
          </ul>
        </section>

        <p className="small" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
          {report.disclaimer}
        </p>
      </article>
    </div>
  );
}
