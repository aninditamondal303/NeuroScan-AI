import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./Icon.tsx";

export type ViewMode = "original" | "overlay" | "split";

interface Props {
  imageUrl: string | null;
  width?: number;
  height?: number;
  overlayUrl?: string | null; // Grad-CAM PNG aligned to the original image
  badge?: string;
  emptyTitle?: string;
  emptyText?: string;
  meta?: { label: string; value: string }[];
  /** True while the backend is analysing this image: shows an acquisition-style sweep. */
  scanning?: boolean;
}

const RULER = 20;
const PAD = 24;
const MIN_SCALE = 0.02;
const MAX_SCALE = 16;
const READOUT_MAX_PIXELS = 16_000_000;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

function niceStep(minImagePx: number): number {
  const exp = Math.floor(Math.log10(Math.max(minImagePx, 1e-6)));
  for (const m of [1, 2, 5, 10]) {
    const step = m * 10 ** exp;
    if (step >= minImagePx) return Math.max(1, step);
  }
  return Math.max(1, 10 ** (exp + 1));
}

/** Pixel data of the user's image, read once for the cursor readout. */
function usePixels(url: string | null, w?: number, h?: number) {
  const [pixels, setPixels] = useState<{ data: Uint8ClampedArray; w: number; colour: boolean } | null>(null);
  useEffect(() => {
    setPixels(null);
    if (!url || !w || !h || w * h > READOUT_MAX_PIXELS) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      let colour = false;
      for (let i = 0; i < data.length && !colour; i += 4 * 97) {
        if (Math.abs(data[i] - data[i + 1]) > 3 || Math.abs(data[i + 1] - data[i + 2]) > 3) colour = true;
      }
      setPixels({ data, w, colour });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, w, h]);
  return pixels;
}

export function MRIViewer({ imageUrl, width, height, overlayUrl, badge, emptyTitle, emptyText, meta, scanning = false }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [fitted, setFitted] = useState(true);
  const [mode, setMode] = useState<ViewMode>("original");
  const [opacity, setOpacity] = useState(0.6);
  const [split, setSplit] = useState(0.5); // fraction of the stage width
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; kind: "pan" | "split" } | null>(null);
  const pixels = usePixels(imageUrl, width, height);
  const hasImage = Boolean(imageUrl && width && height);
  const hasOverlay = Boolean(overlayUrl);

  // New image or overlay removed: back to the original view.
  useEffect(() => {
    if (!hasOverlay) setMode("original");
    else setMode("overlay");
  }, [hasOverlay, overlayUrl]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setStage({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback((): View | null => {
    if (!width || !height || stage.w === 0) return null;
    const availW = stage.w - RULER - PAD * 2;
    const availH = stage.h - RULER - PAD * 2;
    const scale = Math.max(MIN_SCALE, Math.min(availW / width, availH / height));
    return { scale, tx: RULER + (stage.w - RULER - width * scale) / 2, ty: RULER + (stage.h - RULER - height * scale) / 2 };
  }, [width, height, stage.w, stage.h]);

  useEffect(() => {
    setFitted(true);
  }, [imageUrl]);

  useEffect(() => {
    if (!fitted) return;
    const v = fitView();
    if (v) setView(v);
  }, [fitted, fitView]);

  const zoomAt = useCallback(
    (factor: number, sx?: number, sy?: number) => {
      setFitted(false);
      setView((v) => {
        const cx = sx ?? stage.w / 2;
        const cy = sy ?? stage.h / 2;
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const k = scale / v.scale;
        return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      });
    },
    [stage.w, stage.h],
  );

  const actualSize = useCallback(() => {
    if (!width || !height) return;
    setFitted(false);
    setView({ scale: 1, tx: RULER + (stage.w - RULER - width) / 2, ty: RULER + (stage.h - RULER - height) / 2 });
  }, [width, height, stage.w, stage.h]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !hasImage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, hasImage]);

  const local = (e: PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!hasImage || e.button !== 0) return;
    const p = local(e);
    const onDivider = mode === "split" && Math.abs(p.x - split * stage.w) < 12;
    drag.current = { x: p.x, y: p.y, tx: view.tx, ty: view.ty, kind: onDivider ? "split" : "pan" };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!hasImage) return;
    const p = local(e);
    setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === "split") {
      setSplit(Math.min(0.98, Math.max(0.02, p.x / stage.w)));
    } else {
      setFitted(false);
      setView((v) => ({ ...v, tx: d.tx + (p.x - d.x), ty: d.ty + (p.y - d.y) }));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!hasImage) return;
    const pan = (dx: number, dy: number) => {
      setFitted(false);
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    };
    const keys: Record<string, () => void> = {
      "+": () => zoomAt(1.25),
      "=": () => zoomAt(1.25),
      "-": () => zoomAt(0.8),
      "0": () => setFitted(true),
      "1": actualSize,
      ArrowLeft: () => pan(40, 0),
      ArrowRight: () => pan(-40, 0),
      ArrowUp: () => pan(0, 40),
      ArrowDown: () => pan(0, -40),
    };
    const fn = keys[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  };

  // Image coordinates under the cursor, and the pixel value there.
  const probe = useMemo(() => {
    if (!cursor || !width || !height) return null;
    const ix = Math.floor((cursor.x - view.tx) / view.scale);
    const iy = Math.floor((cursor.y - view.ty) / view.scale);
    if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
    let value: string | null = null;
    if (pixels) {
      const i = (iy * pixels.w + ix) * 4;
      const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
      value = pixels.colour ? `RGB ${r}, ${g}, ${b}` : `value ${Math.round(0.299 * r + 0.587 * g + 0.114 * b)}`;
    }
    return { ix, iy, value };
  }, [cursor, view, width, height, pixels]);

  const rulers = useMemo(() => {
    if (!width || !height || stage.w === 0) return null;
    const step = niceStep(64 / view.scale);
    const ticks = (length: number, offset: number) => {
      const out: { pos: number; v: number }[] = [];
      for (let v = 0; v <= length; v += step) out.push({ pos: offset + v * view.scale, v });
      return out;
    };
    return { step, xs: ticks(width, view.tx), ys: ticks(height, view.ty) };
  }, [width, height, view, stage.w]);

  const transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
  const splitImageFraction = width ? Math.min(1, Math.max(0, (split * stage.w - view.tx) / (width * view.scale))) : 0;
  const overlayVisible = hasOverlay && mode !== "original";

  return (
    <section className="viewer" aria-label="MRI image viewer">
      <div className="viewer__bar">
        <div className="viewer__group" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" onClick={() => zoomAt(0.8)} disabled={!hasImage} aria-label="Zoom out">
            <Icon name="zoomOut" />
          </button>
          <span className="viewer__zoom num" aria-live="polite">
            {hasImage ? `${Math.round(view.scale * 100)}%` : "n/a"}
          </span>
          <button type="button" className="icon-btn" onClick={() => zoomAt(1.25)} disabled={!hasImage} aria-label="Zoom in">
            <Icon name="zoomIn" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setFitted(true)} disabled={!hasImage} aria-label="Fit to view" title="Fit to view (0)">
            <Icon name="fit" />
          </button>
          <button type="button" className="icon-btn" onClick={actualSize} disabled={!hasImage} aria-label="Actual pixels" title="Actual pixels (1)">
            <Icon name="actual" />
          </button>
        </div>
        <span className="viewer__sep" aria-hidden="true" />
        <div className="segmented" role="group" aria-label="Image layer">
          {(["original", "overlay", "split"] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className="segmented__btn"
              aria-pressed={mode === m}
              disabled={m !== "original" && !hasOverlay}
              onClick={() => setMode(m)}
            >
              {m === "original" ? "Original" : m === "overlay" ? "Heatmap" : "Compare"}
            </button>
          ))}
        </div>
        {overlayVisible ? (
          <>
            <label className="row" style={{ gap: 6 }}>
              <span>Opacity</span>
              <input
                className="range"
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                aria-valuetext={`${Math.round(opacity * 100)} percent`}
              />
            </label>
            <div className="legend-bar" aria-label="Heatmap scale from lower to higher influence on the score">
              <div className="legend-bar__ramp" />
              <div className="legend-bar__labels">
                <span>Lower influence</span>
                <span>Higher</span>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div
        ref={stageRef}
        className="viewer__stage"
        tabIndex={hasImage ? 0 : -1}
        aria-label={hasImage ? "Image canvas. Drag to pan, scroll or use plus and minus to zoom, 0 to fit, 1 for actual pixels, arrow keys to pan." : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => (fitted ? zoomAt(2) : setFitted(true))}
        onKeyDown={onKeyDown}
      >
        {hasImage ? (
          <>
            <img
              className={`viewer__canvas${view.scale >= 3 ? " viewer__canvas--pixelated" : ""}`}
              src={imageUrl!}
              width={width}
              height={height}
              alt="Uploaded MRI slice"
              style={{ transform }}
              draggable={false}
            />
            {scanning ? (
              <div
                className="viewer__scan"
                aria-hidden="true"
                style={{ left: view.tx, top: view.ty, width: width! * view.scale, height: height! * view.scale }}
              >
                <span className="viewer__scan-line" />
              </div>
            ) : null}
            {overlayVisible ? (
              <img
                className="viewer__canvas viewer__canvas--overlay"
                src={overlayUrl!}
                width={width}
                height={height}
                alt="Grad-CAM heatmap overlay"
                style={{
                  transform,
                  opacity,
                  clipPath: mode === "split" ? `inset(0 0 0 ${splitImageFraction * 100}%)` : undefined,
                }}
                draggable={false}
              />
            ) : null}
            <svg className="viewer__overlay" aria-hidden="true">
              <rect x={0} y={0} width={stage.w} height={RULER} fill="rgba(10,18,32,0.92)" />
              <rect x={0} y={0} width={RULER} height={stage.h} fill="rgba(10,18,32,0.92)" />
              <line x1={0} y1={RULER} x2={stage.w} y2={RULER} stroke="#24364d" />
              <line x1={RULER} y1={0} x2={RULER} y2={stage.h} stroke="#24364d" />
              {rulers?.xs.map((t) =>
                t.pos > RULER && t.pos < stage.w ? (
                  <g key={`x${t.v}`}>
                    <line x1={t.pos} y1={RULER - 7} x2={t.pos} y2={RULER} stroke="#6f8299" />
                    <text x={t.pos + 3} y={10} fill="#8d9bab" fontSize={9.5} fontFamily="var(--font-ui)">
                      {t.v}
                    </text>
                  </g>
                ) : null,
              )}
              {rulers?.ys.map((t) =>
                t.pos > RULER && t.pos < stage.h ? (
                  <g key={`y${t.v}`}>
                    <line x1={RULER - 7} y1={t.pos} x2={RULER} y2={t.pos} stroke="#6f8299" />
                    <text x={10} y={t.pos + 3} fill="#8d9bab" fontSize={9.5} fontFamily="var(--font-ui)" transform={`rotate(-90 10 ${t.pos + 3})`} textAnchor="end">
                      {t.v}
                    </text>
                  </g>
                ) : null,
              )}
              <rect x={0} y={0} width={RULER} height={RULER} fill="#0a1220" />
              {probe && cursor ? (
                <>
                  <line x1={cursor.x} y1={RULER} x2={cursor.x} y2={stage.h} stroke="#9ccbc2" strokeOpacity={0.35} />
                  <line x1={RULER} y1={cursor.y} x2={stage.w} y2={cursor.y} stroke="#9ccbc2" strokeOpacity={0.35} />
                  <path d={`M${cursor.x - 4} 0 L${cursor.x + 4} 0 L${cursor.x} 6 Z`} fill="#9ccbc2" />
                  <path d={`M0 ${cursor.y - 4} L0 ${cursor.y + 4} L6 ${cursor.y} Z`} fill="#9ccbc2" />
                </>
              ) : null}
            </svg>
            {mode === "split" && hasOverlay ? (
              <div className="viewer__divider" style={{ left: `${split * 100}%` }} aria-hidden="true">
                <span className="viewer__divider-handle" />
              </div>
            ) : null}
            {badge ? <span className="viewer__badge">{badge}</span> : null}
            {probe ? (
              <span className="viewer__readout">
                x {probe.ix} &nbsp; y {probe.iy}
                {probe.value ? <>&nbsp; {probe.value}</> : null}
              </span>
            ) : null}
          </>
        ) : (
          <div className="viewer__empty">
            <div>
              <p className="viewer__empty-title">{emptyTitle ?? "No image loaded"}</p>
              <p>{emptyText ?? "Choose a 2D MRI slice on the left. It is shown here at its real pixel size, with rulers in image pixels."}</p>
            </div>
          </div>
        )}
      </div>

      {meta && meta.length ? (
        <div className="viewer__meta">
          {meta.map((m) => (
            <span key={m.label}>
              {m.label} <b>{m.value}</b>
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
