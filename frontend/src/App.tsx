import { AppShell } from "./components/AppShell.tsx";
import { EmptyState } from "./components/Common.tsx";
import { BackendProvider } from "./hooks/useBackend.tsx";
import { WorkspaceProvider } from "./hooks/useWorkspace.tsx";
import { href, useRoute, type Route } from "./lib/router.ts";
import { AboutPage } from "./pages/About.tsx";
import { AnalyzePage } from "./pages/Analyze.tsx";
import { HistoryPage } from "./pages/History.tsx";
import { OverviewPage } from "./pages/Overview.tsx";
import { PerformancePage } from "./pages/Performance.tsx";
import { ReportPage } from "./pages/Report.tsx";

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "overview":
      return <OverviewPage />;
    case "analyze":
      return <AnalyzePage />;
    case "history":
      return <HistoryPage selectedId={route.id} />;
    case "performance":
      return <PerformancePage />;
    case "about":
      return <AboutPage />;
    case "report":
      return <ReportPage id={route.id} />;
    default:
      return (
        <div className="page">
          <EmptyState
            title="Page not found"
            action={
              <a className="btn" href={href("/")}>
                Go to overview
              </a>
            }
          />
        </div>
      );
  }
}

export function App() {
  const route = useRoute();
  return (
    <BackendProvider>
      <WorkspaceProvider>
        <AppShell route={route}>
          <Page route={route} />
        </AppShell>
      </WorkspaceProvider>
    </BackendProvider>
  );
}
