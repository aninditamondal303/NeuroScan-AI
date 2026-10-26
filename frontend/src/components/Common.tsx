import type { ReactNode } from "react";
import type { Problem } from "../api/client.ts";
import { RESULT_KIND_LABEL, RESULT_KIND_SHORT, type ResultKind } from "../lib/format.ts";
import { Icon } from "./Icon.tsx";

type Tone = "info" | "warning" | "error" | "plain";

export function Notice({ tone, title, children }: { tone: Tone; title?: ReactNode; children?: ReactNode }) {
  const icon = tone === "error" || tone === "warning" ? "alert" : "about";
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : undefined}>
      <span className="notice__icon">
        <Icon name={icon} size={16} />
      </span>
      <div>
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div className={title ? "muted" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}

export function ProblemNotice({ problem, action }: { problem: Problem; action?: ReactNode }) {
  return (
    <Notice tone="error" title={problem.message}>
      {problem.hint ? <p>{problem.hint}</p> : null}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </Notice>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children ? <div className="small muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function KindMark({ kind, short = false }: { kind: ResultKind; short?: boolean }) {
  return (
    <span className={`kind kind--${kind}`}>
      <span className="kind__shape" aria-hidden="true" />
      {short ? RESULT_KIND_SHORT[kind] : RESULT_KIND_LABEL[kind]}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="stack">
      <span className="sr-only">{label}</span>
      <Skeleton />
    </div>
  );
}

export function MedicalDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <Notice tone="plain" title="Research and education prototype">
      {compact
        ? "Not a medical device. Do not use for diagnosis or treatment decisions."
        : "NeuroScan is not a medical device and has not been clinically validated. Its outputs come from a model trained on a public dataset of 2D slices. Do not use them to diagnose, treat or rule out any condition."}
    </Notice>
  );
}
