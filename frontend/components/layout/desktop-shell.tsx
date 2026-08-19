"use client";

import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import {
  BookMarked,
  Compass,
  Database,
  House,
  Library,
  Loader2,
  LogOut,
  MessageCircle,
  PencilRuler,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Search,
  Settings,
  SquareLibrary,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { useAuth } from "@/components/auth-provider";
import { DesktopTeacherLauncher } from "@/components/desktop/desktop-teacher-launcher";
import { DesktopPageTransition } from "@/components/layout/desktop-page-transition";
import {
  DesktopBookTransition,
  type DesktopBookTransitionPhase,
} from "@/components/layout/desktop-book-transition";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useMaterialGenerator } from "@/hooks/use-material-generator";
import { UserAvatar } from "@/components/user-avatar";
import { checkBackend } from "@/lib/api";
import {
  getDesktopModuleReturnHref,
  rememberDesktopModuleHref,
} from "@/lib/desktop-module-view";
import {
  DESKTOP_BOOK_CLOSE_DURATION_MS,
  DESKTOP_BOOK_OPEN_DURATION_MS,
  DESKTOP_RAIL_INDICATOR_DURATION,
  WEB_EASE,
  normalizeRouteKey,
} from "@/lib/web-motion";
import { cn } from "@/lib/utils";

type DesktopNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  activePrefixes?: string[];
};

const NAV: DesktopNavItem[] = [
  {
    href: "/desktop",
    label: "首页",
    icon: House,
    activePrefixes: ["/desktop/todos", "/desktop/calendar"],
  },
  {
    href: "/desktop/studio",
    label: "智能教师",
    icon: MessageCircle,
    activePrefixes: ["/desktop/create", "/desktop/agents"],
  },
  { href: "/desktop/path", label: "学习路径", icon: Route },
  {
    href: "/desktop/resources",
    label: "资源中心",
    icon: Library,
    activePrefixes: ["/desktop/kb", "/desktop/video-learning"],
  },
  {
    href: "/desktop/practice",
    label: "练习",
    icon: PencilRuler,
    activePrefixes: ["/desktop/code-lab", "/desktop/diagnostic"],
  },
  {
    href: "/desktop/discover",
    label: "发现",
    icon: Compass,
    activePrefixes: ["/desktop/theater", "/desktop/market"],
  },
];

const RAIL_COLLAPSED_KEY = "sl_desktop_rail_collapsed_v1";
const SERVICE_POLL_INTERVAL_MS = 15_000;
type ServiceState = "checking" | "live" | "offline";

function RailLink({
  item,
  active,
  onNavigate,
}: {
  item: DesktopNavItem;
  active: boolean;
  onNavigate: (item: DesktopNavItem) => void;
}) {
  const Icon = item.icon;
  const reducedMotion = useReducedMotion();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn("desktop-rail-link", active && "is-active")}
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
      {active && (
        <motion.span
          aria-hidden
          className="desktop-rail-indicator"
          layoutId={reducedMotion ? undefined : "desktop-rail-indicator"}
          layout={reducedMotion ? false : "position"}
          transition={{ duration: DESKTOP_RAIL_INDICATOR_DURATION, ease: WEB_EASE }}
        />
      )}
      <Icon aria-hidden className="size-6" strokeWidth={active ? 2.1 : 1.75} />
      <span>{item.label}</span>
    </Link>
  );
}

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useOrchestratorContext();
  const { logout, user } = useAuth();
  const materialGenerator = useMaterialGenerator();
  const { name } = useUserSettings();
  const [query, setQuery] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [serviceState, setServiceState] = useState<ServiceState>(session.mode);
  const reducedMotion = useReducedMotion();
  const [bookPhase, setBookPhase] =
    useState<DesktopBookTransitionPhase>("idle");
  const [bookLabel, setBookLabel] = useState("");
  const pendingBookRouteRef = useRef<{ href: string; label: string } | null>(null);
  const bookCloseTimerRef = useRef<number | undefined>(undefined);
  const bookOpenTimerRef = useRef<number | undefined>(undefined);
  const bookFallbackTimerRef = useRef<number | undefined>(undefined);
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
  const profileImmersive = pathname.startsWith("/desktop/profile");
  const homeImmersive = pathname === "/desktop" || pathname === "/desktop/";
  const resourceContext =
    pathname.startsWith("/desktop/resources") ||
    pathname.startsWith("/desktop/video-learning") ||
    pathname.startsWith("/desktop/kb");
  const currentCourse = session.masterPath.length > 0
    ? "总学习路径"
    : session.subjectPaths.length > 0
      ? "科目路径待启用"
      : "待生成学习路径";
  const isActive = (href: string) =>
    href === "/desktop"
      ? pathname === "/desktop" || pathname === "/desktop/"
      : pathname.startsWith(href);
  const isNavItemActive = (item: DesktopNavItem) =>
    isActive(item.href) || item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) === true;

  const navigateFromRail = (item: DesktopNavItem) => {
    if (isNavItemActive(item) || bookPhase !== "idle") return;
    rememberDesktopModuleHref(
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
    const href = getDesktopModuleReturnHref(item.href);
    if (reducedMotion) {
      router.push(href);
      return;
    }

    pendingBookRouteRef.current = { href, label: item.label };
    setBookLabel(item.label);
    setBookPhase("closing");
    window.clearTimeout(bookCloseTimerRef.current);
    window.clearTimeout(bookFallbackTimerRef.current);
    bookCloseTimerRef.current = window.setTimeout(() => {
      setBookPhase("closed");
      router.push(href);
      bookFallbackTimerRef.current = window.setTimeout(() => {
        setBookPhase((current) => (current === "closed" ? "opening" : current));
      }, 800);
    }, DESKTOP_BOOK_CLOSE_DURATION_MS);
  };

  useEffect(() => {
    if (bookPhase !== "closed") return;
    const pending = pendingBookRouteRef.current;
    if (!pending) return;
    const current = normalizeRouteKey(pathname);
    const target = normalizeRouteKey(pending.href.split(/[?#]/, 1)[0]);
    const arrived =
      target === "/desktop"
        ? current === target
        : current === target || current.startsWith(`${target}/`);
    if (!arrived) return;
    const frame = window.requestAnimationFrame(() => setBookPhase("opening"));
    return () => window.cancelAnimationFrame(frame);
  }, [bookPhase, pathname]);

  useEffect(() => {
    if (bookPhase !== "opening") return;
    window.clearTimeout(bookFallbackTimerRef.current);
    bookOpenTimerRef.current = window.setTimeout(() => {
      pendingBookRouteRef.current = null;
      setBookPhase("idle");
    }, DESKTOP_BOOK_OPEN_DURATION_MS);
    return () => window.clearTimeout(bookOpenTimerRef.current);
  }, [bookPhase]);

  useEffect(() => {
    return () => {
      window.clearTimeout(bookCloseTimerRef.current);
      window.clearTimeout(bookOpenTimerRef.current);
      window.clearTimeout(bookFallbackTimerRef.current);
    };
  }, []);
  useEffect(() => {
    setServiceState(session.mode);
  }, [session.mode]);
  useEffect(() => {
    let cancelled = false;
    const refreshServiceState = async () => {
      const live = await checkBackend();
      if (!cancelled) setServiceState(live ? "live" : "offline");
    };
    const handleReconnect = () => {
      setServiceState("checking");
      void refreshServiceState();
    };

    const timer = window.setInterval(refreshServiceState, SERVICE_POLL_INTERVAL_MS);
    window.addEventListener("online", handleReconnect);
    window.addEventListener("focus", handleReconnect);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", handleReconnect);
      window.removeEventListener("focus", handleReconnect);
    };
  }, []);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = query.trim();
    router.push(
      normalized
        ? `/desktop/resources?q=${encodeURIComponent(normalized)}`
        : "/desktop/resources"
    );
  };

  return (
    <div className="desktop-scope flex h-dvh min-w-[1024px] overflow-hidden bg-background">
      <aside className={cn("desktop-rail", railCollapsed && "is-collapsed")} aria-label="桌面主导航">
        <Link href="/desktop" className="desktop-brand" aria-label="返回首页">
          <Image
            src="/brand/desktop/xueshu-plaque-v3.png"
            alt=""
            width={112}
            height={86}
            priority
            className="desktop-brand__plaque"
          />
          <span className="sr-only">学枢</span>
          <span className="sr-only">XUESHU</span>
        </Link>

        <button
          type="button"
          onClick={toggleRail}
          className="desktop-rail-toggle"
          aria-label={railCollapsed ? "展开主要功能侧栏" : "收起主要功能侧栏"}
          title={railCollapsed ? "展开主要功能侧栏" : "收起主要功能侧栏"}
        >
          {railCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>

        <LayoutGroup id="desktop-rail">
          <nav className="flex w-full flex-1 flex-col gap-1.5" aria-label="主要功能">
            {NAV.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                active={isNavItemActive(item)}
                onNavigate={navigateFromRail}
              />
            ))}
          </nav>
        </LayoutGroup>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col" data-desktop-page-shell>
        {!profileImmersive && !homeImmersive && <header className={cn("desktop-topbar", resourceContext && "is-resource-context")}>
          <form className="desktop-global-search" role="search" onSubmit={submitSearch}>
            <Search aria-hidden className="size-4 shrink-0" />
            <label className="sr-only" htmlFor="desktop-global-search">
              搜索知识库与资源
            </label>
            <input
              id="desktop-global-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索资源、课程、知识点…"
              autoComplete="off"
            />
            <button type="submit">搜索</button>
          </form>

          <nav className="desktop-topbar-tools" aria-label="快捷入口">
            {resourceContext && (
              <div className="desktop-resource-shortcuts" aria-label="资源中心快捷入口">
                <Link href="/desktop/resources?origin=referenced" className="desktop-resource-shortcut">
                  <BookMarked aria-hidden className="size-[16px]" />
                  <span>知识来源</span>
                </Link>
                <Link
                  href="/desktop/video-learning"
                  className={cn(
                    "desktop-resource-shortcut",
                    pathname.startsWith("/desktop/video-learning") && "is-active"
                  )}
                >
                  <Video aria-hidden className="size-[16px]" />
                  <span>视频学习</span>
                </Link>
                <Link
                  href="/desktop/kb"
                  className={cn(
                    "desktop-resource-shortcut is-knowledge-base",
                    pathname.startsWith("/desktop/kb") && "is-active"
                  )}
                >
                  <Database aria-hidden className="size-[16px]" />
                  <span>知识库</span>
                </Link>
              </div>
            )}
            {materialGenerator.running && (
              <Link
                href="/desktop/studio"
                className="desktop-compact-tool"
                title="资源正在后台持续生成，点击返回智能教师"
              >
                <Loader2 aria-hidden className="size-[17px] animate-spin" />
                <span>资源生成中</span>
              </Link>
            )}
            {!resourceContext && (
              <Link href="/desktop/path" className="desktop-course-chip" title="打开总学习路径">
                <SquareLibrary aria-hidden className="size-[18px]" />
                <span>{currentCourse}</span>
              </Link>
            )}
            <span
              className={cn(
                "desktop-service-state",
                serviceState === "live" && "is-live",
                serviceState === "offline" && "is-offline"
              )}
              title={
                serviceState === "live"
                  ? "学习服务实时检测正常"
                  : serviceState === "offline"
                    ? "学习服务实时检测异常，可在个人菜单的设置中查看恢复方法"
                    : "正在检查学习服务"
              }
              role="status"
              aria-live="polite"
            >
              <span aria-hidden className="desktop-service-dot" />
              <span>
                {serviceState === "live"
                  ? "服务正常"
                  : serviceState === "offline"
                    ? "服务异常"
                    : "检查服务"}
              </span>
            </span>
            <details className="group relative">
              <summary className="desktop-user-link cursor-pointer list-none" aria-label="打开个人菜单">
                <UserAvatar userId={user?.id} name={displayName} size={28} fallback="mascot" />
                <strong>{displayName}</strong>
                <UserRound aria-hidden className="size-4" />
              </summary>
              <div className="absolute right-0 top-[calc(100%+10px)] z-[80] grid w-52 gap-1 rounded-xl border border-[#d7c8b1] bg-[#fffaf2] p-2 shadow-xl">
                <Link href="/desktop/profile" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#4f3c27] hover:bg-[#eee3d2]">
                  <UserRound aria-hidden className="size-4" />
                  个人主页
                </Link>
                <Link href="/desktop/settings" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[#4f3c27] hover:bg-[#eee3d2]">
                  <Settings aria-hidden className="size-4" />
                  目标与设置
                </Link>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#8f3f34] hover:bg-[#f2dfd8]"
                  onClick={async () => {
                    await logout();
                    router.replace("/login");
                  }}
                >
                  <LogOut aria-hidden className="size-4" />
                  退出登录
                </button>
              </div>
            </details>
          </nav>
        </header>}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <DesktopPageTransition>{children}</DesktopPageTransition>
        </main>
        {!pathname.startsWith("/desktop/studio") && !pathname.startsWith("/desktop/resources") && (
          <DesktopTeacherLauncher railCollapsed={railCollapsed} />
        )}
        <DesktopBookTransition phase={bookPhase} label={bookLabel} />
      </div>
    </div>
  );
}
