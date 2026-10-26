import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiProblem, type Problem } from "../api/client.ts";
import type { ModelInfo } from "../api/types.ts";

export type BackendStatus = "checking" | "offline" | "model_unavailable" | "ready";

interface BackendState {
  status: BackendStatus;
  info: ModelInfo | null;
  problem: Problem | null;
  lastChecked: Date | null;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  reloading: boolean;
}

const BackendContext = createContext<BackendState | null>(null);
const POLL_MS = 15_000;

export function BackendProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [reloading, setReloading] = useState(false);
  const versionRef = useRef<string | null>(null);
  const statusRef = useRef<BackendStatus>("checking");

  const setBoth = useCallback((next: BackendStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const apply = useCallback((next: ModelInfo) => {
    setInfo(next);
    setProblem(null);
    setBoth(next.ready ? "ready" : "model_unavailable");
    versionRef.current = next.metadata?.model_version ?? null;
    setLastChecked(new Date());
  }, [setBoth]);

  const fail = useCallback((e: unknown) => {
    setProblem(e instanceof ApiProblem ? e.problem : { kind: "network", code: "network_error", message: "Could not reach the backend." });
    setBoth("offline");
    setLastChecked(new Date());
  }, [setBoth]);

  const refresh = useCallback(async () => {
    try {
      apply(await api.modelInfo());
    } catch (e) {
      fail(e);
    }
  }, [apply, fail]);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      apply(await api.reloadModel());
    } catch (e) {
      fail(e);
    } finally {
      setReloading(false);
    }
  }, [apply, fail]);

  useEffect(() => {
    void refresh();
    // Lightweight health polling; full model info is re-fetched only when the
    // backend comes back or the model version or readiness changes.
    const timer = setInterval(async () => {
      try {
        const h = await api.health();
        const next: BackendStatus = h.model_ready ? "ready" : "model_unavailable";
        if (next !== statusRef.current || h.model_version !== versionRef.current) void refresh();
        else setLastChecked(new Date());
      } catch (e) {
        fail(e);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, fail]);

  return (
    <BackendContext.Provider value={{ status, info, problem, lastChecked, refresh, reload, reloading }}>{children}</BackendContext.Provider>
  );
}

export function useBackend(): BackendState {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error("useBackend must be used inside BackendProvider");
  return ctx;
}
