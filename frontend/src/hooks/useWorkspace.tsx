import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { api, ApiProblem } from "../api/client.ts";
import { canAnalyze, initialState, workspaceReducer, type WorkspaceState } from "../lib/analysisMachine.ts";
import {
  checkDimensions,
  checkHeader,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_SIDE,
  DEFAULT_MIN_SIDE,
  sniffBytes,
} from "../lib/fileCheck.ts";
import { useBackend } from "./useBackend.tsx";

interface WorkspaceApi {
  state: WorkspaceState;
  explain: boolean;
  setExplain: (v: boolean) => void;
  selectFile: (file: File) => void;
  remove: () => void;
  analyze: () => void;
  cancel: () => void;
  canAnalyze: boolean;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function measure(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

/**
 * Owns the analysis workspace. Lives above the router so a result survives
 * moving to the report view and back, but never survives a new image.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const [explain, setExplain] = useState(true);
  const { info, status } = useBackend();
  const controller = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const abortInFlight = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  useEffect(() => () => {
    abortInFlight();
    releaseUrl();
  }, [abortInFlight, releaseUrl]);

  const selectFile = useCallback(
    (file: File) => {
      abortInFlight();
      releaseUrl();
      const id = newId();
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      dispatch({ type: "select", image: { id, file, url } });

      const limits = info?.limits;
      void (async () => {
        const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const headerProblem = checkHeader(sniffBytes(head), file.size, limits?.max_upload_bytes ?? DEFAULT_MAX_BYTES);
        if (headerProblem) {
          dispatch({ type: "invalid", imageId: id, problem: headerProblem });
          return;
        }
        try {
          const { width, height } = await measure(url);
          const dimProblem = checkDimensions(width, height, limits?.min_side ?? DEFAULT_MIN_SIDE, limits?.max_side ?? DEFAULT_MAX_SIDE);
          if (dimProblem) dispatch({ type: "invalid", imageId: id, problem: dimProblem });
          else dispatch({ type: "validated", imageId: id, width, height });
        } catch {
          dispatch({
            type: "invalid",
            imageId: id,
            problem: { kind: "http", code: "corrupt_image", message: "The browser could not decode this image. It may be damaged.", hint: "Re-export the slice and try again." },
          });
        }
      })();
    },
    [abortInFlight, releaseUrl, info],
  );

  const remove = useCallback(() => {
    abortInFlight();
    releaseUrl();
    dispatch({ type: "remove" });
  }, [abortInFlight, releaseUrl]);

  const analyze = useCallback(() => {
    if (!canAnalyze(state) || !state.image || status !== "ready") return;
    abortInFlight();
    const requestId = newId();
    const ctrl = new AbortController();
    controller.current = ctrl;
    dispatch({ type: "analyze", requestId });
    api
      .analyze(state.image.file, requestId, { explain, signal: ctrl.signal })
      .then((result) => dispatch({ type: "succeeded", requestId, result }))
      .catch((e: unknown) => {
        if (e instanceof ApiProblem && e.problem.kind === "aborted") return; // superseded or cancelled
        const problem = e instanceof ApiProblem ? e.problem : { kind: "network" as const, code: "unknown", message: "The analysis failed." };
        dispatch({ type: "failed", requestId, problem });
      })
      .finally(() => {
        if (controller.current === ctrl) controller.current = null;
      });
  }, [state, status, explain, abortInFlight]);

  const cancel = useCallback(() => {
    if (state.phase !== "analyzing" || !state.requestId) return;
    abortInFlight();
    dispatch({ type: "cancel", requestId: state.requestId });
  }, [state.phase, state.requestId, abortInFlight]);

  return (
    <WorkspaceContext.Provider
      value={{ state, explain, setExplain, selectFile, remove, analyze, cancel, canAnalyze: canAnalyze(state) && status === "ready" }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
