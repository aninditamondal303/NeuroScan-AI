// Small, dependency-free charts. Every chart is drawn only from values passed
// in (from model/evaluation.json); none has defaults or sample data.

import { useState, type ReactNode } from "react";
import type { ReliabilityBin } from "../api/types.ts";

const W = 560;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

/** Evenly spaced round tick values (steps of 1, 2, 2.5 or 5 x 10^n) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const raw = (hi - lo) / target || 1;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * exp >= raw) ?? 10) * exp;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className="chart-tooltip" style={{ left: `${(x / W) * 100}%`, top: y, transform: "translate(-50%, -110%)" }}>
      {children}
    </div>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
}

/** Multi-series line chart with crosshair + tooltip; vertical rules mark phase changes. */
export function LineChart({
  title,
  series,
  xLabels,
  phases,
  yMin,
  yMax,
  format,
}: {
  title: string;
  series: LineSeries[];
  xLabels: string[];
  phases?: string[];
  yMin?: number;
  yMax?: number;
  format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const m = { l: 44, r: 92, t: 12, b: 28 };
  const n = xLabels.length;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (n === 0 || all.length === 0) return null;
  const lo = yMin ?? Math.min(0, ...all);
  const hi = yMax ?? niceMax(Math.max(...all));
  const x = (i: number) => m.l + (n === 1 ? 0 : (i / (n - 1)) * (W - m.l - m.r));
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const ticks = niceTicks(lo, hi);
  const phaseBreaks = phases ? phases.map((p, i) => (i > 0 && p !== phases[i - 1] ? i : -1)).filter((i) => i > 0) : [];

  return (
    <figure className="chart-box">
      <figcaption className="subhead">{title}</figcaption>
      <div className="chart-legend" style={{ marginBottom: 6 }}>
        {series.map((s) => (
          <span key={s.name}>
            <span className="chart-legend__key" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {phaseBreaks.map((i) => (
          <g key={`p${i}`}>
            <line x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={m.t} y2={H - m.b} stroke="var(--rule-strong)" />
            <text x={(x(i - 1) + x(i)) / 2 + 4} y={m.t + 10}>
              {phases![i]}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % Math.max(1, Math.ceil(n / 10)) === 0 || i === n - 1 ? (
            <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
          const last = s.values.length - 1;
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(last)} cy={y(s.values[last])} r={4} fill={s.color} stroke="var(--paper)" strokeWidth={2} />
            </g>
          );
        })}
        {(() => {
          // End labels; skip them when the two ends are too close to read apart.
          const ends = series.map((s) => ({ s, yy: y(s.values[s.values.length - 1]) }));
          const clash = ends.length === 2 && Math.abs(ends[0].yy - ends[1].yy) < 14;
          return clash
            ? null
            : ends.map(({ s, yy }) => (
                <text key={`l${s.name}`} className="chart__label" x={W - m.r + 8} y={yy + 4}>
                  {s.name} {format(s.values[s.values.length - 1])}
                </text>
              ));
        })()}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={H - m.b} stroke="var(--ink-3)" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="var(--paper)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
      </svg>
      {hover !== null ? (
        <Tooltip x={x(hover)} y={20}>
          Epoch {xLabels[hover]}
          {phases ? ` (${phases[hover]})` : ""}
          {series.map((s) => (
            <div key={s.name}>
              {s.name}: {format(s.values[hover])}
            </div>
          ))}
        </Tooltip>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Epoch</th>
            {series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xLabels.map((l, i) => (
            <tr key={l + i}>
              <td>{l}</td>
              {series.map((s) => (
                <td key={s.name}>{format(s.values[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Rows: true class. Columns: predicted class. Shade = share of the row. */
export function ConfusionMatrix({ labels, names, matrix }: { labels: string[]; names: Record<string, string>; matrix: number[][] }) {
  return (
    <div className="table-wrap">
      <table className="matrix">
        <caption className="xsmall muted" style={{ captionSide: "bottom", textAlign: "left", paddingTop: 8 }}>
          Rows are the true class; columns are the model's prediction. Each cell shows the image count and its share of the row (recall on the diagonal).
        </caption>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {labels.map((l) => (
              <th key={l} scope="col">
                {names[l] ?? l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={labels[i]}>
                <th scope="row">{names[labels[i]] ?? labels[i]}</th>
                {row.map((v, j) => {
                  const share = v / total;
                  return (
                    <td
                      key={j}
                      title={`True ${names[labels[i]] ?? labels[i]}, predicted ${names[labels[j]] ?? labels[j]}: ${v} images (${(share * 100).toFixed(1)}% of row)`}
                      style={{
                        background: `color-mix(in oklab, var(--teal-600) ${Math.round(share * 100)}%, var(--paper))`,
                        color: share > 0.5 ? "#fff" : "var(--ink)",
                        fontWeight: i === j ? 600 : 400,
                      }}
                    >
                      {v}
                      <small>{(share * 100).toFixed(1)}%</small>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Mean top-class score against observed accuracy, per bin; the diagonal is perfect calibration. */
export function ReliabilityChart({ bins, title }: { bins: ReliabilityBin[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const S = 340;
  const m = { l: 40, r: 12, t: 10, b: 34 };
  const px = (v: number) => m.l + v * (S - m.l - m.r);
  const py = (v: number) => m.t + (1 - v) * (S - m.t - m.b);
  const pts = bins.map((b, i) => ({ ...b, i })).filter((b) => b.count > 0 && b.confidence !== null && b.accuracy !== null);
  return (
    <figure className="chart-box" style={{ maxWidth: 340 }}>
      <figcaption className="subhead">{title}</figcaption>
      <svg className="chart" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={m.l} x2={S - m.r} y1={py(t)} y2={py(t)} stroke="var(--grid)" />
            <text x={m.l - 6} y={py(t) + 4} textAnchor="end">
              {t}
            </text>
            <text x={px(t)} y={S - 12} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} stroke="var(--graphite-400)" />
        <path d={pts.map((b, k) => `${k ? "L" : "M"}${px(b.confidence!)},${py(b.accuracy!)}`).join("")} fill="none" stroke="var(--series-test)" strokeWidth={2} />
        {pts.map((b) => (
          <circle
            key={b.i}
            cx={px(b.confidence!)}
            cy={py(b.accuracy!)}
            r={hover === b.i ? 6 : 4}
            fill="var(--series-test)"
            stroke="var(--paper)"
            strokeWidth={2}
            onMouseEnter={() => setHover(b.i)}
          >
            <title>{`Scores ${b.lower.toFixed(1)}–${b.upper.toFixed(1)}: mean score ${b.confidence!.toFixed(3)}, accuracy ${b.accuracy!.toFixed(3)}, ${b.count} images`}</title>
          </circle>
        ))}
        <text x={S / 2 + 10} y={S} textAnchor="middle">
          mean top score
        </text>
      </svg>
      <p className="xsmall muted">Grey line: perfect calibration. Points below it mean the model was overconfident at that score.</p>
      {hover !== null ? (
        <p className="xsmall num" aria-live="polite">
          {(() => {
            const b = bins[hover];
            return `Scores ${b.lower.toFixed(1)}–${b.upper.toFixed(1)}: mean ${b.confidence?.toFixed(3)}, accuracy ${b.accuracy?.toFixed(3)}, ${b.count} images`;
          })()}
        </p>
      ) : null}
    </figure>
  );
}

/** Grouped columns: images per class in each split. */
export function SplitBars({
  classes,
  names,
  splits,
}: {
  classes: string[];
  names: Record<string, string>;
  splits: { name: string; color: string; counts: Record<string, number> }[];
}) {
  const [hover, setHover] = useState<{ c: number; s: number } | null>(null);
  const H = 220;
  const m = { l: 44, r: 8, t: 12, b: 30 };
  const max = niceMax(Math.max(...splits.flatMap((s) => classes.map((c) => s.counts[c] ?? 0))));
  const band = (W - m.l - m.r) / classes.length;
  const barW = Math.min(24, (band * 0.7) / splits.length);
  const y = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b);
  const ticks = [0, max / 2, max];
  return (
    <figure className="chart-box">
      <figcaption className="subhead">Images per class in each split</figcaption>
      <div className="chart-legend" style={{ marginBottom: 6 }}>
        {splits.map((s) => (
          <span key={s.name}>
            <span className="chart-legend__key" style={{ background: s.color, height: 10, width: 10 }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Images per class in each split" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {classes.map((c, ci) => {
          const groupW = splits.length * barW + (splits.length - 1) * 2;
          const x0 = m.l + ci * band + (band - groupW) / 2;
          return (
            <g key={c}>
              {splits.map((s, si) => {
                const v = s.counts[c] ?? 0;
                const bx = x0 + si * (barW + 2);
                const top = y(v);
                const h = Math.max(0, y(0) - top);
                const r = Math.min(4, h, barW / 2);
                const d = `M${bx},${y(0)}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + barW - r}Q${bx + barW},${top} ${bx + barW},${top + r}V${y(0)}Z`;
                return (
                  <g key={s.name} onMouseEnter={() => setHover({ c: ci, s: si })}>
                    <rect x={bx - 1} y={m.t} width={barW + 2} height={H - m.t - m.b} fill="transparent" />
                    <path d={d} fill={s.color} opacity={hover && (hover.c !== ci || hover.s !== si) ? 0.55 : 1} />
                  </g>
                );
              })}
              <text x={m.l + ci * band + band / 2} y={H - 10} textAnchor="middle" className="chart__label">
                {names[c] ?? c}
              </text>
            </g>
          );
        })}
      </svg>
      {hover ? (
        <Tooltip x={m.l + hover.c * band + band / 2} y={20}>
          {names[classes[hover.c]] ?? classes[hover.c]}, {splits[hover.s].name}: {splits[hover.s].counts[classes[hover.c]] ?? 0} images
        </Tooltip>
      ) : null}
      <table className="sr-only">
        <caption>Images per class in each split</caption>
        <thead>
          <tr>
            <th>Class</th>
            {splits.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c}>
              <td>{names[c] ?? c}</td>
              {splits.map((s) => (
                <td key={s.name}>{s.counts[c] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
