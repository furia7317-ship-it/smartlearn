export const RESOURCE_CENTER_VIEW_KEY = "sl_resource_center_view_v2";

export type ResourceCenterStableBookState = "open" | "closed";

const RESOURCE_CENTER_BOOK_MIN_HEIGHT = 648;
const RESOURCE_CENTER_BOOK_MAX_HEIGHT = 720;

export interface ResourceCenterViewState {
  href: string;
  bookState: ResourceCenterStableBookState;
  bookHeight: number;
  selectedKey: string;
  scrollTop: number;
}

const DEFAULT_RESOURCE_CENTER_VIEW: ResourceCenterViewState = {
  href: "/desktop/resources",
  bookState: "open",
  bookHeight: RESOURCE_CENTER_BOOK_MIN_HEIGHT,
  selectedKey: "",
  scrollTop: 0,
};

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function normalizeResourceHref(value: unknown): string {
  if (
    typeof value !== "string" ||
    (
      value !== "/desktop/resources" &&
      !value.startsWith("/desktop/resources?") &&
      !value.startsWith("/desktop/resources/")
    )
  ) {
    return DEFAULT_RESOURCE_CENTER_VIEW.href;
  }
  try {
    const base = new URL("http://resource-center.local");
    const parsed = new URL(value, base);
    if (
      parsed.origin !== base.origin ||
      (parsed.pathname !== "/desktop/resources" && !parsed.pathname.startsWith("/desktop/resources/"))
    ) {
      return DEFAULT_RESOURCE_CENTER_VIEW.href;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return DEFAULT_RESOURCE_CENTER_VIEW.href;
  }
}

export function readResourceCenterView(): ResourceCenterViewState {
  const storage = getSessionStorage();
  if (!storage) return { ...DEFAULT_RESOURCE_CENTER_VIEW };
  try {
    const raw = storage.getItem(RESOURCE_CENTER_VIEW_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_RESOURCE_CENTER_VIEW };
    return {
      href: normalizeResourceHref(parsed.href),
      bookState: parsed.bookState === "closed" ? "closed" : "open",
      bookHeight:
        typeof parsed.bookHeight === "number" && Number.isFinite(parsed.bookHeight)
          ? Math.max(RESOURCE_CENTER_BOOK_MIN_HEIGHT, Math.min(RESOURCE_CENTER_BOOK_MAX_HEIGHT, parsed.bookHeight))
          : DEFAULT_RESOURCE_CENTER_VIEW.bookHeight,
      selectedKey:
        typeof parsed.selectedKey === "string"
          ? parsed.selectedKey.slice(0, 512)
          : "",
      scrollTop:
        typeof parsed.scrollTop === "number" && Number.isFinite(parsed.scrollTop)
          ? Math.max(0, Math.min(1_000_000, parsed.scrollTop))
          : 0,
    };
  } catch {
    return { ...DEFAULT_RESOURCE_CENTER_VIEW };
  }
}

export function saveResourceCenterView(
  patch: Partial<ResourceCenterViewState>
): ResourceCenterViewState {
  const next = {
    ...readResourceCenterView(),
    ...patch,
  };
  const normalized: ResourceCenterViewState = {
    href: normalizeResourceHref(next.href),
    bookState: next.bookState === "closed" ? "closed" : "open",
    bookHeight:
      typeof next.bookHeight === "number" && Number.isFinite(next.bookHeight)
        ? Math.max(RESOURCE_CENTER_BOOK_MIN_HEIGHT, Math.min(RESOURCE_CENTER_BOOK_MAX_HEIGHT, next.bookHeight))
        : DEFAULT_RESOURCE_CENTER_VIEW.bookHeight,
    selectedKey: typeof next.selectedKey === "string" ? next.selectedKey.slice(0, 512) : "",
    scrollTop:
      typeof next.scrollTop === "number" && Number.isFinite(next.scrollTop)
        ? Math.max(0, Math.min(1_000_000, next.scrollTop))
        : 0,
  };
  try {
    getSessionStorage()?.setItem(RESOURCE_CENTER_VIEW_KEY, JSON.stringify(normalized));
  } catch {
    /* navigation remains usable when session storage is unavailable */
  }
  return normalized;
}

export function getResourceCenterReturnHref(): string {
  return readResourceCenterView().href;
}
