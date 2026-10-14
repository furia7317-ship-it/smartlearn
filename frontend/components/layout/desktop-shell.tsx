"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { DesktopTeacherLauncher } from "@/components/desktop/desktop-teacher-launcher";
import { DesktopPageTransition } from "@/components/layout/desktop-page-transition";
import { DesktopSoundFeedback } from "@/components/layout/desktop-sound-feedback";
import { useUserSettings } from "@/hooks/use-user-settings";
import { DesktopAccount } from "./desktop-account";
import {
  getDesktopModuleReturnHref,
  getDesktopModuleId,
  rememberDesktopModuleHref,
} from "@/lib/desktop-module-view";
import {
  DESKTOP_RAIL_INDICATOR_DURATION,
  WEB_EASE,
} from "@/lib/web-motion";
import { cn } from "@/lib/utils";
import { DesktopWelcomeGuide } from "@/components/welcome/desktop-welcome-guide";

type DesktopNavItem = {
  href: string;
  label: string;
  activePrefixes?: string[];
};

const NAV: DesktopNavItem[] = [
  {
    href: "/desktop",
    label: "首页",
    activePrefixes: ["/desktop/todos", "/desktop/calendar"],
  },
  { href: "/desktop/path", label: "学习路径" },
  { href: "/desktop/training", label: "实训中心" },
  {
    href: "/desktop/resources",
    label: "资源中心",
    activePrefixes: ["/desktop/create", "/desktop/kb", "/desktop/video-learning"],
  },
  {
    href: "/desktop/discover",
    label: "发现",
    activePrefixes: ["/desktop/theater", "/desktop/market"],
  },
];

const RAIL_COLLAPSED_KEY = "sl_desktop_rail_collapsed_v1";
const NAVIGATION_PENDING_TIMEOUT_MS = 10_000;

function RailLink({
  item,
  active,
  pending,
  onNavigate,
  onPrefetch,
}: {
  item: DesktopNavItem;
  active: boolean;
  pending: boolean;
  onNavigate: (item: DesktopNavItem) => void;
  onPrefetch: (item: DesktopNavItem) => void;
}) {
  const reducedMotion = useReducedMotion();
  const highlighted = active || pending;
  return (
    <Link
      href={item.href}
      prefetch={false}
      data-guide={`nav-${item.href === "/desktop" ? "home" : item.href.split("/").pop()}`}
      aria-current={active ? "page" : undefined}
      aria-busy={pending || undefined}
      data-navigation-pending={pending ? "true" : undefined}
      title={pending ? `正在打开${item.label}` : item.label}
      className={cn("desktop-rail-link", highlighted && "is-active")}
      onMouseEnter={() => onPrefetch(item)}
      onFocus={() => onPrefetch(item)}
      onTouchStart={() => onPrefetch(item)}
      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onNavigate(item);
      }}
    >
      {highlighted && (
        <motion.span
          aria-hidden
          className="desktop-rail-indicator"
          layoutId={reducedMotion ? undefined : "desktop-rail-indicator"}
          layout={reducedMotion ? false : "position"}
          transition={{ duration: DESKTOP_RAIL_INDICATOR_DURATION, ease: WEB_EASE }}
        />
      )}
      <span className="desktop-rail-link__label">{item.label}</span>
    </Link>
  );
}

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { name } = useUserSettings();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [pendingHref, setPendingHref] = useState("");
  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {
      /* keep the default width when storage is unavailable */
    }
  }, []);
  const toggleRail = () => {
    setRailCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* keep the in-memory preference */
      }
      return next;
    });
  };
  const displayName = name.trim() || "同学";
  const isActive = (href: string) =>
    href === "/desktop"
      ? pathname === "/desktop" || pathname === "/desktop/"
      : pathname.startsWith(href);
  const isNavItemActive = (item: DesktopNavItem) =>
    isActive(item.href) || item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) === true;
  const pendingModuleId = pendingHref ? getDesktopModuleId(pendingHref) : null;
  const isNavItemPending = (item: DesktopNavItem) =>
    pendingModuleId !== null && getDesktopModuleId(item.href) === pendingModuleId;

  useEffect(() => {
    if (!pendingHref) return;
    if (getDesktopModuleId(pathname) === getDesktopModuleId(pendingHref)) {
      setPendingHref("");
      return;
    }

    const timer = globalThis.setTimeout(() => {
      setPendingHref((current) => current === pendingHref ? "" : current);
    }, NAVIGATION_PENDING_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [pathname, pendingHref]);

  const navigateFromRail = (item: DesktopNavItem) => {
    if (isNavItemActive(item) || isNavItemPending(item)) return;
    const href = getDesktopModuleReturnHref(item.href);
    setPendingHref(href);
    rememberDesktopModuleHref(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    router.push(href);
  };
  const prefetchFromRail = (item: DesktopNavItem) => {
    if (isNavItemActive(item) || isNavItemPending(item)) return;
    router.prefetch(getDesktopModuleReturnHref(item.href));
  };

  return (
    <div className="desktop-scope flex h-dvh min-w-0 flex-col overflow-hidden bg-background md:flex-row">
      <DesktopSoundFeedback />
      <aside className={cn("desktop-rail", railCollapsed && "is-collapsed")} aria-label="桌面主导航">
        <Link href="/desktop" className="desktop-brand" aria-label="学枢，返回首页">
          <span className="desktop-brand__frame" aria-hidden>
            <span className="desktop-brand__title">学枢</span>
          </span>
          <span className="sr-only">XUESHU</span>
        </Link>

        <button
          type="button"
          onClick={toggleRail}
          className="desktop-rail-toggle"
          aria-expanded={!railCollapsed}
          aria-label={railCollapsed ? "展开主要功能侧栏" : "收起主要功能侧栏"}
          title={railCollapsed ? "展开主要功能侧栏" : "收起主要功能侧栏"}
        >
          {railCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>

        <LayoutGroup id="desktop-rail">
          <nav className="flex w-full flex-1 gap-1.5 md:flex-col" aria-label="主要功能">
            {NAV.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={!pendingHref && isNavItemActive(item)}
                pending={isNavItemPending(item)}
                onNavigate={navigateFromRail}
                onPrefetch={prefetchFromRail}
              />
            ))}
          </nav>
        </LayoutGroup>

        <DesktopAccount name={displayName} />
      </aside>

      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        data-desktop-page-shell
        aria-busy={Boolean(pendingHref)}
      >
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DesktopPageTransition>
            {children}
          </DesktopPageTransition>
        </main>
        <DesktopTeacherLauncher railCollapsed={railCollapsed} />
      </div>
      <DesktopWelcomeGuide />
    </div>
  );
}
