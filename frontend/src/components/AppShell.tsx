import type { ReactNode } from "react";
import { href, type Route } from "../lib/router.ts";
import { Icon, Mark, type IconName } from "./Icon.tsx";
import { ModelStatus } from "./ModelStatus.tsx";

const NAV: { path: string; label: string; icon: IconName; match: Route["name"][] }[] = [
  { path: "/", label: "Overview", icon: "overview", match: ["overview"] },
  { path: "/analyze", label: "New analysis", icon: "analyze", match: ["analyze", "report"] },
  { path: "/history", label: "History", icon: "history", match: ["history"] },
  { path: "/performance", label: "Model performance", icon: "performance", match: ["performance"] },
  { path: "/about", label: "About", icon: "about", match: ["about"] },
];

function Wordmark() {
  return (
    <span className="wordmark">
      NeuroScan<span className="wordmark__ai">AI</span>
    </span>
  );
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail" aria-label="Main navigation">
        <a className="rail__brand" href={href("/")}>
          <Mark />
          <Wordmark />
        </a>
        <nav className="rail__nav">
          {NAV.map((item) => (
            <a key={item.path} className="nav-link" href={href(item.path)} aria-current={item.match.includes(route.name) ? "page" : undefined}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="rail__foot">
          <ModelStatus />
          <p className="rail__note">Research and education prototype. Not for clinical use.</p>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <a className="rail__brand" href={href("/")} style={{ display: "flex", padding: 0 }}>
            <Mark size={22} />
            <Wordmark />
          </a>
          <ModelStatus showDetail={false} />
        </header>
        <div className="prototype-strip no-print">
          <span className="prototype-strip__mark" aria-hidden="true" />
          Research and education prototype. Outputs are model predictions on single 2D slices, not diagnoses.
        </div>
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
