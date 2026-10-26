import { useEffect, useState } from "react";

export type Route =
  | { name: "overview" }
  | { name: "analyze" }
  | { name: "history"; id: string | null }
  | { name: "performance" }
  | { name: "about" }
  | { name: "report"; id: string }
  | { name: "not_found" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case undefined:
      return { name: "overview" };
    case "analyze":
      return { name: "analyze" };
    case "history":
      return { name: "history", id: parts[1] ?? null };
    case "performance":
      return { name: "performance" };
    case "about":
      return { name: "about" };
    case "report":
      return parts[1] ? { name: "report", id: parts[1] } : { name: "not_found" };
    default:
      return { name: "not_found" };
  }
}

export const href = (path: string) => `#${path}`;

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
