// A small inline icon set drawn on a 20px grid with a 1.6px stroke.

const PATHS = {
  overview: "M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z",
  analyze: "M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7 10h6M10 7v6",
  history: "M10 5v5l3 2M3.5 10a6.5 6.5 0 1 0 2-4.7M3 3v3h3",
  performance: "M3 17h14M5 14V9M9 14V5M13 14v-3M17 14V7",
  about: "M10 9v5M10 6.2v.1M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z",
  upload: "M10 13V3M6 7l4-4 4 4M3 13v4h14v-4",
  trash: "M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11",
  zoomIn: "M9 6v6M6 9h6M14 14l3.5 3.5M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12z",
  zoomOut: "M6 9h6M14 14l3.5 3.5M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12z",
  fit: "M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4",
  actual: "M5 6l2-1v10M12 6l2-1v10M10 8v.1M10 12v.1",
  check: "M4 10.5l4 4 8-9",
  alert: "M10 3l8 14H2zM10 8v4M10 14.5v.1",
  x: "M5 5l10 10M15 5L5 15",
  refresh: "M16 4v4h-4M16.2 8A6.5 6.5 0 1 0 16 13",
  printer: "M6 8V3h8v5M6 14H3V8h14v6h-3M6 12h8v5H6z",
  download: "M10 3v10M6 9l4 4 4-4M3 15v2h14v-2",
  back: "M8 5l-5 5 5 5M3 10h14",
  file: "M5 2h7l4 4v12H5zM12 2v4h4",
  layers: "M10 3l7 4-7 4-7-4zM3 11l7 4 7-4",
  search: "M14 14l3.5 3.5M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title }: { name: IconName; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Product mark: a measured frame, echoing the viewer's rulers. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="7" y="7" width="18" height="18" fill="none" stroke="#9CCBC2" strokeWidth="2" />
      <path d="M7 11h3M7 16h5M7 21h3M11 7v3M16 7v5M21 7v3" stroke="#9CCBC2" strokeWidth="1.5" />
      <circle cx="18" cy="18" r="3" fill="#E9ECE8" />
    </svg>
  );
}
