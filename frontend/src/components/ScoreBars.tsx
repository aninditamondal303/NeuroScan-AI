import type { ClassScore } from "../api/types.ts";

/**
 * Class scores as horizontal bars on a fixed 0-1 axis, in the model's class
 * order. A dashed line marks the review threshold chosen on validation data.
 */
export function ScoreBars({
  scores,
  threshold,
  muted = false,
  caption,
}: {
  scores: ClassScore[];
  threshold?: number | null;
  muted?: boolean;
  caption: string;
}) {
  const ordered = [...scores].sort((a, b) => a.index - b.index);
  const top = Math.max(...ordered.map((s) => s.score));
  return (
    <figure className="scores">
      <figcaption className="subhead">{caption}</figcaption>
      {ordered.map((s, i) => {
        const isTop = s.score === top;
        return (
          <div className="score-row" key={s.class_id} title={`${s.label}: ${s.score.toFixed(4)} (uncalibrated ${s.raw_score.toFixed(4)})`}>
            <span className={`score-row__label${isTop ? " score-row__label--top" : ""}`}>{s.label}</span>
            <span className="score-row__track" aria-hidden="true">
              <span className={`score-row__bar${muted ? " score-row__bar--muted" : ""}`} style={{ width: `${Math.max(0, Math.min(1, s.score)) * 100}%`, animationDelay: `${i * 70}ms` }} />
              {threshold ? <span className="score-row__threshold" style={{ left: `${threshold * 100}%` }} /> : null}
            </span>
            <span className={`score-row__value${isTop ? " score-row__label--top" : ""}`}>{s.score.toFixed(3)}</span>
          </div>
        );
      })}
      <div className="score-axis" aria-hidden="true">
        <span />
        <span className="score-axis__ticks">
          <span>0</span>
          <span>0.5</span>
          <span>1</span>
        </span>
        <span />
      </div>
      {threshold ? (
        <p className="xsmall muted">Dashed line: review threshold {threshold.toFixed(3)}. Below it, a result is reported as inconclusive.</p>
      ) : null}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Class</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.class_id}>
              <td>{s.label}</td>
              <td>{s.score.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
