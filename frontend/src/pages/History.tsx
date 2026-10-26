import { useMemo, useState } from "react";
import { api, ApiProblem, type Problem } from "../api/client.ts";
import type { HistoryEntry } from "../api/types.ts";
import { EmptyState, KindMark, Loading, Notice, ProblemNotice } from "../components/Common.tsx";
import { Icon } from "../components/Icon.tsx";
import { UncertaintyFigures } from "../components/ResultPanel.tsx";
import { ScoreBars } from "../components/ScoreBars.tsx";
import { useBackend } from "../hooks/useBackend.tsx";
import { useFetch } from "../hooks/useFetch.ts";
import { bytes, dateTime, resultHeadline, resultKind, score, type ResultKind } from "../lib/format.ts";
import { href, navigate } from "../lib/router.ts";

type Filter = "all" | ResultKind;
type Sort = "newest" | "oldest" | "score_desc" | "score_asc";

export function filterAndSort(entries: HistoryEntry[], query: string, filter: Filter, sort: Sort): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  const out = entries.filter((e) => {
    if (filter !== "all" && resultKind(e) !== filter) return false;
    if (!q) return true;
    return [e.analysis_id, e.prediction?.label ?? "inconclusive", e.model.version].some((s) => s.toLowerCase().includes(q));
  });
  const by: Record<Sort, (a: HistoryEntry, b: HistoryEntry) => number> = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    oldest: (a, b) => a.created_at.localeCompare(b.created_at),
    score_desc: (a, b) => b.uncertainty.top_score - a.uncertainty.top_score,
    score_asc: (a, b) => a.uncertainty.top_score - b.uncertainty.top_score,
  };
  return [...out].sort(by[sort]);
}

function Detail({ entry, onDeleted }: { entry: HistoryEntry; onDeleted: () => void }) {
  const [problem, setProblem] = useState<Problem | null>(null);
  const h = resultHeadline(entry);
  const remove = async () => {
    if (!window.confirm(`Delete analysis ${entry.analysis_id}? This cannot be undone.`)) return;
    try {
      await api.deleteEntry(entry.analysis_id);
      onDeleted();
    } catch (e) {
      if (e instanceof ApiProblem) setProblem(e.problem);
    }
  };
  return (
    <section className="sheet" aria-label={`Analysis ${entry.analysis_id}`}>
      <div className="sheet__head">
        <h2 className="sheet__title num">{entry.analysis_id}</h2>
        <button type="button" className="icon-btn" style={{ color: "var(--ink-2)" }} onClick={() => navigate("/history")} aria-label="Close details">
          <Icon name="x" />
        </button>
      </div>
      <div className="sheet__pad stack-lg">
        <div className="stack">
          <KindMark kind={resultKind(entry)} />
          <p className={`result-title${entry.status === "inconclusive" ? " result-title--inconclusive" : ""}`} style={{ fontSize: "var(--t-2xl)" }}>
            {h.title}
          </p>
          <p className="small">{h.summary}</p>
          <p className="xsmall muted">{h.caveat}</p>
        </div>
        {entry.reasons.length ? (
          <div className="stack">
            {entry.reasons.map((r) => (
              <Notice key={r.code} tone="warning">
                {r.message}
              </Notice>
            ))}
          </div>
        ) : null}
        <ScoreBars
          scores={entry.scores}
          threshold={entry.uncertainty.review_threshold}
          muted={entry.status !== "classified"}
          caption={entry.status === "classified" ? "Score for each class" : "Scores (not a classification)"}
        />
        <UncertaintyFigures result={entry} />
        <dl className="facts">
          <dt>Analysed</dt>
          <dd>{dateTime(entry.created_at)}</dd>
          <dt>Model</dt>
          <dd>{entry.model.version}</dd>
          <dt>Image</dt>
          <dd className="num">
            {entry.image.format}, {entry.image.width} × {entry.image.height}, {bytes(entry.image.size_bytes)}
          </dd>
        </dl>
        {problem ? <ProblemNotice problem={problem} /> : null}
        <div className="row">
          <a className="btn btn--primary" href={href(`/report/${encodeURIComponent(entry.analysis_id)}`)}>
            <Icon name="printer" size={16} />
            Open report
          </a>
          <button type="button" className="btn btn--danger" onClick={remove}>
            <Icon name="trash" size={16} />
            Delete
          </button>
        </div>
      </div>
    </section>
  );
}

export function HistoryPage({ selectedId }: { selectedId: string | null }) {
  const backend = useBackend();
  const list = useFetch((s) => api.history(s), [backend.status]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [problem, setProblem] = useState<Problem | null>(null);

  const rows = useMemo(() => filterAndSort(list.data ?? [], query, filter, sort), [list.data, query, filter, sort]);
  const selected = list.data?.find((e) => e.analysis_id === selectedId) ?? null;
  const disabled = backend.info && !backend.info.history_enabled;

  const clearAll = async () => {
    if (!list.data?.length || !window.confirm(`Delete all ${list.data.length} saved analyses? This cannot be undone.`)) return;
    try {
      await api.clearHistory();
      navigate("/history");
      list.reload();
    } catch (e) {
      if (e instanceof ApiProblem) setProblem(e.problem);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Analysis history</h1>
          <p className="page-lede">
            Saved on this computer in <code>backend/data/history.db</code>: the result, class scores, uncertainty figures, image format and size, and model version. The image,
            heatmap and file name are never stored.
          </p>
        </div>
        <button type="button" className="btn btn--danger" onClick={clearAll} disabled={!list.data?.length}>
          <Icon name="trash" size={16} />
          Delete all
        </button>
      </header>

      {problem ? <ProblemNotice problem={problem} /> : null}
      {disabled ? <Notice tone="info" title="History is turned off on this server (NEUROSCAN_HISTORY_ENABLED=false)." /> : null}

      <div className="toolbar" role="search">
        <label className="field">
          Search
          <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ID, class or model version" />
        </label>
        <label className="field">
          Result
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All results</option>
            <option value="tumour">Tumour class predicted</option>
            <option value="no_tumour">No tumour class predicted</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
        </label>
        <label className="field">
          Sort
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score_desc">Highest top score</option>
            <option value="score_asc">Lowest top score</option>
          </select>
        </label>
        <span className="toolbar__spacer" />
        <span className="small muted" aria-live="polite">
          {list.data ? `${rows.length} of ${list.data.length} shown` : ""}
        </span>
      </div>

      <div className="history-layout">
        <div className="sheet">
          {list.loading && !list.data ? (
            <div className="sheet__pad">
              <Loading label="Loading history" />
            </div>
          ) : list.problem ? (
            <div className="sheet__pad">
              <ProblemNotice
                problem={list.problem}
                action={
                  <button type="button" className="btn" onClick={list.reload}>
                    Try again
                  </button>
                }
              />
            </div>
          ) : !list.data?.length ? (
            <div className="sheet__pad">
              <EmptyState
                title="No saved analyses"
                action={
                  <a className="btn btn--primary" href={href("/analyze")}>
                    Start MRI analysis
                  </a>
                }
              >
                Every analysis you run is listed here.
              </EmptyState>
            </div>
          ) : rows.length === 0 ? (
            <div className="sheet__pad">
              <EmptyState title="Nothing matches these filters">Change the search text or result filter.</EmptyState>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Analysis</th>
                    <th scope="col">Date</th>
                    <th scope="col">Result</th>
                    <th scope="col" className="num">
                      Top score
                    </th>
                    <th scope="col">Model version</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.analysis_id} aria-selected={e.analysis_id === selectedId}>
                      <td className="nowrap">
                        <a className="num" href={href(`/history/${encodeURIComponent(e.analysis_id)}`)}>
                          {e.analysis_id}
                        </a>
                      </td>
                      <td className="num nowrap">{dateTime(e.created_at)}</td>
                      <td className="nowrap">
                        <KindMark kind={resultKind(e)} short />
                        {e.prediction ? <div className="xsmall muted">{e.prediction.label}</div> : null}
                      </td>
                      <td className="num">{score(e.uncertainty.top_score)}</td>
                      <td className="xsmall">{e.model.version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {selected ? (
          <Detail
            entry={selected}
            onDeleted={() => {
              navigate("/history");
              list.reload();
            }}
          />
        ) : selectedId && list.data ? (
          <EmptyState title="Analysis not found">It may have been deleted.</EmptyState>
        ) : null}
      </div>
    </div>
  );
}
