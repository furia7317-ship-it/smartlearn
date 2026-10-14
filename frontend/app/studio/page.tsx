"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookMarked,
  Globe,
  Map,
  Play,
  RotateCcw,
  Trash2,
  UserRound,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import dynamic from "next/dynamic";

import { AgentPanel } from "@/components/agent-panel";
import { Chat } from "@/components/chat";
import { PathPanel } from "@/components/path-panel";
import { useBrowserHost } from "@/components/persistent-browser";
import { ResourceViewer } from "@/components/resource-viewer";
import { WebConversationSidebar } from "@/components/web/web-conversation-sidebar";

// 画像面板用到 recharts（重依赖），懒加载：不拖慢答疑首屏/首次编译，
// 仅在打开「画像」面板时才拉取并编译这块。
const ProfilePanel = dynamic(
  () => import("@/components/profile-panel").then((m) => m.ProfilePanel),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-center text-xs text-muted-foreground">画像加载中…</div>
    ),
  }
);
import { Button } from "@/components/ui/button";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { onOpenBrowser } from "@/lib/browser-bus";
import { STUDIO_STARTER_PROMPT as SAMPLE_PROMPT } from "@/lib/starter-content";
import type { ResourceItem } from "@/lib/types";
import { getMaterialData } from "@/lib/library";
import { cn } from "@/lib/utils";

/* ── 右侧抽屉面板：协同 / 画像 / 路径 / 内置浏览器 ──────────── */

type PanelKey = "browser" | "orchestration" | "profile" | "path";

const PANEL_META: Record<PanelKey, { label: string; icon: LucideIcon }> = {
  browser: { label: "内置浏览器", icon: Globe },
  orchestration: { label: "智能体协同", icon: Workflow },
  profile: { label: "学习画像", icon: UserRound },
  path: { label: "总学习路径", icon: Map },
};

// 工具栏图标顺序：内置浏览器 → 协同画像 → 路径
const PANEL_ORDER: PanelKey[] = ["browser", "orchestration", "profile", "path"];

const OPEN_KEY = "sl_studio_panel_v1";
const WIDTH_KEY = "sl_studio_panel_w_v1";
const DEFAULT_W = 420;
const MIN_W = 320;

export default function StudioPage() {
  const o = useOrchestratorContext((state) => ({
    pendingSoftwareAction: state.pendingSoftwareAction,
    acknowledgeSoftwareAction: state.acknowledgeSoftwareAction,
    resources: state.resources,
    mode: state.mode,
    tags: state.tags,
    masterPath: state.masterPath,
    hasRunMain: state.hasRunMain,
    send: state.send,
    running: state.running,
    messages: state.messages,
    clearMessages: state.clearMessages,
    reset: state.reset,
    agents: state.agents,
    planTasks: state.planTasks,
    planReason: state.planReason,
    conversationRunning: state.conversationRunning,
    stop: state.stop,
    newConversation: state.newConversation,
    retryLast: state.retryLast,
    canRetryLast: state.canRetryLast,
    agentRunStore: state.agentRunStore,
    deleteMessage: state.deleteMessage,
    plans: state.plans,
    planSavingId: state.planSavingId,
    planExecutingId: state.planExecutingId,
    planErrors: state.planErrors,
    savePlan: state.savePlan,
    confirmResourcePlan: state.confirmResourcePlan,
    replanPlan: state.replanPlan,
    cancelPlan: state.cancelPlan,
    pendingLearningPath: state.pendingLearningPath,
    continueLearningPath: state.continueLearningPath,
    retryLearningPath: state.retryLearningPath,
    editLearningPath: state.editLearningPath,
    openLearningPathKnowledgeBase: state.openLearningPathKnowledgeBase,
    recordLearningPathClarification: state.recordLearningPathClarification,
    cancelLearningPath: state.cancelLearningPath,
    logs: state.logs,
    phase: state.phase,
    profile: state.profile,
    profileUpdatedAt: state.profileUpdatedAt,
    profileSources: state.profileSources,
    masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    completedMaterials: state.completedMaterials,
    recordTaskEvidence: state.recordTaskEvidence,
  }));
  const panelKeys: PanelKey[] = PANEL_ORDER;
  const [open, setOpen] = useState<PanelKey | null>(null);
  const [panelW, setPanelW] = useState(DEFAULT_W);
  const [profileDirty, setProfileDirty] = useState(false);
  const [pathDirty, setPathDirty] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [openResource, setOpenResource] = useState<{
    item: ResourceItem;
    taskKey?: string;
  } | null>(null);
  const browserHost = useBrowserHost();
  const browserSlotRef = useRef<HTMLDivElement>(null);
  const pendingSoftwareAction = o.pendingSoftwareAction;
  const acknowledgeSoftwareAction = o.acknowledgeSoftwareAction;

  const openResourceById = useCallback(async (resourceId: string) => {
    const resource = o.resources.find((item) => item.id === resourceId && item.status === "ready");
    if (!resource) return;
    const data = resource.data ?? await getMaterialData(o.mode, resource.id).catch(() => undefined);
    setOpenResource({ item: data ? { ...resource, data } : resource });
  }, [o.mode, o.resources]);

  useEffect(() => {
    const action = pendingSoftwareAction;
    if (!action || action.type !== "open_resource") return;
    void openResourceById(action.resourceId)
      .finally(() => acknowledgeSoftwareAction(action.id));
  }, [acknowledgeSoftwareAction, openResourceById, pendingSoftwareAction]);

  // 把浏览器占位矩形同步给根布局里的持久浏览器；不在浏览器面板时让其移到屏幕外
  useEffect(() => {
    if (open !== "browser") {
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
  }, [open, browserHost]);

  // 最大宽度受答疑内容区可用宽度约束，给对话主区至少留 ~380px
  const clampW = (w: number) => {
    const avail =
      typeof window !== "undefined"
        ? window.innerWidth - 240
        : 1280;
    const max = Math.max(320, avail - 420);
    return Math.min(Math.max(w, MIN_W), max);
  };

  // 还原上次打开的面板与宽度（仅客户端）
  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      if (savedOpen && savedOpen in PANEL_META) {
        setOpen(savedOpen as PanelKey);
        if (savedOpen === "profile") setProfileDirty(false);
        if (savedOpen === "path") setPathDirty(false);
      }
      const savedW = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(savedW) && savedW > 0) setPanelW(clampW(savedW));
    } catch {
      /* localStorage 不可用时用默认值 */
    }
    const onResize = () => setPanelW((w) => clampW(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 面板未打开时，新内容（画像/路径更新）在对应图标上点提示点
  useEffect(() => {
    if (o.tags.length > 0 && open !== "profile") setProfileDirty(true);
  }, [o.tags, open]);
  useEffect(() => {
    if (o.masterPath.length > 0 && open !== "path") setPathDirty(true);
  }, [o.masterPath, open]);

  const setPanel = (key: PanelKey | null) => {
    setOpen(key);
    try {
      localStorage.setItem(OPEN_KEY, key ?? "");
    } catch {
      /* 忽略 */
    }
  };

  const toggle = (key: PanelKey) => {
    setPanel(open === key ? null : key);
    if (key === "profile") setProfileDirty(false);
    if (key === "path") setPathDirty(false);
  };

  // 对话/资源里的链接请求 → 展开内置浏览器面板（导航由根布局里的持久浏览器处理）
  useEffect(() => {
    return onOpenBrowser(() => {
      setOpen("browser");
      try {
        localStorage.setItem(OPEN_KEY, "browser");
      } catch {
        /* 忽略 */
      }
    });
  }, []);

  // 拖拽左缘调整抽屉宽度（类 Codex / Claude）。
  // 拖动期间盖一层全窗透明遮罩(见 return 末尾)，避免指针移到 <webview>/iframe 上时
  // 事件被吞、收不到 pointerup —— 那正是"松手后还跟着鼠标乱动"的根因。
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelW;
    let latest = startW;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      latest = clampW(startW - (ev.clientX - startX));
      setPanelW(latest);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setResizing(false);
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(latest)));
      } catch {
        /* 忽略 */
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 答疑工具栏 */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface-2/60 px-6">
        <h1 className="font-display text-base font-semibold tracking-tight">智能教师</h1>
        <span className="hidden items-center gap-1.5 text-[13px] text-muted-foreground md:flex">
          <BookMarked className="size-3.5" />
          《数据结构》· 软件工程 大二
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* 面板切换图标（右上角，类 Codex 聊天界面） */}
          {panelKeys.map((key) => (
            <PanelButton
              key={key}
              icon={PANEL_META[key].icon}
              label={PANEL_META[key].label}
              active={open === key}
              dirty={
                (key === "profile" && profileDirty) ||
                (key === "path" && pathDirty)
              }
              onClick={() => toggle(key)}
            />
          ))}

          <span className="mx-1 h-5 w-px bg-border" />

          {!o.hasRunMain && (
            <Button
              size="sm"
              onClick={() => o.send(SAMPLE_PROMPT)}
              disabled={o.running || o.mode !== "live"}
              className="gap-1.5"
            >
              <Play className="size-3.5" />
              运行示例
            </Button>
          )}
          {o.messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                if (o.running) return;
                if (
                  window.confirm("删除当前对话历史？已生成的资料、画像与学习路径会保留。")
                ) {
                  o.clearMessages();
                }
              }}
              aria-label="删除对话历史"
              title="删除对话历史（保留资料/画像/路径）"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={o.reset}
            aria-label="重置（清空全部）"
            title="重置：清空对话、资料、画像与路径"
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <WebConversationSidebar />
        {/* 对话主区 */}
        <div className="min-w-0 flex-1">
          <Chat
            messages={o.messages}
            agents={o.agents}
            resources={o.resources}
            path={o.masterPath}
            planTasks={o.planTasks}
            planReason={o.planReason}
            running={o.conversationRunning}
            hasRunMain={o.hasRunMain}
            onSend={o.send}
            onStop={o.stop}
            onVoiceNewConversation={() => o.newConversation()}
            onVoiceOpenResource={openResourceById}
            onRetry={o.retryLast}
            canRetry={o.canRetryLast}
            mode={o.mode}
            runStore={o.agentRunStore}
            onDeleteMessage={o.deleteMessage}
            plans={o.plans}
            planSavingId={o.planSavingId}
            planExecutingId={o.planExecutingId}
            planErrors={o.planErrors}
            onSavePlan={o.savePlan}
            onConfirmPlan={o.confirmResourcePlan}
            onReplanPlan={o.replanPlan}
            onCancelPlan={o.cancelPlan}
            baselineGate={{
              request:
                o.pendingLearningPath?.stage === "planning"
                  ? null
                  : o.pendingLearningPath?.request ?? null,
              planningError: o.pendingLearningPath?.error ?? null,
              onChoose: o.continueLearningPath,
              onRetryPlan: o.retryLearningPath,
              onEditPlan: o.editLearningPath,
              onOpenKnowledgeBase: o.openLearningPathKnowledgeBase,
              planning: o.pendingLearningPath?.stage === "planning",
              initialConfirmation: o.pendingLearningPath?.confirmation,
              onClarification: o.recordLearningPathClarification,
              onCancel: o.cancelLearningPath,
            }}
          />
        </div>

        {/* 右侧可调宽抽屉 */}
        {open && (
          <div
            className="relative flex shrink-0 flex-col border-l bg-surface-2/40"
            style={{ width: panelW }}
          >
            {/* 拖拽手柄 */}
            <div
              onPointerDown={startResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整面板宽度"
              className="group absolute left-0 top-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize"
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary/60" />
            </div>

            {/* 抽屉标题栏 */}
            <DrawerHeader k={open} onClose={() => setPanel(null)} />

            {/* 抽屉内容 */}
            <div className="min-h-0 flex-1">
              {/* 浏览器占位：真正的 <webview> 由根布局的持久浏览器盖在这块上 */}
              {open === "browser" && <div ref={browserSlotRef} className="h-full" />}
              {open === "orchestration" && (
                <AgentPanel
                  agents={o.agents}
                  logs={o.logs}
                  phase={o.phase}
                  running={o.conversationRunning}
                />
              )}
              {open === "profile" && (
                <ProfilePanel profile={o.profile} tags={o.tags} updatedAt={o.profileUpdatedAt} sources={o.profileSources} />
              )}
              {open === "path" && (
                <PathPanel
                  path={o.masterPath}
                  scheduleAnchor={o.masterPathScheduleAnchor}
                  completed={o.completedMaterials}
                  resources={o.resources}
                  onRecordEvidence={(key, content) =>
                    o.recordTaskEvidence(key, content, "written_response")
                  }
                  onOpenResource={(item, taskKey) => setOpenResource({ item, taskKey })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* 拖拽期间的全窗遮罩：盖住 webview/iframe，保证 pointermove/up 不被吞 */}
      {resizing && <div className="fixed inset-0 z-[70] cursor-col-resize select-none" />}
      <ResourceViewer
        item={openResource?.item ?? null}
        taskKey={openResource?.taskKey}
        onClose={() => setOpenResource(null)}
      />
    </div>
  );
}

/* ── 工具栏图标按钮 ─────────────────────────────── */

function PanelButton({
  icon: Icon,
  label,
  active,
  dirty,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  dirty: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative grid size-8 place-items-center rounded-lg transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      {dirty && !active && (
        <span className="absolute right-1 top-1 size-1.5 animate-pulse rounded-full bg-primary" />
      )}
    </button>
  );
}

/* ── 抽屉标题栏 ─────────────────────────────────── */

function DrawerHeader({ k, onClose }: { k: PanelKey; onClose: () => void }) {
  const meta = PANEL_META[k];
  const Icon = meta.icon;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
      <Icon className="size-4 text-muted-foreground" />
      <span className="text-[13px] font-semibold">{meta.label}</span>
      <button
        onClick={onClose}
        aria-label="关闭面板"
        title="关闭面板"
        className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
