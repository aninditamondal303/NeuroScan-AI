import { useCallback, useEffect, useState } from "react";
import { ApiProblem, type Problem } from "../api/client.ts";

export interface FetchState<T> {
  data: T | null;
  problem: Problem | null;
  loading: boolean;
  reload: () => void;
}

/** Load data with cancellation; `deps` re-run the request. */
export function useFetch<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setData(d);
        setProblem(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setData(null);
        setProblem(e instanceof ApiProblem ? e.problem : { kind: "network", code: "unknown", message: "The request failed." });
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, problem, loading, reload };
}
