import { useBackend, type BackendStatus } from "../hooks/useBackend.tsx";

const LABEL: Record<BackendStatus, string> = {
  checking: "Checking backend",
  offline: "Backend offline",
  model_unavailable: "Model not ready",
  ready: "Model ready",
};

const CLASS: Record<BackendStatus, string> = {
  checking: "status--checking",
  offline: "status--offline",
  model_unavailable: "status--unavailable",
  ready: "status--ready",
};

/** Persistent indicator; shape and text carry the state, colour reinforces it. */
export function ModelStatus({ showDetail = true }: { showDetail?: boolean }) {
  const { status, info } = useBackend();
  const detail =
    status === "ready"
      ? info?.metadata?.model_version
      : status === "model_unavailable"
        ? "Analysis disabled"
        : status === "offline"
          ? "Start the API server"
          : null;
  return (
    <div className={`status ${CLASS[status]}`} role="status" aria-live="polite">
      <span className="status__shape" aria-hidden="true" />
      <span>
        {LABEL[status]}
        {showDetail && detail ? (
          <>
            <br />
            <span className="status-detail">{detail}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}
