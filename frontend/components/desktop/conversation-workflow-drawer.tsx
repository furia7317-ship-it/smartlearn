"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Bot,
  Check,
  CircleCheck,
  CirclePlay,
  Database,
  GitBranch,
  Settings2,
  ShieldCheck,
  X,
  type LucideIcon,
} from "lucide-react";

import { AssistantAvatar } from "@/components/agent-bits";
import { ShellLink as Link } from "@/components/shell-link";
import {
  loadConversationWorkflowSettings,
  saveConversationWorkflowSettings,
  type ConversationKnowledgeScope,
  type ConversationMemoryPolicy,
} from "@/lib/conversation-workflow-settings";
import {
  loadCustomWorkflows,
  type CustomWorkflow,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "@/lib/custom-workflows";
import type { TeacherPersona } from "@/lib/teacher-persona";
import { cn } from "@/lib/utils";

const NODE_ICON: Record<WorkflowNodeKind, LucideIcon> = {
  start: CirclePlay,
  agent: Bot,
  knowledge: Database,
  condition: GitBranch,
  review: ShieldCheck,
  end: CircleCheck,
};

function previewNodes(workflow: CustomWorkflow | null): WorkflowNode[] {
  if (!workflow) return [];
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = new Set(workflow.edges.map((edge) => edge.to));
  const start =
    workflow.nodes.find((node) => node.kind === "start") ??
    workflow.nodes.find((node) => !incoming.has(node.id)) ??
    workflow.nodes[0];
  if (!start) return [];

  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  let current: WorkflowNode | undefined = start;
  while (current && ordered.length < 5 && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);
    const nextEdge = workflow.edges.find(
      (edge) => edge.from === current?.id && !visited.has(edge.to),
    );
    current = nextEdge ? byId.get(nextEdge.to) : undefined;
  }

  if (ordered.length < Math.min(5, workflow.nodes.length)) {
    const remaining = [...workflow.nodes]
      .filter((node) => !visited.has(node.id))
      .sort((left, right) => left.x - right.x || left.y - right.y);
    ordered.push(...remaining.slice(0, 5 - ordered.length));
  }
  return ordered;
}

function WorkflowConnector({
  index,
  reduceMotion,
}: {
  index: number;
  reduceMotion: boolean;
}) {
  return (
    <span className="relative h-px min-w-3 flex-1 bg-[#cdbb9f]" aria-hidden>
      <motion.span
        className="absolute -top-px left-0 h-[3px] w-1/4 rounded-full bg-[#b8782e] shadow-[0_0_0_2px_rgba(184,120,46,0.10)] will-change-transform"
        initial={{ x: "-100%" }}
        animate={reduceMotion ? undefined : { x: ["-100%", "400%"] }}
        transition={
          reduceMotion
            ? undefined
            : {
                duration: 1.25,
                delay: index * 0.22,
                ease: "linear",
                repeat: Infinity,
                repeatDelay: 0.5,
              }
        }
      />
    </span>
  );
}

export function ConversationWorkflowDrawer({
  open,
  onClose,
  mode,
  conversationId,
  conversationTitle,
  teacher,
  onCreate,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  conversationId?: string;
  conversationTitle: string;
  teacher: TeacherPersona;
  onCreate?: () => string | undefined;
  disabled?: boolean;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const reduceMotion = Boolean(useReducedMotion());
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [knowledgeScope, setKnowledgeScope] =
    useState<ConversationKnowledgeScope>("course");
  const [memoryPolicy, setMemoryPolicy] =
    useState<ConversationMemoryPolicy>("session");
  const [savedWorkflowId, setSavedWorkflowId] = useState("");

  useEffect(() => {
    if (!open) return;
    const available = loadCustomWorkflows(window.localStorage);
    const saved =
      mode === "edit" && conversationId
        ? loadConversationWorkflowSettings(window.localStorage, conversationId)
        : null;
    const savedExists = available.some(
      (workflow) => workflow.id === saved?.workflowId,
    );
    const nextWorkflowId = savedExists
      ? saved?.workflowId ?? ""
      : available[0]?.id ?? "";
    setWorkflows(available);
    setWorkflowId(nextWorkflowId);
    setSavedWorkflowId(savedExists ? saved?.workflowId ?? "" : "");
    setKnowledgeScope(saved?.knowledgeScope ?? "course");
    setMemoryPolicy(saved?.memoryPolicy ?? "session");

    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>("button, select")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [conversationId, mode, onClose, open]);

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === workflowId) ?? null,
    [workflowId, workflows],
  );
  const nodes = useMemo(
    () => previewNodes(selectedWorkflow),
    [selectedWorkflow],
  );

  const applySettings = () => {
    if (!workflowId || disabled) return;
    const targetConversationId =
      mode === "create" ? onCreate?.() : conversationId;
    if (!targetConversationId) return;
    saveConversationWorkflowSettings(window.localStorage, {
      conversationId: targetConversationId,
      workflowId,
      knowledgeScope,
      memoryPolicy,
    });
    setSavedWorkflowId(workflowId);
    if (mode === "create") onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="关闭会话设置"
            className="absolute inset-0 z-[55] cursor-default bg-[#2f2418]/[0.06]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            onClick={onClose}
          />
          <motion.section
            ref={drawerRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="conversation-workflow-settings-title"
            className="absolute inset-y-0 left-0 z-[60] flex w-[min(420px,calc(100vw-96px))] min-w-0 flex-col border-r border-[#d2c1a8] bg-[#fbf7f0] text-[#3a2d1f] shadow-[18px_0_44px_rgba(54,42,27,0.14)]"
            initial={{ x: reduceMotion ? 0 : -34, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: reduceMotion ? 0 : -26, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="flex h-16 shrink-0 items-center border-b border-[#dfd2c0] px-5">
              <div>
                <h2
                  id="conversation-workflow-settings-title"
                  className="font-display text-[18px] font-semibold"
                >
                  {mode === "create" ? "创建会话" : "会话设置"}
                </h2>
                <p className="mt-0.5 text-[10px] text-[#877762]">
                  {mode === "create"
                    ? "选择工作流并创建新的独立会话"
                    : "调整这段会话使用的工作流"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto grid size-8 place-items-center rounded-md text-[#806c54] hover:bg-[#eee4d5]"
                aria-label="关闭会话设置"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <section aria-labelledby="current-conversation-label">
                <h3
                  id="current-conversation-label"
                  className="text-[12px] font-semibold"
                >
                  {mode === "create" ? "新会话" : "目标会话"}
                </h3>
                <div className="mt-3 flex items-center gap-3 border-b border-[#e2d6c5] pb-4">
                  <AssistantAvatar teacher={teacher} className="size-11 rounded-lg" />
                  <div className="min-w-0">
                    <strong className="block truncate text-[13px] font-semibold">
                      {mode === "create"
                        ? "新的工作流会话"
                        : conversationTitle || "新会话"}
                    </strong>
                    <span className="mt-0.5 block text-[10px] text-[#897862]">
                      {mode === "create"
                        ? "设置完成后进入新会话，当前记录保持不变"
                        : "仅调整这段会话，不会改动其他记录"}
                    </span>
                  </div>
                </div>
              </section>

              <section className="mt-4" aria-labelledby="saved-workflows-label">
                <div className="flex items-center">
                  <h3
                    id="saved-workflows-label"
                    className="text-[12px] font-semibold"
                  >
                    我的工作流
                  </h3>
                  <Link
                    href="/settings/"
                    className="ml-auto text-[10px] font-medium text-[#8b5620] underline-offset-2 hover:underline"
                  >
                    管理工作流
                  </Link>
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-[#ddcfbc] bg-[#fffaf2]">
                  {workflows.map((workflow, index) => (
                    <button
                      key={workflow.id}
                      type="button"
                      aria-pressed={workflow.id === workflowId}
                      onClick={() => {
                        setWorkflowId(workflow.id);
                        setSavedWorkflowId("");
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3.5 py-3 text-left transition",
                        index > 0 && "border-t border-[#e5dacb]",
                        workflow.id === workflowId
                          ? "bg-[#f7ebd9] text-[#4a351f]"
                          : "hover:bg-[#fbf3e7]",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-md border",
                          workflow.id === workflowId
                            ? "border-[#b98950] bg-[#fff8ec] text-[#9a6427]"
                            : "border-[#d8c8b1] bg-white text-[#806a50]",
                        )}
                      >
                        <Settings2 className="size-[17px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-[12px] font-semibold">
                          {workflow.name}
                        </strong>
                        <small className="mt-0.5 block truncate text-[9px] text-[#8a7861]">
                          {workflow.nodes.length} 个节点 ·{" "}
                          {workflow.status === "published" ? "已发布" : "草稿"}
                        </small>
                      </span>
                      {workflow.id === workflowId && (
                        <Check className="size-4 shrink-0 text-[#8e5d25]" />
                      )}
                    </button>
                  ))}
                  {workflows.length === 0 && (
                    <div className="px-4 py-6 text-center">
                      <p className="text-[11px] text-[#756653]">
                        还没有可用工作流
                      </p>
                      <Link
                        href="/settings/"
                        className="mt-2 inline-flex text-[10px] font-semibold text-[#8b5620] hover:underline"
                      >
                        去高级设置创建
                      </Link>
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-5" aria-labelledby="workflow-structure-label">
                <h3
                  id="workflow-structure-label"
                  className="text-[12px] font-semibold"
                >
                  工作流结构
                </h3>
                <div className="mt-3 flex min-h-[84px] items-center rounded-lg border border-[#dfd1be] bg-[#fffaf2] px-3 py-3">
                  {nodes.map((node, index) => {
                    const Icon = NODE_ICON[node.kind];
                    return (
                      <div
                        key={node.id}
                        className="contents"
                      >
                        <div className="flex w-[54px] shrink-0 flex-col items-center text-center">
                          <span className="grid size-10 place-items-center rounded-lg border border-[#d9c7ac] bg-[#fffdf9] text-[#8d632f]">
                            <Icon className="size-[17px]" />
                          </span>
                          <span className="mt-1.5 line-clamp-2 text-[8px] leading-3 text-[#675742]">
                            {node.title}
                          </span>
                        </div>
                        {index < nodes.length - 1 && (
                          <WorkflowConnector
                            index={index}
                            reduceMotion={reduceMotion}
                          />
                        )}
                      </div>
                    );
                  })}
                  {nodes.length === 0 && (
                    <p className="w-full text-center text-[10px] text-[#8a7861]">
                      选择工作流后查看节点结构
                    </p>
                  )}
                </div>
              </section>

              <section className="mt-5 space-y-4" aria-label="工作流会话参数">
                <label className="block">
                  <span className="text-[12px] font-semibold">知识库范围</span>
                  <span className="relative mt-2 flex items-center">
                    <BookOpen className="pointer-events-none absolute left-3 size-4 text-[#8f6b40]" />
                    <select
                      value={knowledgeScope}
                      onChange={(event) => {
                        setKnowledgeScope(
                          event.target.value as ConversationKnowledgeScope,
                        );
                        setSavedWorkflowId("");
                      }}
                      className="h-11 w-full appearance-none rounded-lg border border-[#ddcfbc] bg-[#fffaf2] pl-10 pr-9 text-[11px] text-[#4b3b2a] outline-none focus:border-[#a9783d]"
                    >
                      <option value="course">数据结构课程知识库</option>
                      <option value="personal">仅个人知识库</option>
                      <option value="all">课程与个人知识库</option>
                    </select>
                  </span>
                </label>

                <label className="block">
                  <span className="text-[12px] font-semibold">记忆策略</span>
                  <span className="relative mt-2 flex items-center">
                    <Database className="pointer-events-none absolute left-3 size-4 text-[#8f6b40]" />
                    <select
                      value={memoryPolicy}
                      onChange={(event) => {
                        setMemoryPolicy(
                          event.target.value as ConversationMemoryPolicy,
                        );
                        setSavedWorkflowId("");
                      }}
                      className="h-11 w-full appearance-none rounded-lg border border-[#ddcfbc] bg-[#fffaf2] pl-10 pr-9 text-[11px] text-[#4b3b2a] outline-none focus:border-[#a9783d]"
                    >
                      <option value="session">仅在当前会话记忆</option>
                      <option value="long_term">使用长期学习记忆</option>
                      <option value="none">不保留会话记忆</option>
                    </select>
                  </span>
                </label>
              </section>
            </div>

            <footer className="shrink-0 border-t border-[#dfd2c0] bg-[#f8f1e7] p-5">
              <button
                type="button"
                disabled={!workflowId || disabled}
                onClick={applySettings}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-semibold transition",
                  mode === "edit" && savedWorkflowId === workflowId && workflowId
                    ? "bg-[#e7eee3] text-[#47704c]"
                    : "bg-[#99601f] text-[#fffaf1] hover:bg-[#7f4e19]",
                  (!workflowId || disabled) &&
                    "cursor-not-allowed bg-[#d9cdbd] text-[#8b7c68]",
                )}
              >
                {mode === "edit" && savedWorkflowId === workflowId && workflowId ? (
                  <>
                    <Check className="size-4" />
                    会话设置已保存
                  </>
                ) : (
                  mode === "create" ? "创建新会话" : "保存会话设置"
                )}
              </button>
            </footer>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
