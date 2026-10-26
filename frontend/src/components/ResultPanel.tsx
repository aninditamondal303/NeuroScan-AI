import type { AnalysisResult } from "../api/types.ts";
import type { WorkspaceState } from "../lib/analysisMachine.ts";
import { resultHeadline, resultKind, score } from "../lib/format.ts";
import { KindMark, Notice, ProblemNotice } from "./Common.tsx";
import { Icon } from "./Icon.tsx";
import { ScoreBars } from "./ScoreBars.tsx";

export function UncertaintyFigures({ result }: { result: Pick<AnalysisResult, "uncertainty"> }) {
  const u = result.uncertainty;
  return (
    <div className="stack">
      <div className="mini-metrics">
        <div>
          <div className="mini-metrics__value">{score(u.top_score)}</div>
          <div className="mini-metrics__label">Top score</div>
        </div>
        <div>
          <div className="mini-metrics__value">{score(u.margin)}</div>
          <div className="mini-metrics__label">Margin to 2nd</div>
        </div>
        <div>
          <div className="mini-metrics__value">{score(u.normalized_entropy, 2)}</div>
          <div className="mini-metrics__label">Spread (0–1)</div>
        </div>
      </div>
      <p className="xsmall muted">
        Scores are softmax outputs after {u.calibration}. They describe the model's relative preference among four classes on this slice. They are not the probability that
        a patient has a tumour.
      </p>
    </div>
  );
}

export function ResultSummary({ result }: { result: AnalysisResult }) {
  const h = resultHeadline(result);
  const kind = resultKind(result);
  return (
    <div className="result-head" aria-live="polite">
      {kind === "inconclusive" ? <div className="inconclusive-band" aria-hidden="true" /> : null}
      <KindMark kind={kind} />
      <p className={`result-title${kind === "inconclusive" ? " result-title--inconclusive" : ""}`}>{h.title}</p>
      <p className="result-summary">{h.summary}</p>
      <p className="result-caveat">{h.caveat}</p>
    </div>
  );
}

interface PanelProps {
  state: WorkspaceState;
  modelReady: boolean;
  modelProblem: string | null;
  canAnalyze: boolean;
  explain: boolean;
  setExplain: (v: boolean) => void;
  onAnalyze: () => void;
  onCancel: () => void;
  onReport: () => void;
  onDownload: () => void;
  onAnother: () => void;
}

export function ResultPanel(p: PanelProps) {
  const { state } = p;
  const result = state.result;
  const busy = state.phase === "analyzing";

  return (
    <aside className="ws-report" aria-label="Analysis">
      <div className="ws-report__body">
        <h2 className="ws-title">Analysis</h2>

        {!p.modelReady ? (
          <Notice tone="warning" title="Analysis is disabled">
            {p.modelProblem ?? "The model is not ready."} <a href="#/about">See model checks</a>
          </Notice>
        ) : null}

        {state.phase === "idle" ? (
          <p className="small muted">Load a slice to begin. The image stays on this computer and is sent only to your local NeuroScan backend.</p>
        ) : null}
        {state.phase === "validating" ? <p className="small muted">Checking the file before analysis.</p> : null}
        {state.phase === "invalid" ? <p className="small muted">This file cannot be analysed. See the message on the left, then choose another image.</p> : null}
        {state.phase === "ready" ? (
          <p className="small muted">This slice has not been analysed yet. Nothing shown so far is a model output.</p>
        ) : null}

        {busy ? (
          <div className="stack" role="status">
            <div className="progress" aria-hidden="true" />
            <p className="small">Running the model on this slice. This usually takes a few seconds on a CPU.</p>
          </div>
        ) : null}

        {state.phase === "failed" && state.problem ? (
          <ProblemNotice
            problem={state.problem}
            action={
              <button type="button" className="btn" onClick={p.onAnalyze} disabled={!p.canAnalyze}>
                <Icon name="refresh" size={16} />
                Try again
              </button>
            }
          />
        ) : null}

        {result ? (
          <>
            <ResultSummary result={result} />
            {result.status === "classified" ? (
              <ScoreBars scores={result.scores} threshold={result.uncertainty.review_threshold} caption="Score for each class" />
            ) : (
              <>
                <div className="stack">
                  <p className="subhead">Why no class is reported</p>
                  {result.reasons.map((r) => (
                    <Notice key={r.code} tone="warning">
                      {r.message}
                    </Notice>
                  ))}
                </div>
                <details className="disclosure">
                  <summary>Show the model's scores anyway</summary>
                  <ScoreBars scores={result.scores} threshold={result.uncertainty.review_threshold} muted caption="Scores (not a classification)" />
                </details>
              </>
            )}
            <UncertaintyFigures result={result} />
            {result.warnings.length ? (
              <div className="stack">
                <p className="subhead">Notes about this input</p>
                {result.warnings.map((w, i) => (
                  <Notice key={`${w.code}-${i}`} tone="plain">
                    {w.message}
                  </Notice>
                ))}
              </div>
            ) : null}
            {result.explanation.status !== "available" && result.explanation.status !== "not_requested" ? (
              <p className="xsmall muted">Heatmap: {result.explanation.note}</p>
            ) : null}
            <p className="xsmall muted num">
              {result.analysis_id}, model {result.model.version}, {Math.round(result.timing.total_ms)} ms
              {result.uncertainty.ood_distance !== null ? `, feature distance ${result.uncertainty.ood_distance.toFixed(1)} (limit ${result.uncertainty.ood_threshold?.toFixed(1)})` : ""}
            </p>
          </>
        ) : null}
      </div>

      <div className="ws-report__foot">
        {result ? (
          <>
            <button type="button" className="btn btn--primary" onClick={p.onReport}>
              <Icon name="printer" size={16} />
              Open report
            </button>
            <div className="row">
              <button type="button" className="btn" onClick={p.onDownload} style={{ flex: 1 }}>
                <Icon name="download" size={16} />
                Result data
              </button>
              <button type="button" className="btn" onClick={p.onAnother} style={{ flex: 1 }}>
                Analyse another
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="check">
              <input type="checkbox" checked={p.explain} onChange={(e) => p.setExplain(e.target.checked)} disabled={busy} />
              <span>Compute a Grad-CAM heatmap (adds a second or two)</span>
            </label>
            {busy ? (
              <button type="button" className="btn btn--large" onClick={p.onCancel}>
                Cancel analysis
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--large" onClick={p.onAnalyze} disabled={!p.canAnalyze}>
                Analyze MRI
              </button>
            )}
            <p className="xsmall muted">A high score is not a probability of disease. Read the notes that come with every result.</p>
          </>
        )}
      </div>
    </aside>
  );
}
