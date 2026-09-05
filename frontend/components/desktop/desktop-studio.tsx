"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookMarked,
  Bot,
  Ellipsis,
  GitBranch,
  Globe,
  GripVertical,
  Map,
  MessageCircle,
  MessageSquareText,
  PencilLine,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import { AgentRunInspector } from "@/components/agent-run-inspector";
import { AssistantAvatar } from "@/components/agent-bits";
import { Chat } from "@/components/chat";
import { PathPanel } from "@/components/path-panel";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { useStudioPanels, type StudioPanelKey } from "@/hooks/use-studio-panels";
import type { ResourceItem } from "@/lib/types";
import { getMaterialData } from "@/lib/library";
import { getDesktopViewSwap } from "@/lib/web-motion";
import {
  TEACHER_PERSONAS,
  type TeacherPersona,
} from "@/lib/teacher-persona";
import { cn } from "@/lib/utils";

const ProfilePanel = dynamic(
  () => import("@/components/profile-panel").then((module) => module.ProfilePanel),
  {
    ssr: false,
    loading: () => <div className="p-6 text-center text-xs text-muted-foreground">画像加载中…</div>,
  },
);

const ResourceViewer = dynamic(
  () => import("@/components/resource-viewer").then((module) => module.ResourceViewer),
  { ssr: false },
);

type InspectorTab = "trace" | "profile" | "path" | "browser";

const INSPECTOR_TABS: { id: InspectorTab; label: string; icon: LucideIcon }[] = [
  { id: "trace", label: "轨迹", icon: GitBranch },
  { id: "profile", label: "画像", icon: UserRound },
  { id: "path", label: "路径", icon: Map },
  { id: "browser", label: "浏览器", icon: Globe },
];

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function TeacherChooser({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (teacher: TeacherPersona) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (focusable.length === 0) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-[#2c2115]/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-chooser-title"
        className="w-full max-w-[560px] rounded-2xl border border-[#cdbb9f] bg-[#fffaf2] p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div>
            <h2 id="teacher-chooser-title" className="font-display text-lg font-semibold">选择本次智能教师</h2>
            <p className="mt-1 text-xs leading-5 text-[#756653]">教师会跟随这段会话保存，回复风格由后端真实提示词控制。</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-xs text-[#765638] hover:bg-[#eee4d5]">取消</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(Object.values(TEACHER_PERSONAS) as (typeof TEACHER_PERSONAS)[TeacherPersona][]).map((teacher) => (
            <button
              key={teacher.id}
              type="button"
              onClick={() => onChoose(teacher.id)}
              className="group flex items-start gap-3 rounded-xl border border-[#d9cab4] bg-[#fbf6ed] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#a97134] hover:bg-white hover:shadow-md"
            >
              <AssistantAvatar teacher={teacher.id} className="size-16 rounded-xl" />
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-[#3c2d1c]">{teacher.name}</strong>
                <span className="mt-1 block text-xs leading-5 text-[#756653]">{teacher.description}</span>
                <span className="mt-2 inline-flex text-[11px] font-medium text-[#8b5620] group-hover:underline">选择并开始</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DesktopStudio() {
  const o = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    activeConversationKind: state.activeConversationKind,
    tags: state.tags,
    path: state.path,
    conversations: state.conversations,
    pendingSoftwareAction: state.pendingSoftwareAction,
    acknowledgeSoftwareAction: state.acknowledgeSoftwareAction,
    resources: state.resources,
    mode: state.mode,
    activeTeacher: state.activeTeacher,
    messages: state.messages,
    running: state.running,
    clearMessages: state.clearMessages,
    reset: state.reset,
    renameConversation: state.renameConversation,
    conversationSwitchLocked: state.conversationSwitchLocked,
    openConversation: state.openConversation,
    deleteConversation: state.deleteConversation,
    agents: state.agents,
    masterPath: state.masterPath,
    planTasks: state.planTasks,
    planReason: state.planReason,
    conversationRunning: state.conversationRunning,
    hasRunMain: state.hasRunMain,
    send: state.send,
    stop: state.stop,
    retryLast: state.retryLast,
    canRetryLast: state.canRetryLast,
    agentRunStore: state.agentRunStore,
    deleteMessage: state.deleteMessage,
    focusMessageRun: state.focusMessageRun,
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
    activeAgentRun: state.activeAgentRun,
    profile: state.profile,
    profileUpdatedAt: state.profileUpdatedAt,
    profileSources: state.profileSources,
    masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    completedMaterials: state.completedMaterials,
    recordTaskEvidence: state.recordTaskEvidence,
    newConversation: state.newConversation,
  }));
  const studioHydrated = o.hydrated;
  const [openResource, setOpenResource] = useState<{
    item: ResourceItem;
    taskKey?: string;
  } | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
  const [teacherChooserOpen, setTeacherChooserOpen] = useState(false);
  const [sessionMenuId, setSessionMenuId] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [conversationGroup, setConversationGroup] = useState<"general" | "resource_qa">("general");
  const viewSwap = getDesktopViewSwap(Boolean(useReducedMotion()));

  useEffect(() => {
    if (!studioHydrated) return;
    setConversationGroup(o.activeConversationKind);
  }, [o.activeConversationKind, studioHydrated]);

  const {
    browserSlotRef,
    open,
    compact,
    leftOpen,
    rightOpen,
    leftW,
    panelW,
    resizing,
    setPanel,
    toggleLeft,
    toggleRight,
    adjustWidth,
    resetWidth,
    startResize,
  } = useStudioPanels({
    tagsLen: o.tags.length,
    pathLen: o.path.length,
  });
  const activeTab: InspectorTab = open === "orchestration" || open === null ? "trace" : open;
  const generalConversationCount = o.conversations.filter((conversation) => conversation.kind === "general").length;
  const resourceConversationCount = o.conversations.filter((conversation) => conversation.kind === "resource_qa").length;
  const visibleConversations = o.conversations.filter((conversation) => conversation.kind === conversationGroup);
  const pendingSoftwareAction = o.pendingSoftwareAction;
  const acknowledgeSoftwareAction = o.acknowledgeSoftwareAction;

  const openResourceById = useCallback(async (resourceId: string) => {
    const resource = o.resources.find((item) => item.id === resourceId && item.status === "ready");
    if (!resource) return;
    const data = resource.data ?? await getMaterialData(o.mode, resource.id).catch(() => undefined);
    setResourceViewerActivated(true);
    setOpenResource({ item: data ? { ...resource, data } : resource });
  }, [o.mode, o.resources]);

  useEffect(() => {
    const action = pendingSoftwareAction;
    if (!action || action.type !== "open_resource") return;
    void openResourceById(action.resourceId)
      .finally(() => acknowledgeSoftwareAction(action.id));
  }, [acknowledgeSoftwareAction, openResourceById, pendingSoftwareAction]);

  const selectInspector = (tab: InspectorTab) => {
    if (tab === "trace") {
      setPanel("orchestration");
      return;
    }
    setPanel(tab as StudioPanelKey);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f4efe6] text-[#332719]">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[#d9ccb9] bg-[#fbf7f0] px-5">
        <div className="min-w-0">
          <h1 className="font-display text-[17px] font-semibold tracking-tight">智能教师</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-[#756754]">
            <BookMarked className="size-3.5" />
            {TEACHER_PERSONAS[o.activeTeacher].name} · 数据结构课程上下文
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {o.messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={o.running}
              onClick={() => {
                if (window.confirm("删除当前会话消息？已生成的资料、画像和路径会保留。")) o.clearMessages();
              }}
              aria-label="清空当前会话消息"
              title={o.running ? "请先停止当前运行" : "清空当前会话消息"}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={o.running}
            onClick={() => {
              if (window.confirm("重置学枢当前本地数据？这会清空对话、资料、画像和路径。")) o.reset();
            }}
            aria-label="重置全部本地学习状态"
            title={o.running ? "请先停止当前运行" : "重置全部本地学习状态"}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </header>

      <div
        className={cn("relative grid min-h-0 flex-1 overflow-hidden", resizing && "select-none")}
        style={{
          gridTemplateColumns: `${leftOpen ? leftW : 48}px minmax(560px, 1fr) ${compact ? 48 : rightOpen ? panelW : 48}px`,
        }}
      >
        <aside className="relative flex min-h-0 min-w-0 flex-col border-r border-[#d8cab5] bg-[#eee6d8]" aria-label="会话栏">
          {!leftOpen ? (
            <div className="flex min-h-0 flex-col items-center gap-2 py-3">
              <button type="button" onClick={toggleLeft} className="grid size-9 place-items-center rounded-lg text-[#765638] hover:bg-[#e4d8c6]" aria-label="展开会话栏" title="展开会话栏">
                <PanelLeftOpen className="size-4" />
              </button>
              <button type="button" onClick={() => setTeacherChooserOpen(true)} className="grid size-9 place-items-center rounded-lg bg-[#3a2a18] text-[#fffaf1]" aria-label="新建会话" title="选择教师并创建新会话">
                <MessageSquareText className="size-4" />
              </button>
              <MessageSquareText className="mt-1 size-4 text-[#986324]" aria-hidden="true" />
            </div>
          ) : (
            <>
          <div className="flex items-center gap-2 border-b border-[#d6c7b1] p-3">
            <button
              type="button"
              onClick={() => setTeacherChooserOpen(true)}
              title="选择教师并创建新会话"
              className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#3a2a18] px-3 py-2 text-[12px] font-medium text-[#fffaf1] transition hover:bg-[#4c3821] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <MessageSquareText className="size-3.5" />
              新建会话
            </button>
            <button
              type="button"
              onClick={toggleLeft}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#cfbea5] bg-[#f9f3e8] text-[#765638] hover:bg-[#e4d8c6]"
              aria-label="收起会话栏"
              title="收起会话栏"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1 border-b border-[#d6c7b1] p-2">
            <button
              type="button"
              onClick={() => setConversationGroup("general")}
              aria-pressed={conversationGroup === "general"}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium",
                conversationGroup === "general"
                  ? "bg-[#3a2a18] text-[#fffaf1]"
                  : "text-[#725f48] hover:bg-[#e4d8c6]",
              )}
            >
              <MessageSquareText className="size-3.5" />
              <span>普通会话</span>
              <span className="opacity-70">{generalConversationCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setConversationGroup("resource_qa")}
              aria-pressed={conversationGroup === "resource_qa"}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium",
                conversationGroup === "resource_qa"
                  ? "bg-[#3a2a18] text-[#fffaf1]"
                  : "text-[#725f48] hover:bg-[#e4d8c6]",
              )}
            >
              <MessageCircle className="size-3.5" />
              <span>资料问答</span>
              <span className="opacity-70">{resourceConversationCount}</span>
            </button>
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {/* 只包最外层：会话条目本身不套 motion，避免长列表逐项动画掉帧 */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={conversationGroup} {...viewSwap} className="min-h-0">
                <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a7861]">
                  {conversationGroup === "resource_qa" ? "资料问答记录" : "会话记录"}
                </div>
                <div className="space-y-1">
                  {visibleConversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                        "group relative flex w-full flex-col overflow-hidden rounded-lg transition",
                        conversation.active
                          ? "border border-[#c8a36e] bg-[#fffaf2]"
                          : "border border-transparent hover:bg-[#f8f1e6]",
                      )}
                    >
                      {renamingConversationId === conversation.id ? (
                        <form
                          className="flex items-center gap-1.5 p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (!renameDraft.trim()) return;
                            o.renameConversation(conversation.id, renameDraft);
                            setRenamingConversationId("");
                            setSessionMenuId("");
                          }}
                        >
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            maxLength={40}
                            autoFocus
                            aria-label={`重命名会话：${conversation.title}`}
                            className="h-8 min-w-0 flex-1 rounded-md border border-[#cdb998] bg-[#fffdf8] px-2 text-[11px] outline-none focus:border-[#99601f]"
                          />
                          <button type="submit" className="h-8 rounded-md bg-[#3a2a18] px-2 text-[10px] text-[#fffaf1]">
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingConversationId("")}
                            className="h-8 rounded-md px-1.5 text-[10px] text-[#765f45] hover:bg-[#eadfce]"
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-current={conversation.active ? "page" : undefined}
                            aria-expanded={sessionMenuId === conversation.id}
                            title={conversation.title}
                            onClick={() =>
                              setSessionMenuId((current) =>
                                current === conversation.id ? "" : conversation.id,
                              )
                            }
                            className="flex w-full min-w-0 items-start gap-2 px-2.5 py-2 text-left"
                          >
                            <AssistantAvatar teacher={conversation.teacher} className="size-7 rounded-md" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11px] font-medium text-[#423321]">{conversation.title}</span>
                              <span className="mt-0.5 block text-[9px] text-[#897862]">
                                {conversation.running
                                  ? "处理中"
                                  : conversation.active
                                    ? "当前会话"
                                    : formatSessionTime(conversation.updatedAt)}
                              </span>
                            </span>
                            <Ellipsis className="mt-1 size-3.5 shrink-0 text-[#8b765d]" />
                          </button>
                          {sessionMenuId === conversation.id && (
                            <div className="grid grid-cols-2 gap-1 border-t border-[#e0d3c0] bg-[#f7efe3] p-1.5">
                              {!conversation.active && (
                                <button
                                  type="button"
                                  disabled={o.conversationSwitchLocked}
                                  onClick={() => {
                                    o.openConversation(conversation.id);
                                    setSessionMenuId("");
                                  }}
                                  className="h-8 rounded-md text-[10px] text-[#59452f] hover:bg-[#e8dbc8] disabled:opacity-40"
                                >
                                  打开会话
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setRenameDraft(conversation.title);
                                  setRenamingConversationId(conversation.id);
                                }}
                                className="flex h-8 items-center justify-center gap-1 rounded-md text-[10px] text-[#59452f] hover:bg-[#e8dbc8]"
                              >
                                <PencilLine className="size-3" />
                                重命名
                              </button>
                              <button
                                type="button"
                                disabled={o.running}
                                onClick={() => {
                                  if (window.confirm(`删除会话“${conversation.title}”？已生成的资料、路径和画像会保留。`)) {
                                    o.deleteConversation(conversation.id);
                                    setSessionMenuId("");
                                  }
                                }}
                                className="h-8 rounded-md text-[10px] text-[#9b4738] hover:bg-[#f0ded7] disabled:opacity-40"
                              >
                                删除
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  {visibleConversations.length === 0 && (
                    <p className="px-2 py-6 text-center text-[10px] leading-5 text-[#8a7861]">
                      打开学习资料并询问智能教师后，问答会话会保存在这里。
                    </p>
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {o.mode === "offline" && (
            <div className="border-t border-[#d6c7b1] p-3">
              <p className="text-[9px] leading-4 text-[#955044]">发送已禁用：启动 backend 后访问 127.0.0.1:8000/docs 确认恢复。</p>
            </div>
          )}
            </>
          )}
          {leftOpen && (
            <>
              <button type="button" className="absolute -right-1.5 top-1/2 z-20 grid h-14 w-3 -translate-y-1/2 cursor-col-resize place-items-center rounded-sm text-[#9f896c] hover:bg-[#dcc9ad]" role="separator" aria-label="调整会话栏宽度" tabIndex={0} onPointerDown={(event) => startResize(event, "left")} onDoubleClick={() => resetWidth("left")} onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); adjustWidth("left", event.shiftKey ? -32 : -16); }
                if (event.key === "ArrowRight") { event.preventDefault(); adjustWidth("left", event.shiftKey ? 32 : 16); }
              }}>
                <GripVertical className="size-3" />
              </button>
            </>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#fffdf8]" aria-label="AI 对话主区">
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
            onVoiceNewConversation={() => setTeacherChooserOpen(true)}
            onVoiceOpenResource={openResourceById}
            onRetry={o.retryLast}
            canRetry={o.canRetryLast}
            mode={o.mode}
            runStore={o.agentRunStore}
            showInlineTrace={false}
            teacher={o.activeTeacher}
            createHref="/create/"
            onDeleteMessage={o.deleteMessage}
            onInspectRun={(messageId) => {
              o.focusMessageRun(messageId);
            }}
            plans={o.plans}
            planSavingId={o.planSavingId}
            planExecutingId={o.planExecutingId}
            planErrors={o.planErrors}
            onSavePlan={o.savePlan}
            onConfirmPlan={o.confirmResourcePlan}
            onReplanPlan={o.replanPlan}
            onCancelPlan={o.cancelPlan}
            baselineGate={{
              request: o.pendingLearningPath?.stage === "planning" ? null : o.pendingLearningPath?.request ?? null,
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
        </main>

        <aside className={cn(
          "relative flex min-h-0 min-w-0 flex-col border-l border-[#d8cab5] bg-[#f7f1e7]",
          compact && rightOpen && "fixed inset-y-14 right-0 z-40 w-[min(520px,calc(100vw-48px))] shadow-2xl",
        )} aria-label="协同检查器">
          {!rightOpen ? (
            <div className="flex min-h-0 flex-col items-center gap-2 py-3">
              <button type="button" onClick={toggleRight} className="grid size-9 place-items-center rounded-lg text-[#765638] hover:bg-[#e4d8c6]" aria-label="展开协同检查器" title="展开协同检查器">
                <PanelRightOpen className="size-4" />
              </button>
              {INSPECTOR_TABS.map((tab) => {
                const Icon = tab.icon;
                return <button key={tab.id} type="button" onClick={() => selectInspector(tab.id)} className="grid size-8 place-items-center rounded-md text-[#806c54] hover:bg-[#e7d6ba]" aria-label={`打开${tab.label}`} title={`打开${tab.label}`}><Icon className="size-3.5" /></button>;
              })}
            </div>
          ) : (
            <>
          <div className="border-b border-[#d8cab5] px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] font-semibold"><Bot className="size-4 text-[#955f22]" />协同检查器<button type="button" onClick={toggleRight} className="ml-auto grid size-7 place-items-center rounded-md text-[#765638] hover:bg-[#e7d6ba]" aria-label="收起协同检查器" title="收起协同检查器"><PanelRightClose className="size-3.5" /></button></div>
            <p className="mt-0.5 text-[9px] text-[#81715d]">公开执行证据，不展示模型私密思维</p>
          </div>
          <div className="thin-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-[#d8cab5] px-2 py-1.5" role="tablist" aria-label="协同检查器面板">
            {INSPECTOR_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => selectInspector(tab.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium",
                    activeTab === tab.id ? "bg-[#e7d6ba] text-[#704719]" : "text-[#756653] hover:bg-[#eee4d5]",
                  )}
                >
                  <Icon className="size-3" />{tab.label}
                </button>
              );
            })}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden" role="tabpanel">
            {/*
              轨迹面板做过场；内置浏览器面板保持静止，位移会让 fixed 覆盖层错位。
              过场元素必须 absolute inset-0 脱离普通流：容器是 block 布局，退出中的面板若留在流里，
              会和同一次 commit 渲染出来的 browser 占位槽上下堆叠，把槽推出可视区——而
              use-studio-panels 正是在这次 commit 后同步量 getBoundingClientRect 并定位 <webview>，
              量到错位矩形后不会再有任何东西触发重测（占位槽尺寸没变，ResizeObserver 不回调）。
            */}
            <AnimatePresence mode="wait" initial={false}>
              {activeTab === "trace" && (
                <motion.div key={activeTab} {...viewSwap} className="absolute inset-0 min-h-0">
                  <AgentRunInspector run={o.activeAgentRun} />
                </motion.div>
              )}
            </AnimatePresence>
            {activeTab === "profile" && <ProfilePanel profile={o.profile} tags={o.tags} updatedAt={o.profileUpdatedAt} sources={o.profileSources} />}
            {activeTab === "path" && (
              <PathPanel
                path={o.masterPath}
                scheduleAnchor={o.masterPathScheduleAnchor}
                completed={o.completedMaterials}
                resources={o.resources}
                onRecordEvidence={(key, content) =>
                  o.recordTaskEvidence(key, content, "written_response")
                }
                onOpenResource={(item, taskKey) => {
                  setResourceViewerActivated(true);
                  setOpenResource({ item, taskKey });
                }}
              />
            )}
            {activeTab === "browser" && <div ref={browserSlotRef} className="h-full" />}
          </div>
              <button type="button" className="absolute -left-1.5 top-1/2 z-50 grid h-14 w-3 -translate-y-1/2 cursor-col-resize place-items-center rounded-sm text-[#9f896c] hover:bg-[#dcc9ad]" role="separator" aria-label="调整协同检查器宽度" tabIndex={0} onPointerDown={(event) => startResize(event, "right")} onDoubleClick={() => resetWidth("right")} onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); adjustWidth("right", event.shiftKey ? 32 : 16); }
                if (event.key === "ArrowRight") { event.preventDefault(); adjustWidth("right", event.shiftKey ? -32 : -16); }
              }}>
                <GripVertical className="size-3" />
              </button>
            </>
          )}
        </aside>
      </div>

      {resourceViewerActivated ? (
        <ResourceViewer
          item={openResource?.item ?? null}
          taskKey={openResource?.taskKey}
          onClose={() => setOpenResource(null)}
        />
      ) : null}
      <TeacherChooser
        open={teacherChooserOpen}
        onClose={() => setTeacherChooserOpen(false)}
        onChoose={(teacher) => {
          o.newConversation(teacher);
          setConversationGroup("general");
          setTeacherChooserOpen(false);
        }}
      />
    </div>
  );
}
