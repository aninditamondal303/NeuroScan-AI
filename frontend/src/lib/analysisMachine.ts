// Workspace state machine. Pure, so it can be tested without a browser.
//
//   idle -> validating -> ready -> analyzing -> classified | inconclusive | failed
//                     \-> invalid
//
// Every event about a file or request carries its id. Events for a file or
// request that is no longer current are ignored, so a slow response can never
// land on a newer image.

import type { Problem } from "../api/client.ts";
import type { AnalysisResult } from "../api/types.ts";

export type Phase = "idle" | "validating" | "invalid" | "ready" | "analyzing" | "classified" | "inconclusive" | "failed";

export interface SelectedImage {
  id: string;
  file: File;
  url: string; // object URL of the user's own file, used for the viewer
  width?: number;
  height?: number;
}

export interface WorkspaceState {
  phase: Phase;
  image: SelectedImage | null;
  requestId: string | null;
  result: AnalysisResult | null;
  problem: Problem | null;
}

export type WorkspaceEvent =
  | { type: "select"; image: SelectedImage }
  | { type: "validated"; imageId: string; width: number; height: number }
  | { type: "invalid"; imageId: string; problem: Problem }
  | { type: "remove" }
  | { type: "analyze"; requestId: string }
  | { type: "succeeded"; requestId: string; result: AnalysisResult }
  | { type: "failed"; requestId: string; problem: Problem }
  | { type: "cancel"; requestId: string };

export const initialState: WorkspaceState = { phase: "idle", image: null, requestId: null, result: null, problem: null };

export function canAnalyze(state: WorkspaceState): boolean {
  return state.image !== null && (state.phase === "ready" || state.phase === "failed");
}

export function workspaceReducer(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "select":
      // A new image always discards the previous result, error and request.
      return { phase: "validating", image: event.image, requestId: null, result: null, problem: null };

    case "validated":
      if (state.phase !== "validating" || state.image?.id !== event.imageId) return state;
      return { ...state, phase: "ready", image: { ...state.image, width: event.width, height: event.height } };

    case "invalid":
      if (state.phase !== "validating" || state.image?.id !== event.imageId) return state;
      return { ...state, phase: "invalid", problem: event.problem };

    case "remove":
      return initialState;

    case "analyze":
      if (!canAnalyze(state)) return state;
      return { ...state, phase: "analyzing", requestId: event.requestId, result: null, problem: null };

    case "succeeded":
      if (state.phase !== "analyzing" || state.requestId !== event.requestId) return state;
      if (event.result.client_request_id !== event.requestId) return state;
      return { ...state, phase: event.result.status, result: event.result, problem: null };

    case "failed":
      if (state.phase !== "analyzing" || state.requestId !== event.requestId) return state;
      return { ...state, phase: "failed", problem: event.problem, result: null };

    case "cancel":
      if (state.phase !== "analyzing" || state.requestId !== event.requestId) return state;
      return { ...state, phase: "ready", requestId: null };

    default:
      return state;
  }
}
