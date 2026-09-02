export const DESKTOP_MODULE_VIEW_KEY = "sl_desktop_module_view_v1";

export type DesktopModuleId =
  | "home"
  | "studio"
  | "path"
  | "resources"
  | "practice"
  | "discover";

export interface DesktopModuleView {
  href: string;
  scrollPath: string;
  scrollTops: Record<string, number>;
  values: Record<string, unknown>;
}

type DesktopModuleViewStore = Partial<Record<DesktopModuleId, DesktopModuleView>>;

const MODULE_ROOTS: Record<DesktopModuleId, string> = {
  home: "/desktop",
  studio: "/desktop/studio",
  path: "/desktop/path",
  resources: "/desktop/resources",
  practice: "/desktop/practice",
  discover: "/desktop/discover",
};

const MODULE_ROUTES: Record<DesktopModuleId, string[]> = {
  home: ["/desktop", "/desktop/todos", "/desktop/calendar"],
  studio: ["/desktop/studio", "/desktop/agents"],
  path: ["/desktop/path"],
  resources: ["/desktop/resources", "/desktop/create", "/desktop/kb", "/desktop/video-learning"],
  practice: ["/desktop/practice", "/desktop/code-lab", "/desktop/diagnostic"],
  discover: ["/desktop/discover", "/desktop/theater", "/desktop/market"],
};

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function routeMatches(pathname: string, route: string): boolean {
  if (route === "/desktop") return pathname === route || pathname === `${route}/`;
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function getDesktopModuleId(pathnameOrHref: string): DesktopModuleId | null {
  let pathname = pathnameOrHref;
  try {
    pathname = new URL(pathnameOrHref, "http://desktop.local").pathname;
  } catch {
    return null;
  }
  for (const moduleId of Object.keys(MODULE_ROUTES) as DesktopModuleId[]) {
    if (MODULE_ROUTES[moduleId].some((route) => routeMatches(pathname, route))) {
      return moduleId;
    }
  }
  return null;
}

function normalizeHref(value: unknown, moduleId: DesktopModuleId): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return MODULE_ROOTS[moduleId];
  }
  try {
    const base = new URL("http://desktop.local");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin || getDesktopModuleId(parsed.pathname) !== moduleId) {
      return MODULE_ROOTS[moduleId];
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return MODULE_ROOTS[moduleId];
  }
}

function normalizeScrollTops(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    result[key.slice(0, 160)] = Math.max(0, Math.min(1_000_000, raw));
  }
  return result;
}

function normalizeValues(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStore(): DesktopModuleViewStore {
  try {
    const raw = sessionStore()?.getItem(DESKTOP_MODULE_VIEW_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as DesktopModuleViewStore
      : {};
  } catch {
    return {};
  }
}

export function readDesktopModuleView(moduleId: DesktopModuleId): DesktopModuleView {
  const raw = readStore()[moduleId];
  return {
    href: normalizeHref(raw?.href, moduleId),
    scrollPath:
      typeof raw?.scrollPath === "string" && getDesktopModuleId(raw.scrollPath) === moduleId
        ? new URL(raw.scrollPath, "http://desktop.local").pathname
        : "",
    scrollTops: normalizeScrollTops(raw?.scrollTops),
    values: normalizeValues(raw?.values),
  };
}

export function saveDesktopModuleView(
  moduleId: DesktopModuleId,
  patch: Partial<DesktopModuleView>
): DesktopModuleView {
  const current = readDesktopModuleView(moduleId);
  const next: DesktopModuleView = {
    href: normalizeHref(patch.href ?? current.href, moduleId),
    scrollPath:
      typeof (patch.scrollPath ?? current.scrollPath) === "string" &&
      getDesktopModuleId(patch.scrollPath ?? current.scrollPath) === moduleId
        ? new URL(patch.scrollPath ?? current.scrollPath, "http://desktop.local").pathname
        : "",
    scrollTops: normalizeScrollTops(patch.scrollTops ?? current.scrollTops),
    values: normalizeValues(patch.values ?? current.values),
  };
  try {
    const store = readStore();
    store[moduleId] = next;
    sessionStore()?.setItem(DESKTOP_MODULE_VIEW_KEY, JSON.stringify(store));
  } catch {
    /* module navigation remains functional when storage is unavailable */
  }
  return next;
}

export function rememberDesktopModuleHref(href: string): void {
  const moduleId = getDesktopModuleId(href);
  if (moduleId) saveDesktopModuleView(moduleId, { href });
}

export function getDesktopModuleReturnHref(rootHref: string): string {
  const moduleId = getDesktopModuleId(rootHref);
  return moduleId ? readDesktopModuleView(moduleId).href : rootHref;
}
