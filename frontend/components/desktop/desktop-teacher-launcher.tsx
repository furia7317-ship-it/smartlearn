"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowUp,
  GripHorizontal,
  Loader2,
  MessageCircle,
  Minimize2,
  X,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { cn } from "@/lib/utils";

const VoiceCallControl = dynamic(
  () => import("@/components/voice-call-control").then((module) => module.VoiceCallControl),
  { ssr: false },
);

type LauncherPosition = {
  left: number;
  top: number;
};

type DragState = LauncherPosition & {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

const POSITION_STORAGE_KEY = "sl_desktop_teacher_position_v1";
const DISMISSED_SESSION_KEY = "sl_desktop_teacher_dismissed_v1";
const VIEWPORT_GAP = 12;
const STANDARD_LAUNCHER_SIZE_CLASS = "grid size-16";
const SAFE_DOCK_LAUNCHER_SIZE_CLASS = "grid size-12";

export function clampTeacherLauncherPosition(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): LauncherPosition {
  const maxLeft = Math.max(VIEWPORT_GAP, viewportWidth - width - VIEWPORT_GAP);
  const maxTop = Math.max(VIEWPORT_GAP, viewportHeight - height - VIEWPORT_GAP);
  return {
    left: Math.min(Math.max(left, VIEWPORT_GAP), maxLeft),
    top: Math.min(Math.max(top, VIEWPORT_GAP), maxTop),
  };
}

export function DesktopTeacherLauncher({
  safeDock = false,
  railCollapsed = false,
}: {
  safeDock?: boolean;
  railCollapsed?: boolean;
}) {
  const session = useOrchestratorContext();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [draft, setDraft] = useState("");
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionRef = useRef<LauncherPosition | null>(null);
  const collapsedPositionRef = useRef<LauncherPosition | null>(null);
  const suppressClickRef = useRef(false);

  const applyPosition = (next: LauncherPosition) => {
    positionRef.current = next;
    setPosition(next);
  };

  const clampToViewport = (left: number, top: number) => {
    const node = launcherRef.current;
    if (!node) return { left, top };
    const rect = node.getBoundingClientRect();
    return clampTeacherLauncherPosition(
      left,
      top,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    );
  };

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISSED_SESSION_KEY) === "1");
    } catch {
      /* keep the launcher visible when session storage is unavailable */
    }
  }, []);

  useEffect(() => {
    if (safeDock) {
      positionRef.current = null;
      setPosition(null);
      return;
    }
    try {
      const saved = window.localStorage.getItem(POSITION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<LauncherPosition>;
      if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return;
      const frame = window.requestAnimationFrame(() => {
        applyPosition(clampToViewport(parsed.left as number, parsed.top as number));
      });
      return () => window.cancelAnimationFrame(frame);
    } catch {
      window.localStorage.removeItem(POSITION_STORAGE_KEY);
    }
  }, [safeDock]);

  useEffect(() => {
    const keepInViewport = () => {
      const current = positionRef.current;
      if (!current) return;
      applyPosition(clampToViewport(current.left, current.top));
    };
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, []);

  useEffect(() => {
    if (!open) return;
    const current = positionRef.current;
    if (!current) return;
    const frame = window.requestAnimationFrame(() => {
      applyPosition(clampToViewport(current.left, current.top));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, session.messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || session.running || session.mode !== "live") return;
    setDraft("");
    session.send(text);
  };

  const openLauncher = () => {
    collapsedPositionRef.current = positionRef.current;
    setOpen(true);
  };

  const minimizeLauncher = () => {
    const collapsedPosition = collapsedPositionRef.current;
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (collapsedPosition) {
        applyPosition(clampToViewport(collapsedPosition.left, collapsedPosition.top));
      } else {
        positionRef.current = null;
        setPosition(null);
      }
    });
  };

  const dismissLauncher = () => {
    try {
      window.sessionStorage.setItem(DISMISSED_SESSION_KEY, "1");
    } catch {
      /* the in-memory dismissal still applies */
    }
    setDismissed(true);
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (
      open &&
      event.target instanceof HTMLElement &&
      event.target.closest("button, textarea, input, a")
    ) {
      return;
    }
    const rect = launcherRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    suppressClickRef.current = true;
    applyPosition(clampToViewport(drag.left + deltaX, drag.top + deltaY));
    event.preventDefault();
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    const current = positionRef.current;
    if (current && !safeDock) {
      window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(current));
    }
  };

  const launcherStyle: CSSProperties | undefined = position
    ? { left: position.left, top: position.top }
    : undefined;

  if (dismissed) return null;

  return (
    <div
      ref={launcherRef}
      className={cn(
        "fixed z-50",
        !position && !safeDock && "bottom-5 right-5",
        !position && safeDock && !railCollapsed && "bottom-7 left-[118px]",
        !position && safeDock && railCollapsed && "bottom-5 left-3",
      )}
      style={launcherStyle}
      data-safe-dock={safeDock ? "true" : undefined}
    >
      {open ? (
        <section
          role="dialog"
          aria-label="询问智能教师"
          className="relative flex h-[min(560px,calc(100dvh-96px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[#cdbb9f] bg-[#fffaf1] shadow-[0_24px_70px_rgba(50,35,18,0.28)]"
        >
          <header
            className="flex h-14 shrink-0 touch-none select-none items-center gap-2 border-b border-[#dfd0ba] px-4 cursor-grab active:cursor-grabbing"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            aria-label="拖动智能教师窗口"
          >
            <GripHorizontal className="size-4 shrink-0 text-[#9b8568]" aria-hidden />
            <span className="grid size-8 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1]">
              <MessageCircle className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[#332719]">智能教师</h2>
              <p className="truncate text-[10px] text-[#786650]">
                {session.running ? "正在回答…" : "随时询问当前学习内容"}
              </p>
            </div>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]"
              onClick={minimizeLauncher}
              aria-label="收起智能教师"
              title="收起为悬浮按钮"
            >
              <Minimize2 className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]"
              onClick={dismissLauncher}
              aria-label="关闭智能教师"
              title="本次使用不再显示悬浮气泡"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div
            ref={scrollRef}
            className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {session.messages.length === 0 && (
              <div className="grid min-h-56 content-center text-center">
                <MessageCircle className="mx-auto size-7 text-[#9b6b2d]" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-[#332719]">现在想弄懂什么？</p>
              </div>
            )}
            {session.messages.slice(-8).map((message) => (
              <article
                key={message.id}
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap text-xs leading-5",
                  message.role === "user"
                    ? "ml-auto rounded-xl bg-[#4f351a] px-3 py-2.5 text-[#fffaf1]"
                    : "border-l-2 border-[#c99b60] pl-3 text-[#443521]",
                )}
              >
                {message.content || (message.role === "assistant" && session.running ? "正在思考…" : "")}
              </article>
            ))}
            {session.running && (
              <p className="flex items-center gap-2 text-[11px] text-[#786650]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                智能教师正在组织回答
              </p>
            )}
          </div>

          <div className="shrink-0 border-t border-[#dfd0ba] bg-white/55 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-[#d5c3a8] bg-white px-2.5 py-2 focus-within:ring-2 focus-within:ring-[#c59a62]/30">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder={session.mode === "live" ? "询问智能教师…" : "学习服务暂不可用"}
                disabled={session.mode !== "live"}
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-[#332719] outline-none placeholder:text-[#9a8a75] disabled:cursor-not-allowed"
              />
              <VoiceCallControl
                compact
                surfaceMode="inline"
                messages={session.messages}
                running={session.conversationRunning}
                enabled={session.mode === "live"}
                onSend={session.send}
                onStop={session.stop}
                onNewConversation={() => {
                  session.newConversation();
                }}
                resources={session.resources}
              />
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || session.conversationRunning || session.mode !== "live"}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="发送问题"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onClick={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              suppressClickRef.current = false;
              return;
            }
            openLauncher();
          }}
          className={cn(
            "group relative touch-none cursor-grab select-none place-items-center rounded-full border border-[#cdb996] bg-[#fffaf1]/96 text-[#332719] shadow-[0_12px_30px_rgba(50,35,18,0.24)] backdrop-blur transition hover:-translate-y-1 hover:border-[#ad7b41] hover:bg-white active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62] focus-visible:ring-offset-2",
            safeDock ? SAFE_DOCK_LAUNCHER_SIZE_CLASS : STANDARD_LAUNCHER_SIZE_CLASS,
          )}
          aria-label="询问智能教师"
          title="拖动气泡，点击提问"
        >
          <Image
            src="/brand/xueshu-app-icon.png"
            alt=""
            width={safeDock ? 40 : 52}
            height={safeDock ? 40 : 52}
            loading="eager"
            className={cn(
              "rounded-full border border-[#d7c5a9] object-cover",
              safeDock ? "size-10" : "size-[52px]",
            )}
          />
          <span className={cn(
            "absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border-2 border-[#fffaf1] bg-[#8c5b25] text-[#fffaf1] shadow-sm transition-transform group-hover:scale-105",
            safeDock ? "size-5" : "size-6",
          )}>
            <MessageCircle className={safeDock ? "size-3" : "size-3.5"} aria-hidden />
          </span>
          <span className="sr-only">智能教师，点击问一道题</span>
        </button>
      )}
    </div>
  );
}
