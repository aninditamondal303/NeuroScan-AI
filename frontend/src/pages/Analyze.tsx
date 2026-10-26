import { useRef } from "react";
import { MRIViewer } from "../components/MRIViewer.tsx";
import { ResultPanel } from "../components/ResultPanel.tsx";
import { Uploader } from "../components/Uploader.tsx";
import { useBackend } from "../hooks/useBackend.tsx";
import { useWorkspace } from "../hooks/useWorkspace.tsx";
import { bytes } from "../lib/format.ts";
import { downloadText, reportJson } from "../lib/report.ts";
import { navigate } from "../lib/router.ts";

export function AnalyzePage() {
  const ws = useWorkspace();
  const backend = useBackend();
  const inputRef = useRef<HTMLInputElement>(null);
  const { state } = ws;
  const result = state.result;
  const meta = backend.info?.metadata;

  const firstFailure = backend.info?.checks.find((c) => !c.passed);
  const modelProblem =
    backend.status === "offline"
      ? "The backend is not reachable. Start it, then this page will update on its own."
      : backend.status === "checking"
        ? "Checking the backend."
        : firstFailure
          ? `${firstFailure.label}: ${firstFailure.detail}`
          : null;

  const badge =
    state.phase === "ready"
      ? "Not analysed yet"
      : state.phase === "analyzing"
        ? "Analysing this slice"
        : state.phase === "failed"
          ? "Not analysed: the request failed"
          : result
            ? `Showing result ${result.analysis_id}`
            : undefined;

  const viewerMeta = state.image
    ? [
        { label: "File", value: state.image.file.type.replace("image/", "").toUpperCase() || "unknown" },
        { label: "Size", value: bytes(state.image.file.size) },
        ...(state.image.width ? [{ label: "Pixels", value: `${state.image.width} × ${state.image.height}` }] : []),
        ...(meta ? [{ label: "Model input", value: `${meta.input.width} × ${meta.input.height}, grey, padded to square` }] : []),
      ]
    : undefined;

  return (
    <div className="workspace">
      <div className="ws-source">
        <Uploader
          state={state}
          limits={backend.info?.limits ?? null}
          disabled={state.phase === "analyzing"}
          onSelect={ws.selectFile}
          onRemove={ws.remove}
          inputRef={inputRef}
        />
      </div>

      <MRIViewer
        imageUrl={state.phase === "invalid" ? null : (state.image?.url ?? null)}
        width={state.image?.width}
        height={state.image?.height}
        overlayUrl={result?.explanation.status === "available" ? result.explanation.overlay_png : null}
        badge={badge}
        emptyTitle={state.phase === "invalid" ? "This file cannot be displayed for analysis" : undefined}
        emptyText={state.phase === "invalid" ? "Choose a different image on the left." : undefined}
        meta={viewerMeta}
        scanning={state.phase === "analyzing"}
      />

      <ResultPanel
        state={state}
        modelReady={backend.status === "ready"}
        modelProblem={modelProblem}
        canAnalyze={ws.canAnalyze}
        explain={ws.explain}
        setExplain={ws.setExplain}
        onAnalyze={ws.analyze}
        onCancel={ws.cancel}
        onReport={() => navigate("/report/current")}
        onDownload={() => result && downloadText(`${result.analysis_id}.json`, reportJson(result, state.image?.file.name ?? null))}
        onAnother={() => {
          ws.remove();
          inputRef.current?.click();
        }}
      />
    </div>
  );
}
