import { api } from "../api/client.ts";
import type { Evaluation } from "../api/types.ts";
import { ConfusionMatrix, LineChart, ReliabilityChart, SplitBars } from "../components/Charts.tsx";
import { EmptyState, Loading, Notice, ProblemNotice } from "../components/Common.tsx";
import { useBackend } from "../hooks/useBackend.tsx";
import { useFetch } from "../hooks/useFetch.ts";
import { dateTime, pct, score } from "../lib/format.ts";

const LABELS: Record<string, string> = { glioma: "Glioma", meningioma: "Meningioma", notumor: "No tumour", pituitary: "Pituitary" };

const LEAKAGE_ROWS: [string, string][] = [
  ["training_images_scanned", "Training images scanned"],
  ["training_removed_exact_match_in_test", "Removed: exact copy of a test image"],
  ["training_removed_near_match_in_test", "Removed: near-duplicate of a test image"],
  ["training_removed_label_conflicts", "Removed: same image under two classes"],
  ["training_pool_after_removal", "Training pool after removal"],
  ["groups_with_more_than_one_image", "Near-duplicate groups kept together"],
  ["largest_group_size", "Largest near-duplicate group"],
  ["test_exact_duplicate_images", "Exact duplicates inside the test set"],
  ["test_near_duplicate_pairs", "Near-duplicate pairs inside the test set"],
];

function Unavailable({ message }: { message?: string }) {
  return (
    <EmptyState title="Evaluation unavailable">
      <div className="stack">
        <p>{message ?? "No evaluation report has been generated for this installation. Numbers appear here only after a real evaluation run."}</p>
        <code className="codeblock">python -m ml.train --data-dir "C:\data\brain-tumor-mri-dataset"</code>
      </div>
    </EmptyState>
  );
}

function Report({ ev }: { ev: Evaluation }) {
  const test = ev.test!;
  const names = Object.fromEntries(test.per_class.map((c) => [c.class_id, c.label]));
  const history = ev.history ?? [];
  return (
    <div className="stack-lg">
      {ev.quick_run ? (
        <Notice tone="warning" title="These numbers come from a quick pipeline check">
          The model was trained on a small subset for one or two epochs to check that the code runs. Do not quote these results.
        </Notice>
      ) : null}
      {ev.version_mismatch ? (
        <Notice tone="warning" title="This report belongs to a different model version than the one loaded">
          Re-run <code>python -m ml.evaluate</code> to evaluate the loaded model.
        </Notice>
      ) : null}

      <section className="stack">
        <h2 className="section-title">Held-out test results</h2>
        <div className="metric-strip">
          <div className="metric">
            <div className="metric__value">{pct(test.accuracy)}</div>
            <div className="metric__label">Accuracy ({test.n} images)</div>
          </div>
          <div className="metric">
            <div className="metric__value">{pct(test.macro_f1)}</div>
            <div className="metric__label">Macro F1</div>
          </div>
          <div className="metric">
            <div className="metric__value">{pct(test.balanced_accuracy)}</div>
            <div className="metric__label">Balanced accuracy</div>
          </div>
          {test.tumour_vs_no_tumour ? (
            <>
              <div className="metric">
                <div className="metric__value">{pct(test.tumour_vs_no_tumour.sensitivity)}</div>
                <div className="metric__label">Sensitivity, any tumour</div>
              </div>
              <div className="metric">
                <div className="metric__value">{pct(test.tumour_vs_no_tumour.specificity)}</div>
                <div className="metric__label">Specificity, any tumour</div>
              </div>
            </>
          ) : null}
        </div>
        <p className="small muted">
          Measured once on the dataset's Testing folder after the model, temperature and review threshold were fixed using validation data. Internal test performance on one
          public dataset is not clinical performance and does not show how the model behaves on other scanners or hospitals.
        </p>
      </section>

      <section className="grid-2">
        <div className="stack">
          <h3 className="subhead">Per-class results</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col" className="num">
                    Precision
                  </th>
                  <th scope="col" className="num">
                    Recall
                  </th>
                  <th scope="col" className="num">
                    F1
                  </th>
                  <th scope="col" className="num">
                    Specificity
                  </th>
                  <th scope="col" className="num">
                    Images
                  </th>
                </tr>
              </thead>
              <tbody>
                {test.per_class.map((c) => (
                  <tr key={c.class_id}>
                    <th scope="row" style={{ fontWeight: 500 }}>
                      {c.label}
                    </th>
                    <td className="num">{score(c.precision)}</td>
                    <td className="num">{score(c.recall)}</td>
                    <td className="num">{score(c.f1)}</td>
                    <td className="num">{score(c.specificity)}</td>
                    <td className="num">{c.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {test.tumour_vs_no_tumour ? (
            <p className="xsmall muted">
              Tumour vs no tumour: {test.tumour_vs_no_tumour.tp} tumour images found, {test.tumour_vs_no_tumour.fn} missed, {test.tumour_vs_no_tumour.fp} no-tumour images
              flagged as tumour. {test.tumour_vs_no_tumour.note}
            </p>
          ) : null}
        </div>
        <div className="stack">
          <h3 className="subhead">Confusion matrix</h3>
          <ConfusionMatrix labels={test.confusion_matrix.labels} names={names} matrix={test.confusion_matrix.matrix} />
        </div>
      </section>

      {history.length ? (
        <section className="grid-2">
          <LineChart
            title="Loss by epoch"
            xLabels={history.map((h) => String(h.epoch))}
            phases={history.map((h) => h.phase)}
            series={[
              { name: "Training", color: "var(--series-train)", values: history.map((h) => h.loss) },
              { name: "Validation", color: "var(--series-val)", values: history.map((h) => h.val_loss) },
            ]}
            format={(v) => v.toFixed(2)}
          />
          <LineChart
            title="Accuracy by epoch"
            xLabels={history.map((h) => String(h.epoch))}
            phases={history.map((h) => h.phase)}
            yMin={Math.min(0.5, ...history.flatMap((h) => [h.accuracy, h.val_accuracy]))}
            yMax={1}
            series={[
              { name: "Training", color: "var(--series-train)", values: history.map((h) => h.accuracy) },
              { name: "Validation", color: "var(--series-val)", values: history.map((h) => h.val_accuracy) },
            ]}
            format={(v) => v.toFixed(2)}
          />
        </section>
      ) : null}

      {ev.candidates?.length ? (
        <section className="stack">
          <h2 className="section-title">Model comparison on validation data</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col" className="num">
                    Val. accuracy
                  </th>
                  <th scope="col" className="num">
                    Val. macro F1
                  </th>
                  <th scope="col" className="num">
                    Val. loss
                  </th>
                  <th scope="col" className="num">
                    Parameters
                  </th>
                  <th scope="col" className="num">
                    Epochs
                  </th>
                  <th scope="col" className="num">
                    Training time
                  </th>
                </tr>
              </thead>
              <tbody>
                {ev.candidates.map((c) => (
                  <tr key={c.name} aria-selected={c.name === ev.selected}>
                    <th scope="row" style={{ fontWeight: c.name === ev.selected ? 600 : 400 }}>
                      {c.architecture}
                      {c.name === ev.selected ? " (selected)" : ""}
                    </th>
                    <td className="num">{score(c.validation.accuracy)}</td>
                    <td className="num">{score(c.validation.macro_f1)}</td>
                    <td className="num">{score(c.validation.nll)}</td>
                    <td className="num">{c.parameters.toLocaleString()}</td>
                    <td className="num">{c.epochs_trained}</td>
                    <td className="num">{Math.round(c.train_seconds / 60)} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">{ev.selection_rule}</p>
        </section>
      ) : null}

      <section className="grid-2">
        {ev.calibration ? (
          <div className="stack">
            <h2 className="section-title">Calibration</h2>
            <ReliabilityChart bins={ev.calibration.test_reliability} title="Reliability on the test set (after temperature scaling)" />
            <dl className="facts">
              <dt>Temperature (fitted on validation)</dt>
              <dd className="num">{score(ev.calibration.temperature)}</dd>
              <dt>Test calibration error before</dt>
              <dd className="num">{score(ev.calibration.test_ece_before)}</dd>
              <dt>Test calibration error after</dt>
              <dd className="num">{score(ev.calibration.test_ece_after)}</dd>
            </dl>
          </div>
        ) : null}
        <div className="stack">
          {ev.decision ? (
            <>
              <h2 className="section-title">Review threshold</h2>
              <p className="small">
                Results with a top score below <b className="num">{score(ev.decision.review_threshold)}</b> are reported as inconclusive. The threshold was chosen on
                validation data to reach {pct(ev.decision.target_selective_accuracy, 0)} accuracy on the images it keeps
                {ev.decision.target_met === false ? " (the target was not reached, so the best available threshold was used)" : ""}.
              </p>
              <dl className="facts">
                <dt>Validation: images classified</dt>
                <dd className="num">{pct(ev.decision.coverage)}</dd>
                <dt>Test: images classified</dt>
                <dd className="num">{pct(ev.decision.test_coverage)}</dd>
                <dt>Test: accuracy of classified</dt>
                <dd className="num">{pct(ev.decision.test_selective_accuracy)}</dd>
                <dt>Test: images sent to inconclusive</dt>
                <dd className="num">{ev.decision.test_flagged_count}</dd>
                <dt>Test: accuracy among those</dt>
                <dd className="num">{pct(ev.decision.test_accuracy_of_flagged)}</dd>
              </dl>
              <p className="xsmall muted">An engineering setting for when to ask for review, not a clinical safety guarantee.</p>
            </>
          ) : null}
          {ev.ood ? (
            <>
              <h3 className="subhead" style={{ marginTop: "var(--s-5)" }}>
                Atypical-input detector
              </h3>
              <dl className="facts">
                <dt>Normal test slices flagged</dt>
                <dd className="num">{pct(ev.ood.test_flag_rate)}</dd>
              </dl>
              <p className="xsmall muted">{ev.ood.note}</p>
            </>
          ) : null}
        </div>
      </section>

      {ev.dataset ? (
        <section className="stack">
          <h2 className="section-title">Data and leakage checks</h2>
          <p className="small">
            {ev.dataset.name}. <a href={ev.dataset.source}>Source</a>. {ev.dataset.split_method}
          </p>
          <div className="grid-2">
            <SplitBars
              classes={ev.dataset.classes}
              names={{ ...LABELS, ...names }}
              splits={[
                { name: "Train", color: "var(--series-train)", counts: ev.dataset.split_counts.train },
                { name: "Validation", color: "var(--series-val)", counts: ev.dataset.split_counts.validation },
                { name: "Test", color: "var(--series-test)", counts: ev.dataset.split_counts.test },
              ]}
            />
            {ev.leakage ? (
              <div className="stack">
                <table className="table">
                  <tbody>
                    {LEAKAGE_ROWS.filter(([k]) => k in ev.leakage!).map(([k, label]) => (
                      <tr key={k}>
                        <th scope="row" style={{ fontWeight: 400 }}>
                          {label}
                        </th>
                        <td className="num">{String(ev.leakage![k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="xsmall muted">{String(ev.leakage.method ?? "")}</p>
                <p className="xsmall muted">{String(ev.leakage.note ?? "")}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="stack">
        <h2 className="section-title">Known limitations</h2>
        <ul className="small" style={{ maxWidth: "80ch" }}>
          <li>Single 2D slices only: no 3D context, no segmentation, no tumour size or location measurement.</li>
          <li>One public dataset assembled from several sources, with mixed planes and MRI sequences and no patient identifiers. Slices from one patient may still fall into both training and test sets.</li>
          <li>Four classes only. Other lesions, artefacts and post-surgical changes are not modelled and will be forced into one of the four classes unless a check flags them.</li>
          <li>The atypical-input detector was evaluated only on how often it flags normal test slices, not on its ability to catch non-MRI images.</li>
          <li>No external validation on data from other hospitals or scanners has been done.</li>
        </ul>
      </section>

      {ev.test_failures?.length ? (
        <details className="disclosure">
          <summary>Misclassified test images ({ev.test_failures.length} shown, highest score first)</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">True</th>
                  <th scope="col">Predicted</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">Flagged for review</th>
                </tr>
              </thead>
              <tbody>
                {ev.test_failures.map((f) => (
                  <tr key={f.path}>
                    <td className="xsmall">{f.path}</td>
                    <td>{names[f.true] ?? f.true}</td>
                    <td>{names[f.predicted] ?? f.predicted}</td>
                    <td className="num">{score(f.score)}</td>
                    <td>{f.would_be_flagged ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <section className="xsmall muted">
        {ev.created_at ? <p>Report created {dateTime(ev.created_at)}.</p> : null}
        {ev.re_evaluated_at ? <p>Test set re-evaluated {dateTime(ev.re_evaluated_at)}.</p> : null}
        {ev.serving_consistency ? <p>Serving check: {ev.serving_consistency.summary}.</p> : null}
        {ev.environment ? (
          <p>
            Environment: Python {ev.environment.python}, TensorFlow {ev.environment.tensorflow}, {ev.environment.platform}.
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function PerformancePage() {
  const backend = useBackend();
  const evaluation = useFetch((s) => api.evaluation(s), [backend.status, backend.info?.metadata?.model_version]);
  const meta = backend.info?.metadata;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Model performance</h1>
          <p className="page-lede">
            {meta ? `${meta.architecture}, version ${meta.model_version}.` : "No model is loaded."} Every number on this page is read from{" "}
            <code>model/evaluation.json</code>, written by the training script from real predictions.
          </p>
        </div>
      </header>
      {evaluation.loading && !evaluation.data ? (
        <Loading label="Loading evaluation" />
      ) : evaluation.data?.test ? (
        <Report ev={evaluation.data} />
      ) : evaluation.problem && evaluation.problem.code !== "evaluation_unavailable" ? (
        <ProblemNotice problem={evaluation.problem} />
      ) : (
        <Unavailable />
      )}
    </div>
  );
}
