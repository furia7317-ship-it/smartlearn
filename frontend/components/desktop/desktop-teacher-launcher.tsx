"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUp,
  BookMarked,
  ChevronLeft,
  FileText,
  History,
  ImageIcon,
  Loader2,
  Maximize2,
  MessageCircle,
  Minimize2,
  Paperclip,
  PencilLine,
  Plus,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";

import { AssistantAvatar } from "@/components/agent-bits";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { useTeacherWindow } from "@/components/desktop/teacher-window-provider";
import { uploadTutorAttachment } from "@/lib/api";
import { getMaterialData } from "@/lib/library";
import type { ChatMessage, ResourceItem, TutorAttachment, TutorPageContext } from "@/lib/types";
import { cn } from "@/lib/utils";

const loadVoiceCallControl = () => import("@/components/voice-call-control")
  .then((module) => module.VoiceCallControl);

const VoiceCallControl = memo(dynamic(
  loadVoiceCallControl,
  { ssr: false },
));

const ResourceViewer = dynamic(
  () => import("@/components/resource-viewer").then((module) => module.ResourceViewer),
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
  width: number;
  height: number;
  moved: boolean;
};

const POSITION_STORAGE_KEY = "sl_desktop_teacher_position_v1";
const VIEWPORT_GAP = 12;
const DOCK_SNAP_DISTANCE = 36;
const STANDARD_LAUNCHER_SIZE_CLASS = "grid size-16";
const SAFE_DOCK_LAUNCHER_SIZE_CLASS = "grid size-12";
const CONTROL_BUTTON_CLASS = "transform-gpu transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-90 disabled:active:scale-100";
const ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".py",
  ".java",
  ".c",
  ".cpp",
].join(",");

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function compactMessageDestination(message: ChatMessage): { href: string; label: string } | null {
  if (message.kind === "plan_review" || message.kind === "plan") {
    return { href: "/desktop/create", label: "前往生成资料处理" };
  }
  if (message.kind === "resources") {
    return { href: "/desktop/resources", label: "查看生成资料" };
  }
  if (message.kind === "path") {
    return { href: "/desktop/path", label: "查看学习路径" };
  }
  return null;
}

function teacherContextForPathname(pathname: string): TutorPageContext {
  if (pathname.startsWith("/desktop/path")) {
    return { module: "learning_path", title: "学习路径", detail: "结合当前课程路径、节点顺序和学习进度回答。" };
  }
  if (pathname.startsWith("/desktop/resources") || pathname.startsWith("/desktop/kb")) {
    return { module: "resources", title: "资源中心", detail: "结合当前资料、知识库内容和资源关系回答。" };
  }
  if (pathname.startsWith("/desktop/create")) {
    return { module: "resource_creation", title: "生成资料", detail: "协助梳理资料生成目标、要求和产出。" };
  }
  if (pathname.startsWith("/desktop/practice") || pathname.startsWith("/desktop/path/assessment")) {
    return { module: "assessment", title: "练习与测评", detail: "结合当前课程、答题情况和薄弱点回答。" };
  }
  if (pathname.startsWith("/desktop/discover")) {
    return { module: "discover", title: "发现", detail: "结合当前浏览到的课程与内容回答。" };
  }
  return { module: "home", title: "学习首页", detail: "结合当前学习安排、任务和近期进度回答。" };
}

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

const TeacherMessageList = memo(forwardRef<HTMLDivElement, {
  messages: ChatMessage[];
  conversationRunning: boolean;
  reducedMotion: boolean;
}>(function TeacherMessageList({ messages, conversationRunning, reducedMotion }, ref) {
  return (
    <div
      ref={ref}
      className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      aria-label="教师对话消息"
      tabIndex={0}
    >
      {messages.length === 0 && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid min-h-56 content-center text-center"
        >
          <MessageCircle className="mx-auto size-7 text-[#9b6b2d]" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-[#332719]">现在想弄懂什么？</p>
          <p className="mx-auto mt-1 max-w-64 text-[11px] leading-5 text-[#846f55]">可以结合当前页面提问，也可以上传图片、PDF 或文档。</p>
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {messages.map((message) => {
          const destination = compactMessageDestination(message);
          return (
            <motion.article
              key={message.id}
              initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "transform-gpu text-xs leading-5",
                message.role === "user"
                  ? "ml-auto w-fit min-w-12 max-w-[82%] rounded-xl bg-[#4f351a] px-3 py-2.5 text-[#fffaf1]"
                  : "mr-auto max-w-[94%] border-l-2 border-[#c99b60] pl-3 text-[#443521]",
              )}
            >
              {message.role === "assistant" ? (
                <Markdown
                  content={message.content}
                  streaming={message.streaming}
                  interceptLinks
                  className="md-tight text-xs leading-5 text-inherit"
                  fallback={message.streaming ? <span className="text-[#806d55]">正在思考…</span> : null}
                />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {message.attachments.map((attachment) => <span key={attachment.id} className="rounded border border-current/20 px-1.5 py-0.5 text-[9px] opacity-80">{attachment.name}</span>)}
                </div>
              )}
              {destination && (
                <Link href={destination.href} className={cn("mt-2 inline-flex rounded-md border border-[#cdb998] bg-[#fffaf1] px-2 py-1 text-[10px] font-medium text-[#704719] hover:bg-[#f2e7d8]", CONTROL_BUTTON_CLASS)}>
                  {destination.label}
                </Link>
              )}
            </motion.article>
          );
        })}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {conversationRunning && (
          <motion.p
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            className="flex items-center gap-2 text-[11px] text-[#786650]"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            智能教师正在组织回答
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}));

TeacherMessageList.displayName = "TeacherMessageList";

export function DesktopTeacherLauncher({
  safeDock = false,
  railCollapsed = false,
}: {
  safeDock?: boolean;
  railCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const session = useOrchestratorContext();
  const {
    acknowledgeSoftwareAction,
    mode: sessionMode,
    pendingSoftwareAction,
    resources: sessionResources,
  } = session;
  const {
    open,
    wide,
    draft,
    context,
    openTeacher,
    minimizeTeacher,
    toggleWide,
    setDraft,
    clearContext,
  } = useTeacherWindow();
  const routeContext = useMemo(() => teacherContextForPathname(pathname), [pathname]);
  const activeContext = context ?? routeContext;
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  const [showConversations, setShowConversations] = useState(false);
  const [openResource, setOpenResource] = useState<ResourceItem | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
  const [attachments, setAttachments] = useState<TutorAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const positionRef = useRef<LauncherPosition | null>(null);
  const collapsedPositionRef = useRef<LauncherPosition | null>(null);
  const suppressClickRef = useRef(false);
  const minimizeLauncherRef = useRef<() => void>(() => undefined);
  const dragFrameRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<LauncherPosition | null>(null);

  const applyPosition = (next: LauncherPosition) => {
    positionRef.current = next;
    setPosition(next);
  };

  const writePositionToElement = (next: LauncherPosition) => {
    const node = launcherRef.current;
    if (!node) return;
    node.style.left = `${next.left}px`;
    node.style.top = `${next.top}px`;
    node.style.right = "auto";
    node.style.bottom = "auto";
  };

  const previewPosition = (next: LauncherPosition) => {
    positionRef.current = next;
    pendingDragPositionRef.current = next;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pending = pendingDragPositionRef.current;
      pendingDragPositionRef.current = null;
      if (pending) writePositionToElement(pending);
    });
  };

  const flushPreviewPosition = () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    const pending = pendingDragPositionRef.current;
    pendingDragPositionRef.current = null;
    if (pending) writePositionToElement(pending);
  };

  const resetPosition = () => {
    positionRef.current = null;
    setPosition(null);
    const node = launcherRef.current;
    if (!node) return;
    node.style.removeProperty("left");
    node.style.removeProperty("top");
    node.style.removeProperty("right");
    node.style.removeProperty("bottom");
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
    const idle = window.requestIdleCallback?.(() => {
      void loadVoiceCallControl().catch(() => undefined);
    }, { timeout: 1500 });
    if (idle !== undefined) return () => window.cancelIdleCallback(idle);
    const timer = window.setTimeout(() => {
      void loadVoiceCallControl().catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (safeDock) {
      resetPosition();
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

  useEffect(() => () => {
    dragCleanupRef.current?.();
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const current = positionRef.current;
    if (!current) return;
    const frame = window.requestAnimationFrame(() => {
      applyPosition(clampToViewport(current.left, current.top));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, wide]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, session.messages]);

  useEffect(() => {
    const action = pendingSoftwareAction;
    if (!action || action.type !== "open_resource") return;
    let cancelled = false;
    const resource = sessionResources.find((item) => item.id === action.resourceId && item.status === "ready");
    if (!resource) {
      acknowledgeSoftwareAction(action.id);
      return;
    }
    setResourceViewerActivated(true);
    void getMaterialData(sessionMode, resource.id)
      .catch(() => undefined)
      .then((data) => {
        if (!cancelled) setOpenResource(data ? { ...resource, data } : resource);
      })
      .finally(() => acknowledgeSoftwareAction(action.id));
    return () => {
      cancelled = true;
    };
  }, [acknowledgeSoftwareAction, pendingSoftwareAction, sessionMode, sessionResources]);

  const sendQuestion = useCallback((
    question: string,
    pendingAttachments: TutorAttachment[] = [],
    responseMode: "text" | "voice" = "text",
  ): boolean => {
    if (responseMode !== "voice" && activeContext.module === "resource" && activeContext.entityId && pendingAttachments.length === 0) {
      return session.askResourceQuestion({
        resourceId: activeContext.entityId,
        resourceTitle: activeContext.title || "当前资料",
        resourceContext: activeContext.detail || "围绕当前资料内容进行问答",
        prompt: `我正在学习资料「${activeContext.title || "当前资料"}」。${activeContext.detail ? `当前参考内容：${activeContext.detail}\n\n` : ""}我的问题：${question}`,
        displayQuestion: question,
      });
    }
    session.send(question, pendingAttachments, activeContext, responseMode);
    return true;
  }, [activeContext, session]);

  const submit = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || uploadingFiles.length > 0 || session.conversationRunning || session.mode !== "live") return;
    const question = text || "请阅读这些附件并解答其中的问题，给出关键步骤、结论和必要的逐题解析。";
    if (!sendQuestion(question, attachments)) return;
    setDraft("");
    setAttachments([]);
    setAttachmentError("");
  };

  const openLauncher = () => {
    collapsedPositionRef.current = positionRef.current;
    openTeacher();
  };

  const minimizeLauncher = () => {
    const collapsedPosition = collapsedPositionRef.current;
    minimizeTeacher();
    setShowConversations(false);
    window.requestAnimationFrame(() => {
      if (collapsedPosition) {
        applyPosition(clampToViewport(collapsedPosition.left, collapsedPosition.top));
      } else {
        resetPosition();
      }
      orbRef.current?.focus();
    });
  };
  useEffect(() => {
    minimizeLauncherRef.current = minimizeLauncher;
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      minimizeLauncherRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const addFiles = async (fileList: FileList | File[]) => {
    const availableSlots = Math.max(0, 5 - attachments.length - uploadingFiles.length);
    const selected = Array.from(fileList).slice(0, availableSlots);
    if (selected.length === 0) {
      setAttachmentError("每次最多附加 5 个文件。请先移除不需要的附件。");
      return;
    }
    setAttachmentError("");
    setUploadingFiles((current) => [...current, ...selected.map((file) => file.name)]);
    const results = await Promise.allSettled(selected.map((file) => uploadTutorAttachment(file)));
    const uploaded: TutorAttachment[] = [];
    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") uploaded.push(result.value);
      else failures.push(`${selected[index].name}：${result.reason instanceof Error ? result.reason.message : "上传失败"}`);
    });
    setAttachments((current) => [...current, ...uploaded].slice(0, 5));
    setUploadingFiles((current) => current.filter((name) => !selected.some((file) => file.name === name)));
    if (failures.length > 0) setAttachmentError(failures.join("；"));
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (!session.conversationRunning && event.dataTransfer.files.length > 0) {
      void addFiles(event.dataTransfer.files);
    }
  };

  const moveDrag = (pointerId: number, clientX: number, clientY: number, preventDefault?: () => void) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const deltaX = clientX - drag.startX;
    const deltaY = clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    drag.moved = true;
    suppressClickRef.current = true;
    previewPosition(clampTeacherLauncherPosition(
      drag.left + deltaX,
      drag.top + deltaY,
      drag.width,
      drag.height,
      window.innerWidth,
      window.innerHeight,
    ));
    preventDefault?.();
  };

  const finishDrag = (pointerId: number) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    flushPreviewPosition();
    let current = positionRef.current;
    const rect = launcherRef.current?.getBoundingClientRect();
    if (current && rect) {
      const rightGap = window.innerWidth - rect.right;
      if (rect.left <= DOCK_SNAP_DISTANCE) {
        current = clampToViewport(VIEWPORT_GAP, current.top);
      } else if (rightGap <= DOCK_SNAP_DISTANCE) {
        current = clampToViewport(window.innerWidth - rect.width - VIEWPORT_GAP, current.top);
      }
    }
    if (current) {
      applyPosition(current);
      if (!safeDock) window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(current));
    }
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Icon clicks target an SVGElement rather than an HTMLElement. Treat every
    // DOM Element as interactive-aware so the draggable header never captures
    // clicks meant for history/new/wide/minimize controls.
    if (open && event.target instanceof Element) {
      const interactiveTarget = event.target.closest("button, textarea, input, a");
      if (interactiveTarget) return;
    }
    const rect = launcherRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragCleanupRef.current?.();
    const captureTarget = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    suppressClickRef.current = false;
    // The collapsed launcher is mostly an image. Prevent the browser's native
    // image drag session from stealing pointermove events from our window drag.
    if (!open) event.preventDefault();

    const removeWindowListeners = () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
      if (dragCleanupRef.current === removeWindowListeners) dragCleanupRef.current = null;
    };
    const onWindowPointerMove = (pointer: PointerEvent) => {
      moveDrag(pointer.pointerId, pointer.clientX, pointer.clientY, () => pointer.preventDefault());
    };
    const onWindowPointerEnd = (pointer: PointerEvent) => {
      finishDrag(pointer.pointerId);
      if (captureTarget.hasPointerCapture(pointer.pointerId)) {
        captureTarget.releasePointerCapture(pointer.pointerId);
      }
      removeWindowListeners();
    };
    window.addEventListener("pointermove", onWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    dragCleanupRef.current = removeWindowListeners;
    captureTarget.setPointerCapture(event.pointerId);
  };

  const launcherStyle: CSSProperties | undefined = position
    ? { left: position.left, top: position.top }
    : undefined;
  const activeConversation = useMemo(
    () => session.conversations.find((conversation) => conversation.active),
    [session.conversations],
  );
  const recentMessages = useMemo(
    () => session.messages.slice(wide ? -30 : -12),
    [session.messages, wide],
  );
  const sendVoiceQuestion = useCallback((text: string) => {
    sendQuestion(text, [], "voice");
  }, [sendQuestion]);
  const startNewVoiceConversation = useCallback(() => {
    session.newConversation();
  }, [session]);

  return (
    <div
      ref={launcherRef}
      className={cn(
        "fixed z-[80]",
        !position && !safeDock && "bottom-5 right-5",
        !position && safeDock && !railCollapsed && "bottom-7 left-[118px]",
        !position && safeDock && railCollapsed && "bottom-5 left-3",
      )}
      style={launcherStyle}
      data-safe-dock={safeDock ? "true" : undefined}
    >
      <AnimatePresence initial={false}>
      {open ? (
        <motion.section
          key="teacher-window"
          layout="size"
          initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.965 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.975 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.18, ease: [0.22, 1, 0.36, 1], layout: { duration: reducedMotion ? 0.01 : 0.2 } }}
          role="dialog"
          aria-label="询问智能教师"
          className={cn(
            "relative flex transform-gpu flex-col overflow-hidden rounded-2xl border border-[#cdbb9f] bg-[#fffaf1] shadow-[0_24px_70px_rgba(50,35,18,0.28)] will-change-transform",
            wide
              ? "h-[min(720px,calc(100dvh-48px))] w-[min(720px,calc(100vw-32px))]"
              : "h-[min(560px,calc(100dvh-96px))] w-[min(390px,calc(100vw-32px))]",
          )}
        >
          <header
            className="flex h-14 shrink-0 touch-none select-none items-center gap-2 border-b border-[#dfd0ba] px-3 cursor-grab active:cursor-grabbing"
            onPointerDown={startDrag}
          >
            <AssistantAvatar teacher={session.activeTeacher} className="size-8 rounded-full" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[#332719]">智能教师</h2>
              <p className="truncate text-[11px] text-[#786650]">
                {session.conversationRunning ? "正在回答…" : activeConversation?.title || "随时询问当前学习内容"}
              </p>
            </div>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS, showConversations && "bg-[#e8dac6] text-[#5f4930]")}
              onClick={() => setShowConversations((current) => !current)}
              aria-label={showConversations ? "关闭会话列表" : "打开会话列表"}
              aria-pressed={showConversations}
              title="会话记录"
            >
              <History className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5] disabled:opacity-35", CONTROL_BUTTON_CLASS)}
              onClick={() => {
                session.newConversation(session.activeTeacher);
                setShowConversations(false);
              }}
              disabled={session.conversationRunning}
              aria-label="新建教师会话"
              title="新建会话"
            >
              <Plus className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS, wide && "bg-[#e8dac6] text-[#5f4930]")}
              onClick={toggleWide}
              aria-label={wide ? "切换为快捷窗口" : "展开教师宽窗"}
              aria-pressed={wide}
              title={wide ? "切换为快捷窗口" : "展开宽窗"}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={wide ? "compact" : "wide"}
                  className="grid place-items-center"
                  initial={reducedMotion ? false : { opacity: 0, rotate: -18, scale: 0.8 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={reducedMotion ? undefined : { opacity: 0, rotate: 18, scale: 0.8 }}
                  transition={{ duration: 0.12 }}
                >
                  {wide ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
                </motion.span>
              </AnimatePresence>
            </button>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS)}
              onClick={minimizeLauncher}
              aria-label="收起智能教师"
              title="收起为悬浮按钮"
            >
              <ChevronLeft className="size-4 -rotate-90" aria-hidden />
            </button>
          </header>

          {activeContext && (
            <div className="flex shrink-0 items-center gap-2 border-b border-[#eadfce] bg-[#f5ecdf] px-3 py-2 text-[11px] text-[#5f4930]">
              <BookMarked className="size-3.5 shrink-0 text-[#966126]" aria-hidden />
              <span className="min-w-0 flex-1 truncate" title={[activeContext.module, activeContext.title, activeContext.detail].filter(Boolean).join(" · ")}>
                参考：{activeContext.title || activeContext.module || "当前页面"}
                {activeContext.detail ? ` · ${activeContext.detail}` : ""}
              </span>
              {context && (
                <button type="button" onClick={clearContext} className={cn("shrink-0 rounded px-1.5 py-0.5 text-[#8a6a46] hover:bg-[#e8dac6]", CONTROL_BUTTON_CLASS)} aria-label="恢复参考当前页面">
                  恢复当前页
                </button>
              )}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
            {showConversations && (
              <motion.aside
                key="teacher-conversations"
                initial={reducedMotion ? false : { opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={{ duration: reducedMotion ? 0.01 : 0.16, ease: "easeOut" }}
                className={cn(
                "thin-scroll z-10 shrink-0 overflow-y-auto border-r border-[#dfd0ba] bg-[#f2eadf] p-2",
                wide ? "w-56" : "absolute inset-y-0 left-0 w-[min(280px,82%)] shadow-xl",
              )} aria-label="教师会话记录">
                <div className="mb-2 flex items-center gap-2 px-1 py-1">
                  <strong className="text-xs text-[#443521]">会话记录</strong>
                  <button type="button" onClick={() => setShowConversations(false)} className={cn("ml-auto grid size-7 place-items-center rounded-md text-[#786650] hover:bg-[#e5d8c6]", CONTROL_BUTTON_CLASS)} aria-label="收起会话列表">
                    <ChevronLeft className="size-4" />
                  </button>
                </div>
                <div className="space-y-1">
                  {session.conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                        "group flex w-full items-center gap-1 rounded-lg border p-1 text-left",
                        conversation.active
                          ? "border-[#c59a62] bg-[#fffaf2]"
                          : "border-transparent hover:border-[#d7c5a9] hover:bg-[#fbf6ee]",
                      )}
                    >
                      <button
                        type="button"
                        disabled={conversation.active}
                        onClick={() => {
                          session.openConversation(conversation.id);
                          setShowConversations(false);
                        }}
                        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left disabled:cursor-default", CONTROL_BUTTON_CLASS)}
                      >
                        <AssistantAvatar teacher={conversation.teacher} className="size-7 rounded-md" />
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-[11px] font-medium text-[#443521]">{conversation.title}</strong>
                          <small className="block text-[9px] text-[#8a7861]">{conversation.kind === "resource_qa" ? "资料问答" : conversation.running ? "处理中" : conversation.active ? "当前会话" : "普通会话"}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={session.conversationRunning}
                        onClick={() => {
                          const title = window.prompt("重命名会话", conversation.title)?.trim();
                          if (title) session.renameConversation(conversation.id, title);
                        }}
                        className={cn("grid size-7 shrink-0 place-items-center rounded-md text-[#8a7861] opacity-0 hover:bg-[#eadfce] group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden", CONTROL_BUTTON_CLASS)}
                        aria-label={`重命名会话：${conversation.title}`}
                        title="重命名"
                      >
                        <PencilLine className="size-3" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={session.conversationRunning}
                        onClick={() => {
                          if (window.confirm(`删除会话“${conversation.title}”？`)) session.deleteConversation(conversation.id);
                        }}
                        className={cn("grid size-7 shrink-0 place-items-center rounded-md text-[#9b645b] opacity-0 hover:bg-[#f4dfda] group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden", CONTROL_BUTTON_CLASS)}
                        aria-label={`删除会话：${conversation.title}`}
                        title="删除"
                      >
                        <Trash2 className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={session.conversationRunning || session.messages.length === 0}
                  onClick={() => {
                    if (window.confirm("清空当前会话消息？已生成的资料、学习路径和画像会保留。")) session.clearMessages();
                  }}
                  className={cn("mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#d7c5a9] px-2 py-2 text-[10px] font-medium text-[#765638] hover:bg-[#fffaf2] disabled:cursor-not-allowed disabled:opacity-40", CONTROL_BUTTON_CLASS)}
                >
                  <Trash2 className="size-3" aria-hidden />
                  清空当前消息
                </button>
              </motion.aside>
            )}
            </AnimatePresence>

            <TeacherMessageList
              ref={scrollRef}
              messages={recentMessages}
              conversationRunning={session.conversationRunning}
              reducedMotion={Boolean(reducedMotion)}
            />
          </div>

          <div
            className={cn("relative shrink-0 border-t border-[#dfd0ba] bg-white/55 p-3", dragActive && "bg-[#fff5e6]")}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
            onDrop={handleFileDrop}
          >
            <AnimatePresence initial={false}>
              {dragActive && (
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[#fffaf1]/95 text-xs font-medium text-[#704719]"
                >
                  松开即可加入智能教师
                </motion.div>
              )}
            </AnimatePresence>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {(attachments.length > 0 || uploadingFiles.length > 0) && (
              <motion.div layout className="mb-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="待发送附件">
                {attachments.map((attachment) => (
                  <motion.span layout key={attachment.id} initial={reducedMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="inline-flex max-w-56 items-center gap-1.5 rounded-lg border border-[#d8c7ae] bg-[#fffaf1] px-2 py-1 text-[10px] text-[#5f4a32]">
                    {attachment.kind === "image" ? <ImageIcon className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}
                    <span className="min-w-0"><b className="block truncate font-medium">{attachment.name}</b><small>{formatAttachmentSize(attachment.size)}</small></span>
                    <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className={cn("grid size-5 shrink-0 place-items-center rounded hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS)} aria-label={`移除附件 ${attachment.name}`}><XCircle className="size-3" /></button>
                  </motion.span>
                ))}
                {uploadingFiles.map((name, index) => <span key={`${name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8c7ae] px-2 py-1 text-[10px] text-[#6f5d48]"><Loader2 className="size-3 animate-spin" />正在识别 {name}</span>)}
              </motion.div>
            )}
            {attachmentError && <p className="mb-2 rounded-lg border border-[#c96c5f]/30 bg-[#fff4f1] px-2 py-1.5 text-[10px] leading-4 text-[#9b4738]" role="alert">{attachmentError}</p>}
            <div className="flex items-end gap-2 rounded-xl border border-[#d5c3a8] bg-white px-2.5 py-2 transition-[border-color,box-shadow] duration-150 focus-within:border-[#c59a62] focus-within:ring-2 focus-within:ring-[#c59a62]/30">
              <button
                type="button"
                className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[#765638] hover:bg-[#eee4d5] disabled:opacity-35", CONTROL_BUTTON_CLASS)}
                onClick={() => fileInputRef.current?.click()}
                disabled={session.conversationRunning || attachments.length + uploadingFiles.length >= 5}
                aria-label="上传图片、文档或 PDF"
                title="上传或拖入图片、PDF、Word、PPT、Excel 等文件"
              >
                <Paperclip className="size-4" />
              </button>
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
                placeholder={session.mode === "live" ? `结合“${activeContext.title || activeContext.module || "当前页面"}”提问…` : "学习服务暂不可用"}
                disabled={session.mode !== "live"}
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-[#332719] outline-none placeholder:text-[#9a8a75] disabled:cursor-not-allowed"
              />
              <VoiceCallControl
                compact
                surfaceMode="inline"
                messages={session.messages}
                running={session.conversationRunning}
                enabled={session.mode === "live"}
                onSend={sendVoiceQuestion}
                onStop={session.stop}
                onNewConversation={startNewVoiceConversation}
                resources={session.resources}
              />
              <AnimatePresence mode="wait" initial={false}>
              {session.conversationRunning ? (
                <motion.button
                  key="stop-answer"
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.75, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reducedMotion ? undefined : { opacity: 0, scale: 0.75 }}
                  type="button"
                  onClick={() => void session.stop()}
                  className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-[#9b4738] text-white hover:bg-[#ac5547]", CONTROL_BUTTON_CLASS)}
                  aria-label="停止当前回答"
                  title="停止当前回答"
                >
                  <Square className="size-3 fill-current" />
                </motion.button>
              ) : (
                <motion.button
                  key="send-question"
                  initial={reducedMotion ? false : { opacity: 0, scale: 0.75, rotate: 12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reducedMotion ? undefined : { opacity: 0, scale: 0.75 }}
                  type="button"
                  onClick={submit}
                  disabled={uploadingFiles.length > 0 || (!draft.trim() && attachments.length === 0) || session.mode !== "live"}
                  className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1] hover:bg-[#50371d] disabled:cursor-not-allowed disabled:opacity-35", CONTROL_BUTTON_CLASS)}
                  aria-label="发送问题"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </motion.button>
              )}
              </AnimatePresence>
            </div>
          </div>
        </motion.section>
      ) : (
        <motion.button
          key="teacher-orb"
          initial={reducedMotion ? false : { opacity: 0, scale: 0.82, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 5 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.17, ease: [0.22, 1, 0.36, 1] }}
          ref={orbRef}
          type="button"
          onPointerDown={startDrag}
          onDragStart={(event) => event.preventDefault()}
          onClick={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              suppressClickRef.current = false;
              return;
            }
            openLauncher();
          }}
          className={cn(
            "group relative touch-none cursor-grab select-none place-items-center rounded-full border border-[#cdb996] bg-[#fffaf1]/96 text-[#332719] shadow-[0_12px_30px_rgba(50,35,18,0.24)] backdrop-blur hover:-translate-y-1 hover:border-[#ad7b41] hover:bg-white active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62] focus-visible:ring-offset-2",
            CONTROL_BUTTON_CLASS,
            safeDock ? SAFE_DOCK_LAUNCHER_SIZE_CLASS : STANDARD_LAUNCHER_SIZE_CLASS,
          )}
          aria-label="询问智能教师"
          aria-expanded={false}
          title="拖动气泡，点击提问"
        >
          <Image
            src="/brand/xueshu-app-icon-128.webp"
            alt=""
            draggable={false}
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
        </motion.button>
      )}
      </AnimatePresence>
      {resourceViewerActivated ? (
        <ResourceViewer item={openResource} onClose={() => setOpenResource(null)} />
      ) : null}
    </div>
  );
}
