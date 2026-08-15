"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useBrowserHost } from "@/components/persistent-browser";
import { onOpenBrowser } from "@/lib/browser-bus";

export type StudioPanelKey = "browser" | "orchestration" | "profile" | "path";
export type StudioResizeSide = "left" | "right";

const BASE_ORDER: StudioPanelKey[] = ["browser", "orchestration", "profile", "path"];
const VALID = new Set<StudioPanelKey>(BASE_ORDER);
const STATE_KEY = "sl_studio_panels_v3";
const DEFAULT_LEFT_W = 240;
const DEFAULT_RIGHT_W = 360;
const MIN_LEFT_W = 200;
const MAX_LEFT_W = 360;
const MIN_RIGHT_W = 300;
const MAX_RIGHT_W = 1080;
const COLLAPSED_W = 48;
const MIN_CENTER_W = 420;
const SHELL_GUTTER = 84;

type PersistedState = {
  version: 3;
  open: StudioPanelKey | null;
  leftOpen: boolean;
  rightOpen: boolean;
  leftW: number;
  rightW: number;
};

function readState(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedState>;
    return value.version === 3 ? value : null;
  } catch {
    return null;
  }
}

function writeState(value: PersistedState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable in an embedded browser.
  }
}

/** Shared desktop panel state: widths, collapse rails, persistence and browser slot geometry. */
export function useStudioPanels({
  tagsLen,
  pathLen,
}: {
  tagsLen: number;
  pathLen: number;
}) {
  const [open, setOpen] = useState<StudioPanelKey | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftW, setLeftW] = useState(DEFAULT_LEFT_W);
  const [panelW, setPanelW] = useState(DEFAULT_RIGHT_W);
  const [compact, setCompact] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [pathDirty, setPathDirty] = useState(false);
  const [resizing, setResizing] = useState<StudioResizeSide | null>(null);
  const browserHost = useBrowserHost();
  const browserSlotRef = useRef<HTMLDivElement>(null);

  const panelKeys: StudioPanelKey[] = BASE_ORDER;

  const clampLeft = (width: number) => {
    const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
    const maxByCenter = Math.max(MIN_LEFT_W, viewport - SHELL_GUTTER - MIN_CENTER_W - MIN_RIGHT_W);
    return Math.round(Math.min(Math.max(width, MIN_LEFT_W), Math.min(MAX_LEFT_W, maxByCenter)));
  };

  const clampRight = (width: number) => {
    const viewport = typeof window === "undefined" ? 1440 : window.innerWidth;
    const leftTrack = leftOpen ? leftW : COLLAPSED_W;
    const maxByCenter = Math.max(MIN_RIGHT_W, viewport - SHELL_GUTTER - leftTrack - MIN_CENTER_W);
    return Math.round(Math.min(Math.max(width, MIN_RIGHT_W), Math.min(MAX_RIGHT_W, maxByCenter)));
  };

  const persist = (next?: Partial<PersistedState>) => {
    writeState({
      version: 3,
      open,
      leftOpen,
      rightOpen,
      leftW,
      rightW: panelW,
      ...next,
    });
  };

  // Keep the browser host aligned with the actual slot, even while the right panel is resized.
  useEffect(() => {
    if (open !== "browser" || !rightOpen) {
      browserHost.hide();
      return;
    }
    const el = browserSlotRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      browserHost.show({ x: r.left, y: r.top, w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      browserHost.hide();
    };
  }, [browserHost, open, panelW, rightOpen]);

  useEffect(() => {
    const applyViewport = () => {
      const nextCompact = window.innerWidth < 1180;
      setCompact(nextCompact);
      setLeftW((value) => clampLeft(value));
      setPanelW((value) => clampRight(value));
    };
    const saved = readState();
    if (saved) {
      if (saved.open === null || (typeof saved.open === "string" && VALID.has(saved.open))) {
        setOpen(saved.open ?? null);
      }
      if (typeof saved.leftOpen === "boolean") setLeftOpen(saved.leftOpen);
      if (typeof saved.rightOpen === "boolean") setRightOpen(saved.rightOpen);
      if (typeof saved.leftW === "number") setLeftW(clampLeft(saved.leftW));
      if (typeof saved.rightW === "number") setPanelW(clampRight(saved.rightW));
    }
    applyViewport();
    window.addEventListener("resize", applyViewport);
    return () => window.removeEventListener("resize", applyViewport);
    // Width clamping intentionally reads the current viewport once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tagsLen > 0 && open !== "profile") setProfileDirty(true);
  }, [tagsLen, open]);
  useEffect(() => {
    if (pathLen > 0 && open !== "path") setPathDirty(true);
  }, [pathLen, open]);

  const setPanel = (key: StudioPanelKey | null) => {
    setOpen(key);
    if (key) setRightOpen(true);
    const browserWidth = key === "browser" && panelW < 640 ? clampRight(720) : panelW;
    if (browserWidth !== panelW) setPanelW(browserWidth);
    persist({ open: key, rightOpen: key ? true : rightOpen, rightW: browserWidth });
  };

  const toggle = (key: StudioPanelKey) => {
    const next = open === key ? null : key;
    setOpen(next);
    setRightOpen(true);
    if (key === "profile") setProfileDirty(false);
    if (key === "path") setPathDirty(false);
    persist({ open: next, rightOpen: true });
  };

  const toggleLeft = () => {
    setLeftOpen((value) => {
      const next = !value;
      persist({ leftOpen: next });
      return next;
    });
  };
  const toggleRight = () => {
    setRightOpen((value) => {
      const next = !value;
      persist({ rightOpen: next });
      return next;
    });
  };

  useEffect(() => {
    return onOpenBrowser(() => {
      setOpen("browser");
      setRightOpen(true);
      setPanelW((width) => {
        const next = width < 640 ? clampRight(720) : width;
        persist({ open: "browser", rightOpen: true, rightW: next });
        return next;
      });
    });
    // `persist` only closes over state for the browser-bus callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adjustWidth = (side: StudioResizeSide, delta: number) => {
    if (side === "left") {
      setLeftW((value) => {
        const next = clampLeft(value + delta);
        persist({ leftW: next });
        return next;
      });
      return;
    }
    setPanelW((value) => {
      const next = clampRight(value + delta);
      persist({ rightW: next });
      return next;
    });
  };

  const resetWidth = (side: StudioResizeSide) => {
    if (side === "left") {
      const next = clampLeft(DEFAULT_LEFT_W);
      setLeftW(next);
      persist({ leftW: next });
    } else {
      const next = clampRight(DEFAULT_RIGHT_W);
      setPanelW(next);
      persist({ rightW: next });
    }
  };

  const startResize = (e: ReactPointerEvent, side: StudioResizeSide = "right") => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? leftW : panelW;
    let latest = startW;
    setResizing(side);
    const onMove = (event: PointerEvent) => {
      const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
      latest = side === "left" ? clampLeft(startW + delta) : clampRight(startW + delta);
      if (side === "left") setLeftW(latest);
      else setPanelW(latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setResizing(null);
      persist(side === "left" ? { leftW: latest } : { rightW: latest });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return {
    open,
    compact,
    leftOpen,
    rightOpen,
    leftW,
    panelW,
    resizing,
    profileDirty,
    pathDirty,
    browserSlotRef,
    panelKeys,
    setPanel,
    toggle,
    toggleLeft,
    toggleRight,
    adjustWidth,
    resetWidth,
    startResize,
  };
}

export const STUDIO_PANEL_LAYOUT = {
  defaultLeft: DEFAULT_LEFT_W,
  minLeft: MIN_LEFT_W,
  maxLeft: MAX_LEFT_W,
  defaultRight: DEFAULT_RIGHT_W,
  minRight: MIN_RIGHT_W,
  maxRight: MAX_RIGHT_W,
  collapsed: COLLAPSED_W,
  minCenter: MIN_CENTER_W,
} as const;
