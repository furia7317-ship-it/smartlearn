"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent as ReactUIEvent,
} from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUp,
  BookMarked,
  CalendarDays,
  FileText,
  Grip,
  ImageIcon,
  Loader2,
  Maximize2,
  MessageCircle,
  MessagesSquare,
  Network,
  Minimize2,
  Paperclip,
  Plus,
  Square,
  X,
  XCircle,
} from "lucide-react";

import { AssistantAvatar } from "@/components/agent-bits";
import { useAuth } from "@/components/auth-provider";
import { AgentTracePanel } from "@/components/agent-trace-panel";
import { CollaborationControls } from "@/components/collaboration-controls";
import { ConversationSyncStatus } from "@/components/conversation-sync-status";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { useTeacherWindow } from "@/components/desktop/teacher-window-provider";
import type { TeacherTool } from "./teacher-tool-window";
import { TEACHER_TOOL_EVENT } from "@/lib/app-navigation";
import { TeacherKnowledgePanel } from "./teacher-knowledge-panel";
import { TeacherSessionManager } from "./teacher-session-manager";
import { TeacherSessionDialog, type TeacherSessionAction } from "./teacher-session-dialog";
import { switchConversationDraft, type ConversationDraft } from "@/lib/teacher-conversations";
import { fitTeacherWindow, resizeTeacherWindow, TEACHER_WINDOW_DEFAULT, type ResizeEdge } from "@/lib/teacher-window-geometry";
import styles from "./teacher-workspace.module.css";
import { uploadTutorAttachment } from "@/lib/api";
import { selectRunSpans, type AgentRunStore } from "@/lib/agent-run-store";
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

const TeacherToolWindow = dynamic(
  () => import("./teacher-tool-window").then((module) => module.TeacherToolWindow),
  { ssr: false },
);

type LauncherPosition = {
  left: number;
  top: number;
};

const DigitalHuman = dynamic(() => import("@/components/digital-human").then((module) => module.DigitalHuman), { ssr: false });

type DragState = LauncherPosition & {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  height: number;
  moved: boolean;
};

const POSITION_STORAGE_KEY = "sl_desktop_teacher_window_position_v2";
const VIEWPORT_GAP = 12;
const DOCK_SNAP_DISTANCE = 36;
const CONTROL_BUTTON_CLASS = "transform-gpu transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out motion-reduce:transition-none active:scale-90 disabled:active:scale-100";
const WINDOW_ENTER = {
  opacity: [0, 1],
  y: ["10%", "0%"],
  scale: [0.92, 1],
  filter: ["blur(10px)", "blur(0px)"],
};
const WINDOW_VARIANTS = {
  hidden: { opacity: 0, y: "10%", scale: 0.92, filter: "blur(10px)" },
  hiddenReduced: { opacity: 0, y: "0%", scale: 1, filter: "blur(0px)" },
  visible: { opacity: 1, y: "0%", scale: 1, filter: "blur(0px)" },
  compact: WINDOW_ENTER,
  wide: WINDOW_ENTER,
};
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
  runStore: AgentRunStore;
  conversationRunning: boolean;
  reducedMotion: boolean;
  wide: boolean;
  teacher: "raccoon" | "alligator";
  onScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
}>(function TeacherMessageList({ messages, runStore, conversationRunning, reducedMotion, wide, teacher, onScroll }, ref) {
  const hasStreamingAnswer = messages.some(message => message.role === "assistant" && message.streaming);
  return (
    <div
      ref={ref}
      className={cn("thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4", styles.messageList)}
      aria-label="教师对话消息"
      onScroll={onScroll}
      tabIndex={0}
    >
      {messages.length === 0 && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn("grid min-h-56 content-center text-center", styles.emptyMessage)}
        >
          {wide ? <><AssistantAvatar teacher={teacher} className="size-12 shrink-0 rounded-xl" /><div className={styles.greeting}><h3>你好，我是你的智能学习助手。</h3><p>现在想弄懂什么？可以结合当前页面提问，也可以上传图片、PDF 或文档。点击右侧知识图谱的节点，我们一起理清知识之间的联系。</p></div></> : <>
          <MessageCircle className="mx-auto size-7 text-[#9b6b2d]" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-[#332719]">现在想弄懂什么？</p>
          <p className="mx-auto mt-1 max-w-64 text-[11px] leading-5 text-[#846f55]">可以结合当前页面提问，也可以上传图片、PDF 或文档。</p>
          </>}
        </motion.div>
      )}
      <AnimatePresence initial={false}>
        {messages.map((message) => {
          const destination = compactMessageDestination(message);
          const run = message.runId ? runStore.runs[message.runId] : undefined;
          const trace = run ? selectRunSpans(run) : message.trace ?? [];
          return (
            <motion.article
              key={message.id}
              initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={cn(
                "transform-gpu text-xs leading-5",
                message.role === "assistant" && styles.assistantMessage,
                message.role === "user"
                  ? "ml-auto w-fit min-w-12 max-w-[82%] rounded-xl bg-[#4f351a] px-3 py-2.5 text-[#fffaf1]"
                  : "mr-auto w-full min-w-0 max-w-[94%] border-l-2 border-[#c99b60] pl-3 text-[#443521]",
              )}
            >
              {message.role === "assistant" ? (
                <>
                  <AgentTracePanel
                    trace={trace}
                    streaming={Boolean(message.streaming)}
                    cancellationRequested={message.cancellationRequested}
                    fallbackReasoning={message.reasoning}
                    progress={message.progress}
                    processingStartedAt={message.processingStartedAt}
                    processingEndedAt={message.processingEndedAt}
                    compact
                  />
                  {message.content && <Markdown
                    content={message.content}
                    streaming={message.streaming}
                    interceptLinks
                    className="md-tight text-xs leading-5 text-inherit"
                  />}
                </>
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
        {conversationRunning && !hasStreamingAnswer && (
          <motion.p
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            className="flex items-center gap-2 text-[11px] text-[#786650]"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            请求已发送，等待服务响应
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
  const { user } = useAuth();
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
  const activeContext = context ?? (session.activeConversationKind === "resource_qa" && session.activeResourceId
    ? { module: "resource", entityId: session.activeResourceId, title: session.activeResourceTitle, detail: session.activeResourceContext }
    : routeContext);
  const [position, setPosition] = useState<LauncherPosition | null>(null);
  const [activeTool, setActiveTool] = useState<TeacherTool | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessionAction, setSessionAction] = useState<TeacherSessionAction | null>(null);
  const sessionsButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const openTool = (event: Event) => {
      const tool = (event as CustomEvent).detail;
      if (tool !== "create" && tool !== "plan") return;
      openTeacher();
      setActiveTool(tool);
    };
    window.addEventListener(TEACHER_TOOL_EVENT, openTool);
    return () => window.removeEventListener(TEACHER_TOOL_EVENT, openTool);
  }, [openTeacher]);
  const [windowSize, setWindowSize] = useState(TEACHER_WINDOW_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [voiceSurfaceHost, setVoiceSurfaceHost] = useState<HTMLDivElement | null>(null);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const normalPosition = useRef<LauncherPosition | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const [openResource, setOpenResource] = useState<ResourceItem | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
  const [attachments, setAttachments] = useState<TutorAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followMessagesRef = useRef(true);
  const conversationDrafts = useRef(new Map<string, ConversationDraft>());
  const draftOwner = useRef({ accountId: user?.id, conversationId: session.activeConversationId });
  useLayoutEffect(() => {
    const previous = draftOwner.current;
    const nextId = session.activeConversationId;
    if (previous.accountId === user?.id && previous.conversationId === nextId) return;
    const changedAccount = previous.accountId !== user?.id;
    if (changedAccount) conversationDrafts.current.clear();
    const restored = changedAccount ? { text: "", attachments: [] } : switchConversationDraft(
      conversationDrafts.current, previous.conversationId, nextId, { text: draft, attachments },
      session.conversations.map((conversation) => conversation.id),
    );
    draftOwner.current = { accountId: user?.id, conversationId: nextId };
    setDraft(restored.text);
    setAttachments(restored.attachments);
    setAttachmentError("");
    followMessagesRef.current = true;
  }, [attachments, draft, session.activeConversationId, session.conversations, setDraft, user?.id]);

  const sessionDisabledReason = session.clearingConversations ? "正在清除会话，请稍候。"
    : !session.hydrated || !session.conversationSyncReady ? "正在读取会话，请稍候。"
    : uploadingFiles.length > 0 ? "附件上传中，完成后即可切换会话。" : "";
  const deleteDisabledReason = sessionDisabledReason || (session.running ? "请等待所有回答和任务完成后再删除会话。" : "");
  const clearDisabledReason = deleteDisabledReason || (session.mode !== "live" ? "连接学习服务后即可清除全部会话。" : "");
  const closeSessionManager = useCallback(() => {
    setSessionsOpen(false);
    requestAnimationFrame(() => sessionsButtonRef.current?.focus({ preventScroll: true }));
  }, []);
  const startNewConversation = useCallback(() => {
    if (sessionDisabledReason) return;
    session.newConversation(session.activeTeacher);
    clearContext();
    setSessionsOpen(false);
    followMessagesRef.current = true;
    requestAnimationFrame(() => questionInputRef.current?.focus({ preventScroll: true }));
  }, [clearContext, session, sessionDisabledReason]);
  const selectConversation = (id: string) => {
    if (sessionDisabledReason) return;
    if (id !== session.activeConversationId) {
      session.openConversation(id);
      clearContext();
    }
    setSessionsOpen(false);
    followMessagesRef.current = true;
    requestAnimationFrame(() => questionInputRef.current?.focus({ preventScroll: true }));
  };
  const confirmSessionAction = async (action: TeacherSessionAction, value: string) => {
    const blocked = action.kind === "clear" ? clearDisabledReason : action.kind === "delete" ? deleteDisabledReason : sessionDisabledReason;
    if (blocked) throw new Error(blocked);
    if (action.kind === "clear") {
      await session.clearAllConversations();
      conversationDrafts.current.clear();
      clearContext();
    } else {
      if (!session.conversations.some((conversation) => conversation.id === action.id)) throw new Error("这段会话已不存在，请返回列表重试。");
      if (action.kind === "rename") session.renameConversation(action.id, value);
      else {
        session.deleteConversation(action.id);
        conversationDrafts.current.delete(action.id);
        if (action.id === session.activeConversationId) clearContext();
      }
    }
  };
  const handleMessageScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    followMessagesRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }, []);
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const positionRef = useRef<LauncherPosition | null>(null);
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
      if (!open || wide) return;
      const current = positionRef.current;
      if (!current) return;
      const next = fitTeacherWindow({ ...current, ...windowSize }, { width: window.innerWidth, height: window.innerHeight });
      setWindowSize({ width: next.width, height: next.height });
      applyPosition({ left: next.left, top: next.top });
    };
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [open, wide, windowSize]);

  useEffect(() => () => {
    resizeCleanup.current?.();
    dragCleanupRef.current?.();
    if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
  }, []);

  useEffect(() => {
    if (!open || wide) return;
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
      if (node && followMessagesRef.current) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, session.messages, session.agentRunStore]);

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
    followMessagesRef.current = true;
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
    if ((!text && attachments.length === 0) || sessionDisabledReason || session.conversationRunning || session.mode !== "live") return;
    const question = text || "请阅读这些附件并解答其中的问题，给出关键步骤、结论和必要的逐题解析。";
    if (!sendQuestion(question, attachments)) return;
    setDraft("");
    setAttachments([]);
    setAttachmentError("");
  };

  const openLauncher = () => {
    openTeacher();
  };

  const minimizeLauncher = () => {
    resizeCleanup.current?.();
    dragCleanupRef.current?.();
    dragRef.current = null;
    flushPreviewPosition();
    minimizeTeacher();
    setActiveTool(null);
    setSessionsOpen(false);
    setSessionAction(null);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true });
    });
  };
  useEffect(() => {
    minimizeLauncherRef.current = minimizeLauncher;
  });

  useEffect(() => {
    if (!open || activeTool || sessionAction) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (sessionsOpen) {
        closeSessionManager();
        return;
      }
      minimizeLauncherRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, activeTool, sessionAction, sessionsOpen, closeSessionManager]);

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
    if (!session.conversationRunning && !sessionDisabledReason && event.dataTransfer.files.length > 0) {
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
    if (!open || wide) return;
    if (event.button !== 0) return;
    // Icon clicks target an SVGElement rather than an HTMLElement. Treat every
    // DOM Element as interactive-aware so the draggable header never captures
    // clicks meant for new/wide/close controls.
    if (event.target instanceof Element) {
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

  const switchWindowMode = () => {
    resizeCleanup.current?.();
    if (!wide) {
      normalPosition.current = positionRef.current;
    } else {
      if (normalPosition.current) applyPosition(normalPosition.current);
      else resetPosition();
      setGraphExpanded(false);
    }
    toggleWide();
  };

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, edge: ResizeEdge) => {
    if (event.button !== 0 || wide) return;
    event.preventDefault(); event.stopPropagation();
    dragCleanupRef.current?.(); resizeCleanup.current?.();
    const box = launcherRef.current!.getBoundingClientRect();
    const initial = { left: box.left, top: box.top, width: box.width, height: box.height };
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    const target = event.currentTarget;
    let frame = 0;
    let next = initial;
    const apply = () => { setWindowSize({ width: next.width, height: next.height }); applyPosition({ left: next.left, top: next.top }); };
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      next = resizeTeacherWindow(initial, edge, pointer.clientX - startX, pointer.clientY - startY, { width: window.innerWidth, height: window.innerHeight });
      cancelAnimationFrame(frame); frame = requestAnimationFrame(apply);
    };
    const end = () => {
      cancelAnimationFrame(frame); apply(); setResizing(false);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      resizeCleanup.current = null;
    };
    setResizing(true); apply();
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    target.setPointerCapture(pointerId); resizeCleanup.current = end;
  };

  // Keep the window at its own position while AnimatePresence finishes closing.
  // The fixed launcher has a separate frame and never inherits this geometry.
  const launcherStyle: CSSProperties | undefined = wide
    ? { left: "50%", top: "50%", right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" }
    : position
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
    startNewConversation();
  }, [startNewConversation]);

  return (
    <>
    <div
      ref={launcherRef}
      className={cn(
        "fixed pointer-events-none",
        activeTool ? "z-[50]" : wide ? "z-[500]" : "z-[120]",
        !position && !safeDock && "bottom-5 right-5",
        !position && safeDock && !railCollapsed && "bottom-7 left-[118px]",
        !position && safeDock && railCollapsed && "bottom-5 left-3",
      )}
      style={launcherStyle}
      inert={!open}
      data-safe-dock={safeDock ? "true" : undefined}
    >
      <AnimatePresence initial={false}>
      {open && (
        <motion.section
          key="teacher-window"
          layout={false}
          variants={WINDOW_VARIANTS}
          initial={reducedMotion ? false : "hidden"}
          animate={reducedMotion ? "visible" : wide ? "wide" : "compact"}
          exit={reducedMotion ? "hiddenReduced" : "hidden"}
          transition={{ duration: reducedMotion ? 0.01 : 0.6, ease: [0.23, 1, 0.32, 1] }}
          role="dialog"
          aria-label="询问智能教师"
          data-teacher-wide={wide}
          data-resizing={resizing}
          style={wide ? undefined : { width: `min(${windowSize.width}px, calc(100vw - 24px))`, height: `min(${windowSize.height}px, calc(100dvh - 24px))` }}
          className={cn(
            "pointer-events-auto relative flex transform-gpu flex-col overflow-hidden rounded-2xl border border-[#cdbb9f] bg-[#fffaf1] shadow-[0_24px_70px_rgba(50,35,18,0.28)] will-change-transform",
            styles.window, wide ? styles.wide : styles.compact, wide && graphExpanded && styles.graphFocus,
          )}
        >
          {wide && <>
            <nav className={styles.actionRail} aria-label="智能教师工具">
              <button aria-pressed={!activeTool && !graphExpanded && !sessionsOpen} onClick={() => { setSessionsOpen(false); setGraphExpanded(false); requestAnimationFrame(() => questionInputRef.current?.focus()); }}><MessageCircle /><span>学习问答</span></button>
              <button aria-pressed={activeTool === "create"} onClick={() => setActiveTool("create")}><BookMarked /><span>资源创作</span></button>
              <button aria-pressed={activeTool === "plan"} onClick={() => setActiveTool("plan")}><CalendarDays /><span>学习计划</span></button>
              <button aria-pressed={graphExpanded} onClick={() => setGraphExpanded((current) => !current)}><Network /><span>知识图谱</span></button>
              <button className={styles.railBottom} onClick={switchWindowMode} aria-label="返回悬浮窗口"><Minimize2 /><span>小窗模式</span></button>
            </nav>
            <aside className={styles.humanPanel} aria-label="数字人交互"><DigitalHuman variant="teacher" answer={[...session.messages].reverse().find((message) => message.role === "assistant" && !message.streaming && message.content.trim())?.content || "你好，我是你的智能学习助手。告诉我你现在想学习的内容，我们一起理清思路。"} /></aside>
          </>}
          <div className={styles.chatColumn}>
          <header
            className={cn("flex h-14 shrink-0 touch-none select-none items-center gap-2 border-b border-[#dfd0ba] px-3 cursor-grab active:cursor-grabbing", styles.chatHeader)}
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
              ref={sessionsButtonRef}
              type="button"
              className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS, sessionsOpen && "bg-[#e8dac6] text-[#5f4930]")}
              onClick={() => setSessionsOpen((current) => !current)}
              aria-label="会话管理"
              aria-expanded={sessionsOpen}
              aria-controls={sessionsOpen ? "teacher-session-manager" : undefined}
              title="会话管理"
            >
              <MessagesSquare className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5] disabled:opacity-35", CONTROL_BUTTON_CLASS)}
              onClick={startNewConversation}
              disabled={Boolean(sessionDisabledReason)}
              aria-label="新建教师会话"
              title={sessionDisabledReason || "新建会话"}
            >
              <Plus className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className={cn("grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]", CONTROL_BUTTON_CLASS, wide && "bg-[#e8dac6] text-[#5f4930]")}
              onClick={switchWindowMode}
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
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div ref={setVoiceSurfaceHost} className={cn("relative", styles.chatBody)}>
          <div className={styles.chatContent} inert={sessionsOpen} aria-hidden={sessionsOpen || undefined}>
          <ConversationSyncStatus />
          {activeContext && (
            <div className={cn("flex shrink-0 items-center gap-2 border-b border-[#eadfce] bg-[#f5ecdf] px-3 py-2 text-[11px] text-[#5f4930]", styles.contextBar)}>
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
            <TeacherMessageList
              ref={scrollRef}
              messages={recentMessages}
              runStore={session.agentRunStore}
              conversationRunning={session.conversationRunning}
              reducedMotion={Boolean(reducedMotion)}
              wide={wide}
              teacher={session.activeTeacher}
              onScroll={handleMessageScroll}
            />
          </div>

          <div
            className={cn("relative shrink-0 border-t border-[#dfd0ba] bg-white/55 p-3", styles.composer, dragActive && "bg-[#fff5e6]")}
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
            <CollaborationControls compact disabled={session.conversationRunning} />
            <div className="flex items-end gap-2 rounded-xl border border-[#d5c3a8] bg-white px-2.5 py-2 transition-[border-color,box-shadow] duration-150 focus-within:border-[#c59a62] focus-within:ring-2 focus-within:ring-[#c59a62]/30">
              <button
                type="button"
                className={cn("grid size-8 shrink-0 place-items-center rounded-full text-[#765638] hover:bg-[#eee4d5] disabled:opacity-35", CONTROL_BUTTON_CLASS)}
                onClick={() => fileInputRef.current?.click()}
                disabled={session.conversationRunning || Boolean(sessionDisabledReason) || attachments.length + uploadingFiles.length >= 5}
                aria-label="上传图片、文档或 PDF"
                title="上传或拖入图片、PDF、Word、PPT、Excel 等文件"
              >
                <Paperclip className="size-4" />
              </button>
              <textarea
                ref={questionInputRef}
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
                disabled={session.mode !== "live" || !session.conversationSyncReady || session.clearingConversations}
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-[#332719] outline-none placeholder:text-[#9a8a75] disabled:cursor-not-allowed"
              />
              <VoiceCallControl
                compact
                surfaceMode="inline"
                inlineContainer={voiceSurfaceHost}
                messages={session.messages}
                running={session.conversationRunning}
                enabled={session.mode === "live" && !sessionDisabledReason}
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
                  disabled={recentMessages.some(message => message.streaming && message.cancellationRequested)}
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
                  disabled={Boolean(sessionDisabledReason) || (!draft.trim() && attachments.length === 0) || session.mode !== "live"}
                  className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1] hover:bg-[#50371d] disabled:cursor-not-allowed disabled:opacity-35", CONTROL_BUTTON_CLASS)}
                  aria-label="发送问题"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </motion.button>
              )}
              </AnimatePresence>
            </div>
          </div>
          </div>
          <AnimatePresence initial={false}>
            {sessionsOpen && <TeacherSessionManager
              key="session-manager"
              conversations={session.conversations}
              disabledReason={sessionDisabledReason}
              deleteDisabledReason={deleteDisabledReason}
              clearDisabledReason={clearDisabledReason}
              onNew={startNewConversation}
              onSelect={selectConversation}
              onAction={setSessionAction}
              onClose={closeSessionManager}
            />}
          </AnimatePresence>
          </div>
          </div>
          {wide && <TeacherKnowledgePanel path={session.path} expanded={graphExpanded} onExpand={() => setGraphExpanded((current) => !current)} onAsk={(step) => {
            setDraft(`请帮我讲解“${step.title}”，${step.objective || step.desc}`);
            setSessionsOpen(false);
            setGraphExpanded(false);
            requestAnimationFrame(() => questionInputRef.current?.focus());
          }} />}
          {!wide && (["n", "s", "e", "w", "nw", "ne", "sw", "se"] as ResizeEdge[]).map((edge) => <button key={edge} type="button" className={styles.resizeHandle} data-edge={edge}
            tabIndex={edge === "nw" ? 0 : -1} aria-label={`调整窗口大小 ${edge}`} title="拖动调整大小，双击恢复默认；方向键微调"
            onPointerDown={(event) => startResize(event, edge)} onDoubleClick={() => setWindowSize(TEACHER_WINDOW_DEFAULT)}
            onKeyDown={(event) => {
              if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              const box = launcherRef.current!.getBoundingClientRect();
              const next = resizeTeacherWindow(box, edge, event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0, event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0, { width: window.innerWidth, height: window.innerHeight });
              setWindowSize({ width: next.width, height: next.height }); applyPosition({ left: next.left, top: next.top });
            }}>{(edge === "nw" || edge === "se") && <Grip size={11} />}</button>)}
        </motion.section>
      )}
      </AnimatePresence>
    </div>
    <motion.div
      className={styles.triggerDock}
      initial={false}
      animate={open ? { opacity: 0, scale: 0.8, x: 50 } : { opacity: 1, scale: 1, x: 0 }}
      transition={{ duration: reducedMotion ? 0.01 : 0.4, ease: [0.175, 0.885, 0.32, 1.275] }}
      inert={open}
      aria-hidden={open}
      style={{ pointerEvents: open ? "none" : "auto" }}
    >
        <button
          ref={triggerRef}
          type="button"
          onDragStart={(event) => event.preventDefault()}
          onClick={openLauncher}
          className={styles.trigger}
          aria-label="询问智能教师"
          aria-expanded={open}
          data-guide="teacher"
          title="打开智能教师"
        >
          <span className={styles.triggerLogo}>
            <Image
              src="/brand/xueshu-app-icon-128.webp"
              alt=""
              draggable={false}
              width={42}
              height={42}
              loading="eager"
              className="size-full object-cover"
            />
          </span>
          <span className={styles.triggerText}>
            <strong>智能教师</strong>
            <small data-online={sessionMode === "live"}><i aria-hidden />{sessionMode === "live" ? "在线" : sessionMode === "checking" ? "连接中" : "未连接"}</small>
          </span>
        </button>
    </motion.div>
      <TeacherSessionDialog action={open ? sessionAction : null} onClose={() => setSessionAction(null)} onConfirm={confirmSessionAction} />
      <TeacherToolWindow tool={open ? activeTool : null} onClose={() => setActiveTool(null)} onAsk={(question) => {
        setActiveTool(null);
        setSessionsOpen(false);
        setGraphExpanded(false);
        setDraft(question);
        requestAnimationFrame(() => questionInputRef.current?.focus());
      }} />
      {resourceViewerActivated ? (
        <ResourceViewer item={openResource} onClose={() => setOpenResource(null)} />
      ) : null}
    </>
  );
}
