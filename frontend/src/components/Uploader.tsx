import { useRef, useState, type DragEvent } from "react";
import type { Limits } from "../api/types.ts";
import type { WorkspaceState } from "../lib/analysisMachine.ts";
import { ACCEPT_ATTRIBUTE, DEFAULT_MAX_BYTES } from "../lib/fileCheck.ts";
import { bytes } from "../lib/format.ts";
import { ProblemNotice } from "./Common.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  state: WorkspaceState;
  limits: Limits | null;
  disabled: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function Uploader({ state, limits, disabled, onSelect, onRemove, inputRef }: Props) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const [over, setOver] = useState(false);
  const image = state.image;

  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onSelect(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) take(e.dataTransfer.files);
  };

  const maxMb = ((limits?.max_upload_bytes ?? DEFAULT_MAX_BYTES) / (1024 * 1024)).toFixed(0);

  return (
    <div className="stack">
      <h2 className="ws-title">Source image</h2>
      <div
        className={`dropzone${over ? " dropzone--active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload" size={22} />
        <p className="dropzone__title">{image ? "Drop a different slice to replace it" : "Drop a brain MRI slice here"}</p>
        <p>or</p>
        <button type="button" className="btn" onClick={() => ref.current?.click()} disabled={disabled}>
          {image ? "Replace image" : "Browse files"}
        </button>
        <input
          ref={ref}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose an MRI slice"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = ""; // allow choosing the same file again
          }}
        />
      </div>

      {image ? (
        <div className="file-card">
          <img className="file-card__thumb" src={image.url} alt="" />
          <div className="stack" style={{ gap: 4 }}>
            <p className="file-card__name">{image.file.name}</p>
            <p className="xsmall muted num">
              {bytes(image.file.size)}
              {image.width && image.height ? `, ${image.width} × ${image.height} px` : ""}
            </p>
            <button type="button" className="btn btn--quiet btn--danger" onClick={onRemove} style={{ justifySelf: "start", minHeight: 30, padding: "0 8px" }}>
              <Icon name="trash" size={16} />
              Remove
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === "validating" ? <p className="small muted" role="status">Checking the file…</p> : null}
      {state.phase === "invalid" && state.problem ? <ProblemNotice problem={state.problem} /> : null}

      <div>
        <p className="subhead">What you can upload</p>
        <ul className="requirements">
          <li>One 2D brain MRI slice as PNG, JPEG or WebP</li>
          <li>Up to {maxMb} MB, at least {limits?.min_side ?? 64} px per side</li>
          <li>Greyscale slices like the training data (axial, coronal or sagittal)</li>
          <li>Not supported: DICOM, NIfTI, 3D volumes, photographs, colour maps</li>
        </ul>
      </div>
    </div>
  );
}
