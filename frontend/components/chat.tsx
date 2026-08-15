"use client";

import { useEffect, useRef, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { selectRunSpans, type AgentRunStore } from "@/lib/agent-run-store";
import { uploadTutorAttachment } from "@/lib/api";

import { AssistantAvatar } from "@/components/agent-bits";
import { Markdown } from "@/components/markdown";
import { ResourcePlanCard } from "@/components/resource-plan-card";
import { Thinking } from "@/components/thinking";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VoiceCallControl } from "@/components/voice-call-control";
import type { PlanTask } from "@/hooks/use-orchestrator";
import { AGENT_MAP } from "@/lib/agents";
import { listCustomAgents, type CustomAgent } from "@/lib/custom-agents";
import type { ResourcePlan, ResourcePlanRecord } from "@/lib/resource-plan";
import type { LearningPathConfirmation } from "@/lib/learning-path-confirmation";
import { LearningBaselineGate } from "@/components/learning-baseline-gate";
import { STARTER_PROMPTS } from "@/lib/starter-content";
import { DEFAULT_TEACHER, type TeacherPersona } from "@/lib/teacher-persona";
import type {
  AgentId,
  AgentRuntime,
  AgentTraceStep,
  ChatMessage,
  PathStep,
  ResourceItem,
  TutorAttachment,
} from "@/lib/types";
import { cn } from "@/lib/utils";

function useStreamingDisclosure(streaming: boolean) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? streaming;
  const toggleOpen = () => setUserOpen(open ? false : true);
  return { open, toggleOpen };
}

const TRACE_ACTION_LABEL: Record<string, string> = {
  outline: "梳理大纲",
  plan: "编排任务",
  retrieval: "检索依据",
  generation: "生成资源",
  review: "审核资源",
  integration: "整合资源",
  schedule: "写入路径",
  reasoning_summary: "思考",
  tool: "调用工具",
  rework: "返工修复",
  persistence: "发布入库",
  run: "运行",
};

function formatTraceDuration(
  trace: AgentTraceStep[],
  streaming: boolean,
  now: number,
  processingStartedAt?: number | null,
  processingEndedAt?: number | null,
): string {
  const times = trace.flatMap((step) =>
    [step.started_at, step.ended_at]
      .map((value) => value ? Date.parse(value) : NaN)
      .filter((value) => Number.isFinite(value))
  );
  const startedAt = processingStartedAt
    ?? (times.length > 0 ? Math.min(...times) : null);
  if (!startedAt) return "";
  const endedAt = streaming
    ? now
    : processingEndedAt
      ?? (times.length > 0 ? Math.max(...times) : now);
  const elapsedMs = Math.max(0, endedAt - startedAt);
  const totalSeconds = elapsedMs / 1000;
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`;
  if (totalSeconds < 60) return `${Math.floor(totalSeconds)}s`;
  const wholeSeconds = Math.floor(totalSeconds);
  return `${Math.floor(wholeSeconds / 60)}m ${wholeSeconds % 60}s`;
}

function TraceStatusGlyph({ status }: { status: AgentTraceStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-emerald-600" />;
  if (status === "running") return <CircleDashed className="size-3.5 animate-spin text-primary" />;
  if (status === "failed" || status === "blocked") return <AlertTriangle className="size-3.5 text-danger" />;
  return <TerminalSquare className="size-3.5 text-muted-foreground/70" />;
}

function TraceProcessEntry({
  text,
  activity,
  observation,
  decisionSummary,
  meta,
  status,
  muted = false,
}: {
  text: string;
  activity?: string;
  observation?: string;
  decisionSummary?: string;
  meta?: string;
  status: AgentTraceStep["status"];
  muted?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", muted && "opacity-70")}>
      {meta && <div className="text-[11px] leading-4 text-muted-foreground">{meta}</div>}
      <p className="whitespace-pre-wrap text-[14px] leading-7 text-foreground">
        {text}
      </p>
      {(observation || decisionSummary) && (
        <div className="space-y-1 border-l border-border/70 pl-3 text-[12px] leading-5 text-muted-foreground">
          {observation && (
            <p>
              <span className="font-medium text-foreground/70">观察</span>
              <span className="mx-1 text-muted-foreground/60">/</span>
              {observation}
            </p>
          )}
          {decisionSummary && (
            <p>
              <span className="font-medium text-foreground/70">决策摘要</span>
              <span className="mx-1 text-muted-foreground/60">/</span>
              {decisionSummary}
            </p>
          )}
        </div>
      )}
      {activity && (
        <div className="flex items-center gap-1.5 text-[12px] leading-5 text-muted-foreground">
          <TraceStatusGlyph status={status} />
          <span>{activity}</span>
        </div>
      )}
    </div>
  );
}

const TRACE_EVENT_LABEL: Record<AgentTraceStep["event_type"], string> = {
  operation: "推导",
  reasoning: "思考",
  tool: "工具",
  delegate: "子智能体",
  verification: "核验",
  result: "结果",
};

function tracePublicSummary(step: AgentTraceStep): string | undefined {
  if (step.event_type === "reasoning") {
    return step.reasoning_text
      || step.decision_summary
      || step.detail
      || step.observation_summary
      || step.input_summary;
  }
  return step.observation_summary
    || step.detail
    || step.decision_summary
    || step.input_summary;
}

function visibleTraceEvents(trace: AgentTraceStep[]): AgentTraceStep[] {
  const detailed = trace.filter((step) => (
    step.visibility !== "verbose"
    && !["run", "runtime", "orchestration"].includes(step.action_type)
  ));
  return detailed.length > 0 ? detailed : trace;
}

function traceEventLabel(step: AgentTraceStep): string {
  if (["run", "runtime", "orchestration"].includes(step.action_type)) return "运行";
  return TRACE_EVENT_LABEL[step.event_type];
}

/** 只展示模型主动公开的摘要、工具与协作事件，不展示私密思维链。 */
function AgentTracePanel({
  trace,
  streaming,
  fallbackReasoning,
  processingStartedAt,
  processingEndedAt,
  onOpen,
}: {
  trace: AgentTraceStep[];
  streaming: boolean;
  fallbackReasoning?: string;
  processingStartedAt?: number;
  processingEndedAt?: number;
  onOpen?: () => void;
}) {
  const { open, toggleOpen } = useStreamingDisclosure(streaming);
  const [now, setNow] = useState(() => Date.now());
  const [fallbackStartedAt] = useState<number | null>(
    () => streaming ? Date.now() : null,
  );
  // The conversation surface shows only public summaries produced by the
  // model or by a truthful runtime checkpoint.
  // Low-level generation, review and persistence events remain available in
  // the inspector, without flooding the answer with an execution log.
  const reasoningEvents = visibleTraceEvents(trace)
    .filter((step) => step.event_type === "reasoning" && Boolean(tracePublicSummary(step)));
  const events = reasoningEvents;
  const hasReasoningSummary = Boolean(fallbackReasoning?.trim())
    || events.some((step) => step.event_type === "reasoning" && Boolean(tracePublicSummary(step)));
  // 消息是否仍在流式输出才决定顶部状态；不能让缺失的后端结束事件把 UI 永久卡在“处理中”。
  const active = streaming && hasReasoningSummary;
  const duration = formatTraceDuration(
    trace,
    active,
    now,
    processingStartedAt ?? fallbackStartedAt,
    processingEndedAt,
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const handleToggle = () => {
    if (!open) onOpen?.();
    toggleOpen();
  };

  // No placeholder or synthetic "generating summary" row: the disclosure
  // appears only after the first public reasoning character is available.
  if (!hasReasoningSummary) return null;

  return (
    <div className="mb-3 max-w-[820px] border-b border-border/70">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        className="inline-flex min-h-8 items-center gap-1 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <span>{active ? "处理中" : "已处理"}{duration ? ` ${duration}` : ""}</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="space-y-0.5 pb-3 pt-1" aria-label="处理过程">
          {fallbackReasoning && (
            <div className="min-w-0 pb-2">
              <p
                aria-live={streaming ? "polite" : undefined}
                className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/75"
              >
                {fallbackReasoning}
                {streaming && (
                  <span className="ml-0.5 inline-block animate-pulse text-primary" aria-hidden="true">
                    ▍
                  </span>
                )}
              </p>
            </div>
          )}
          {events.map((step, index) => {
            const summary = tracePublicSummary(step);
            const isReasoning = step.event_type === "reasoning";
            const isLast = index === events.length - 1 && !fallbackReasoning;
            return (
              <div
                key={step.span_id}
                className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-2"
              >
                {!isLast && (
                  <span className="absolute bottom-[-2px] left-[7px] top-4 w-px bg-border/80" />
                )}
                <span className="relative z-[1] mt-2 block size-2 rounded-full border border-primary/35 bg-background">
                  {step.status === "running" && (
                    <span className="absolute inset-[-3px] animate-pulse rounded-full bg-primary/15" />
                  )}
                </span>
                <div className="min-w-0 pb-3">
                  {isReasoning ? (
                    <p
                      aria-live={step.status === "running" ? "polite" : undefined}
                      className="whitespace-pre-wrap text-[12px] leading-5 text-foreground/75"
                    >
                      {summary}
                      {step.status === "running" && (
                        <span className="ml-0.5 inline-block animate-pulse text-primary" aria-hidden="true">
                          ▍
                        </span>
                      )}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {step.title || TRACE_ACTION_LABEL[step.action_type] || TRACE_EVENT_LABEL[step.event_type]}
                        </span>
                        <span>{traceEventLabel(step)}</span>
                        {step.agent_id && <span>· {AGENT_MAP[step.agent_id as AgentId]?.name ?? step.agent_id}</span>}
                      </div>
                      {summary && (
                        <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
                          {summary}
                        </p>
                      )}
                      {step.event_type === "delegate" && (step.from_agent || step.to_agent) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                          {[step.from_agent, step.to_agent].filter(Boolean).join(" → ")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {events.length === 0 && !fallbackReasoning && (
            <p className="pb-2 text-[12px] leading-5 text-muted-foreground">
              {streaming ? "正在等待第一条公开处理记录…" : "本轮没有保存可回放的公开处理记录。"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 计划块（任务分诊） ───────────────────────── */

function PlanBlock({
  agents,
  tasks,
  reason,
}: {
  agents: Record<AgentId, AgentRuntime>;
  tasks: PlanTask[];
  reason: string;
}) {
  const selectedAgents = Array.from(new Set(tasks.map((task) => task.agent)));
  const agentNames = selectedAgents.map((agent) => AGENT_MAP[agent]?.name ?? agent);
  const moduleSummary =
    agentNames.length > 4
      ? `${agentNames.slice(0, 4).join("、")}等 ${agentNames.length} 类资源`
      : agentNames.join("、") || "核心学习资源";
  const chapterNames = Array.from(
    new Set(tasks.map((task) => task.label.split(" · ")[0]).filter(Boolean))
  );
  const chapterSummary =
    chapterNames.length > 3
      ? `${chapterNames.slice(0, 3).join("、")}等 ${chapterNames.length} 个学习段`
      : chapterNames.join("、") || "本次学习主题";
  const activeCount = tasks.filter((task) => agents[task.agent]?.status === "working").length;
  const doneCount = tasks.filter((task) => agents[task.agent]?.status === "done").length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[820px] border-b border-border/70 pb-4"
    >
      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Clock3 className="size-3.5" />
        <span>已处理 · 资源规划</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {tasks.length} 项
        </span>
      </div>
      <div className="mt-3 space-y-4">
        <TraceProcessEntry
          text={`我会先把学习目标拆成「${chapterSummary}」，再判断每一段需要什么材料，而不是直接把所有 agent 都打开。`}
          activity={`已拆分 ${Math.max(1, chapterNames.length)} 个学习段`}
          status="completed"
        />
        {reason && (
          <TraceProcessEntry
            text={`分诊依据：${reason}`}
            activity={`已选用 ${moduleSummary}`}
            status="completed"
          />
        )}
        <TraceProcessEntry
          text={`接下来会按 ${moduleSummary} 并行生成资源；生成完不会马上交付，会先经过审核，再写入学习路径。`}
          activity={
            activeCount > 0
              ? `进行中 ${activeCount} 项 · 已完成 ${doneCount} 项`
              : `已排入 ${tasks.length} 个生成任务`
          }
          status={activeCount > 0 ? "running" : "completed"}
        />
      </div>
    </motion.div>
  );
}

function ResourceUpdateBlock({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[820px] border-b border-border/70 pb-3 text-[14px] leading-7 text-foreground"
    >
      生成资料已更新到学习路径和资源中心
      {count > 0 ? `，共 ${count} 项。` : "。"}
    </motion.div>
  );
}

function PathUpdateBlock({ count }: { count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-[820px] border-b border-border/70 pb-3 text-[14px] leading-7 text-foreground"
    >
      学习路径已更新
      {count > 0 ? `，共 ${count} 天任务。` : "。"}
    </motion.div>
  );
}

/* ── 欢迎页 ───────────────────────────────────── */

function Welcome({
  onPick,
  disabled,
  teacher = DEFAULT_TEACHER,
}: {
  onPick: (t: string) => void;
  disabled: boolean;
  teacher?: TeacherPersona;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col items-center pt-16">
      <AssistantAvatar className="size-12" teacher={teacher} />
      <h1 className="mt-5 font-display text-[26px] font-semibold tracking-tight">
        把难学的，讲成你能学的
      </h1>

      <div className="mt-9 w-full space-y-2">
        {STARTER_PROMPTS.map((s, i) => (
          <button
            key={s.label}
            disabled={disabled}
            onClick={() => onPick(s.text)}
            className={cn(
              "group flex w-full items-baseline gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors duration-150 hover:border-foreground/30 disabled:opacity-50"
            )}
          >
            <span className="flex w-[5em] shrink-0 items-center gap-1.5 text-xs font-medium">
              {i === 0 && <span className="size-1.5 rounded-full bg-danger" />}
              {s.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground group-hover:text-foreground/80">
              {s.text}
            </span>
            <ArrowUp className="size-3.5 shrink-0 self-center rotate-45 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── 消息列表 + 输入框 ────────────────────────── */

const FOLLOW_UPS = [
  "重叠子问题和分治有什么区别？",
  "背包问题怎么定义状态？",
  "先给我出 2 道热身题",
];

const ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".txt",
  ".md",
  ".markdown",
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

export function Chat({
  messages,
  agents,
  resources,
  path,
  planTasks,
  planReason,
  running,
  hasRunMain,
  onSend,
  onDeleteMessage,
  onInspectRun,
  plans = {},
  planSavingId = "",
  planExecutingId = "",
  planErrors = {},
  onSavePlan,
  onConfirmPlan,
  onReplanPlan,
  onCancelPlan,
  baselineGate,
  runStore,
  mode = "live",
  onStop,
  onVoiceNewConversation,
  onVoiceOpenResource,
  onRetry,
  canRetry = false,
  showInlineTrace = true,
  createHref = "/create",
  teacher = DEFAULT_TEACHER,
}: {
  messages: ChatMessage[];
  agents: Record<AgentId, AgentRuntime>;
  resources: ResourceItem[];
  path: PathStep[];
  planTasks: PlanTask[];
  planReason: string;
  running: boolean;
  hasRunMain: boolean;
  onSend: (t: string, attachments?: TutorAttachment[]) => void;
  onDeleteMessage?: (id: string) => void;
  onInspectRun?: (messageId: string) => void;
  plans?: Record<string, ResourcePlanRecord>;
  planSavingId?: string;
  planExecutingId?: string;
  planErrors?: Record<string, string>;
  onSavePlan?: (plan: ResourcePlan) => Promise<void>;
  onConfirmPlan?: (plan: ResourcePlan) => Promise<void>;
  onReplanPlan?: (plan: ResourcePlan, feedback: string) => Promise<void>;
  onCancelPlan?: (plan: ResourcePlan) => Promise<void>;
  runStore?: AgentRunStore;
  mode?: "checking" | "live" | "offline";
  onStop?: () => void | Promise<void>;
  onVoiceNewConversation?: () => void;
  onVoiceOpenResource?: (resourceId: string) => void | Promise<void>;
  onRetry?: () => void;
  canRetry?: boolean;
  showInlineTrace?: boolean;
  createHref?: string;
  teacher?: TeacherPersona;
  baselineGate?: {
    request: string | null;
    planningError?: { code?: string; message: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown } | null;
    onChoose: (confirmation: LearningPathConfirmation) => void;
    onRetryPlan?: () => void;
    onEditPlan?: () => void;
    onOpenKnowledgeBase?: () => void;
    planning?: boolean;
    initialConfirmation?: LearningPathConfirmation;
    onClarification?: (summary: string, streaming: boolean) => void;
    onCancel: () => void;
  };
}) {
  const [input, setInput] = useState("");
  // 计划编辑器的「执行者」下拉需要用户自建的智能体；一次会话只拉一次。
  const [customAgents, setCustomAgents] = useState<CustomAgent[]>([]);
  const [attachments, setAttachments] = useState<TutorAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const forceFollowRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const sendAndFollow = (text: string, files: TutorAttachment[] = []) => {
    forceFollowRef.current = true;
    onSend(text, files);
  };

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
    if (failures.length) setAttachmentError(failures.join("；"));
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    forceFollowRef.current = false;
    setShowNewMessages(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current || forceFollowRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowNewMessages(false);
    } else {
      setShowNewMessages(true);
    }
    forceFollowRef.current = false;
  }, [messages, resources, path, running]);

  useEffect(() => {
    let active = true;
    listCustomAgents(mode)
      .then((items) => {
        if (active) setCustomAgents(items);
      })
      .catch(() => {
        if (active) setCustomAgents([]);
      });
    return () => {
      active = false;
    };
  }, [mode]);

  const submit = () => {
    if ((!input.trim() && attachments.length === 0) || uploadingFiles.length > 0 || running || mode !== "live") return;
    const question = input.trim() || "请阅读这些附件并解答其中的问题，给出关键步骤、结论和必要的逐题解析。";
    sendAndFollow(question, attachments);
    setInput("");
    setAttachments([]);
    setAttachmentError("");
  };

  // 正在等首个响应（还没有助手内容）时显示「思考中…」
  const last = messages[messages.length - 1];
  const activeTraceMessageId = [...messages]
    .reverse()
    .find((message) => (
      message.role === "assistant"
      && (message.streaming || message.runId || message.reasoning)
    ))?.id;
  const lastTrace = last?.runId && runStore
    ? selectRunSpans(runStore.runs[last.runId])
    : last?.trace ?? [];
  const showThinking =
    running &&
    (!last ||
      last.role === "user" ||
      (last.role === "assistant" &&
        last.streaming &&
        last.content === "" &&
        !last.reasoning &&
        lastTrace.length === 0));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息区 */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          tabIndex={0}
          aria-label="对话消息"
          onScroll={(event) => {
            const el = event.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 72;
            nearBottomRef.current = near;
            if (near) setShowNewMessages(false);
          }}
          onKeyDown={(event) => {
            const el = event.currentTarget;
            if (event.key === "PageUp") { event.preventDefault(); el.scrollBy({ top: -el.clientHeight * 0.85, behavior: "smooth" }); }
            if (event.key === "PageDown") { event.preventDefault(); el.scrollBy({ top: el.clientHeight * 0.85, behavior: "smooth" }); }
            if (event.key === "Home") { event.preventDefault(); el.scrollTo({ top: 0, behavior: "smooth" }); }
            if (event.key === "End") { event.preventDefault(); scrollToBottom(); }
          }}
          className="thin-scroll h-full overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
        >
        <div className="mx-auto w-full max-w-[980px] px-6 pb-8 pt-6">
          {messages.length === 0 ? (
            <Welcome onPick={sendAndFollow} disabled={running || mode !== "live"} teacher={teacher} />
          ) : (
            <div className="space-y-5">
              {messages.map((m) => {
                const messageTrace = m.runId && runStore
                  ? selectRunSpans(runStore.runs[m.runId])
                  : m.trace ?? [];
                if (m.role === "user") {
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group flex items-center justify-end gap-1.5"
                    >
                      {onDeleteMessage && !running && (
                        <button
                          onClick={() => onDeleteMessage(m.id)}
                          aria-label="删除这条消息"
                          title="删除这条消息"
                          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                      <div className="max-w-[78%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                        {m.attachments && m.attachments.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-1.5 border-b border-white/20 pb-2">
                            {m.attachments.map((attachment) => (
                              <span key={attachment.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/12 px-2 py-1 text-[10px]">
                                {attachment.kind === "image" ? <ImageIcon className="size-3 shrink-0" /> : <FileText className="size-3 shrink-0" />}
                                <span className="truncate">{attachment.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      </div>
                    </motion.div>
                  );
                }
                if (m.kind === "plan") {
                  return (
                    <div key={m.id} className="pl-11">
                      <PlanBlock agents={agents} tasks={planTasks} reason={planReason} />
                    </div>
                  );
                }
                if (m.kind === "resources") {
                  return (
                    <div key={m.id} className="pl-11">
                      <ResourceUpdateBlock count={resources.length} />
                    </div>
                  );
                }
                if (m.kind === "path") {
                  return (
                    <div key={m.id} className="pl-11">
                      <PathUpdateBlock count={path.length} />
                    </div>
                  );
                }
                if (m.kind === "plan_review" && m.planId && plans[m.planId]) {
                  const record = plans[m.planId];
                  return (
                    <div key={m.id} className="pl-11">
                      <ResourcePlanCard
                        plan={record.plan}
                        saving={planSavingId === m.planId}
                        executing={planExecutingId === m.planId}
                        error={planErrors[m.planId]}
                        customAgents={customAgents}
                        onSave={onSavePlan ?? (async () => undefined)}
                        onConfirm={onConfirmPlan ?? (async () => undefined)}
                        onReplan={onReplanPlan ?? (async () => undefined)}
                        onCancel={onCancelPlan ?? (async () => undefined)}
                      />
                    </div>
                  );
                }
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="group flex gap-3"
                  >
                    <AssistantAvatar teacher={teacher} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      {showInlineTrace && (m.runId || messageTrace.length > 0 || m.reasoning) && (
                        <AgentTracePanel
                          trace={messageTrace}
                          streaming={m.streaming || (running && m.id === activeTraceMessageId)}
                          fallbackReasoning={m.reasoning}
                          processingStartedAt={m.processingStartedAt}
                          processingEndedAt={m.processingEndedAt}
                          onOpen={onInspectRun && m.runId ? () => onInspectRun(m.id) : undefined}
                        />
                      )}
                      {!showInlineTrace
                        && messageTrace.length > 0
                        && m.streaming
                        && !m.content.trim() && (
                        <Thinking />
                      )}
                      {/* interceptLinks：对话里的 B站视频/拓展资料链接就地在
                          「内置浏览器」抽屉打开，不跳系统浏览器 */}
                      {(m.content || messageTrace.length === 0) && (
                        <Markdown content={m.content} streaming={m.streaming} interceptLinks />
                      )}
                    </div>
                    {onDeleteMessage && !running && !m.streaming && (
                      <button
                        onClick={() => onDeleteMessage(m.id)}
                        aria-label="删除这条消息"
                        title="删除这条消息"
                        className="grid size-6 shrink-0 place-items-center self-start rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </motion.div>
                );
              })}
              {showThinking && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3"
                >
                  <AssistantAvatar teacher={teacher} />
                  <div className="pt-1.5">
                    <Thinking />
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
        </div>
        {showNewMessages && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[#c7a76b] bg-[#fffaf1] px-3 py-1.5 text-[11px] font-medium text-[#704719] shadow-md transition hover:bg-[#f4eadb]"
            aria-label="有新消息，回到底部"
          >
            有新消息 · 回到底部
          </button>
        )}
      </div>

      {baselineGate?.request && (
        <LearningBaselineGate
          request={baselineGate.request}
          onChoose={baselineGate.onChoose}
          onCancel={baselineGate.onCancel}
          planningError={baselineGate.planningError}
          onRetryPlan={baselineGate.onRetryPlan}
          onEditPlan={baselineGate.onEditPlan}
          onOpenKnowledgeBase={baselineGate.onOpenKnowledgeBase}
          planning={baselineGate.planning}
          initialConfirmation={baselineGate.initialConfirmation}
          onClarification={baselineGate.onClarification}
        />
      )}

      {/* 输入区 */}
      <div data-testid="chat-composer" className="shrink-0 border-t bg-background">
        <div className="mx-auto w-full max-w-[980px] px-6 py-4">
          {mode !== "live" && (
            <div className="mb-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-900" role="status">
              {mode === "checking"
                ? "正在检查真实 AI 后端，发送暂不可用。"
                : "真实 AI 后端未连接。请启动 backend 的 uvicorn 服务并确认 http://127.0.0.1:8000/docs 可访问后重试。"}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Link
              href={createHref}
              className="flex items-center gap-1 rounded-full border bg-card px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/40"
              title="打开生成资料表单：选类型 + 填知识点，确定性生成"
            >
              <Wand2 className="size-3" />
              生成资料
            </Link>
            {hasRunMain &&
              !running &&
              FOLLOW_UPS.map((f) => (
                <button
                  key={f}
                  onClick={() => sendAndFollow(f)}
                  disabled={mode !== "live"}
                  title={mode === "live" ? f : "连接真实 AI 后端后可使用"}
                  className="rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {f}
                </button>
              ))}
            {canRetry && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-auto flex items-center gap-1 rounded-full border border-[#b99565] bg-[#fffaf2] px-3 py-1 text-[11px] font-medium text-[#704a1d] hover:bg-[#f4eadb]"
              >
                <RotateCcw className="size-3" />
                重试上一问
              </button>
            )}
          </div>
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-2" aria-label="待发送附件">
              {attachments.map((attachment) => (
                <span key={attachment.id} title={attachment.recognition_notice} className="inline-flex max-w-[260px] items-center gap-2 rounded-lg border border-[#d8c7ae] bg-[#fffaf1] px-2.5 py-1.5 text-[11px] text-[#5f4a32] shadow-sm">
                  {attachment.kind === "image" ? <ImageIcon className="size-3.5 shrink-0 text-[#986324]" /> : <FileText className="size-3.5 shrink-0 text-[#5f7e9e]" />}
                  <span className="min-w-0"><b className="block truncate font-medium">{attachment.name}</b><small className="block text-[9px] text-[#8a7861]">{formatAttachmentSize(attachment.size)} · {attachment.recognition_status === "recognized" ? "讯飞已识别" : attachment.recognition_status === "fallback" ? "已读取文字层" : "已解析"}</small></span>
                  <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} className="grid size-5 shrink-0 place-items-center rounded text-[#8a7861] hover:bg-[#eee4d5]" aria-label={`移除附件 ${attachment.name}`}><X className="size-3" /></button>
                </span>
              ))}
              {uploadingFiles.map((name, index) => (
                <span key={`${name}-${index}`} className="inline-flex max-w-[260px] items-center gap-2 rounded-lg border border-[#d8c7ae] bg-[#f7f1e7] px-2.5 py-1.5 text-[11px] text-[#6f5d48]">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" /><span className="truncate">正在识别 {name}</span>
                </span>
              ))}
            </div>
          )}
          {attachmentError && <p className="mb-2 rounded-lg border border-danger/30 bg-danger/[0.04] px-3 py-2 text-[11px] leading-5 text-danger" role="alert">{attachmentError}</p>}
          <div
            className={cn(
              "relative flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring/30",
              dragActive && "border-[#9b6727] bg-[#fffaf1] ring-2 ring-[#c7a76b]/35",
            )}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragActive(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              if (!running && event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
            }}
          >
            {dragActive && (
              <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-[#fffaf1]/95 text-[#704719]">
                <span className="flex items-center gap-2 text-sm font-medium"><UploadCloud className="size-5" />松开即可加入智能教师</span>
              </div>
            )}
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
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 rounded-full text-[#765638]"
              onClick={() => fileInputRef.current?.click()}
              disabled={running || attachments.length + uploadingFiles.length >= 5}
              aria-label="上传图片、文档或 PDF"
              title="上传或拖入图片、PDF、Word、PPT、Excel 等文件"
            >
              <Paperclip className="size-4" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                running
                  ? "可继续输入；如需发送，请先停止当前运行…"
                  : "输入问题，或把图片、PDF、Word 等文件拖到这里…"
              }
              className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent p-1.5 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
              rows={1}
            />
            <VoiceCallControl
              messages={messages}
              running={running}
              enabled={mode === "live"}
              onSend={sendAndFollow}
              onStop={onStop}
              onNewConversation={onVoiceNewConversation}
              resources={resources}
              onOpenResource={onVoiceOpenResource}
            />
            {running ? (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="size-8 shrink-0 rounded-full"
                onClick={() => void onStop?.()}
                disabled={!onStop}
                aria-label="停止当前运行"
                title="停止当前运行"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-8 shrink-0 rounded-full"
                onClick={submit}
                disabled={mode !== "live" || uploadingFiles.length > 0 || (!input.trim() && attachments.length === 0)}
                aria-label="发送"
                title={mode === "live" ? "发送" : "连接真实 AI 后端后可发送"}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 text-center text-[11px] text-muted-foreground/80" aria-live="polite">
            {running ? "当前运行中；输入内容会保留，停止后即可发送" : "Enter 发送 · Shift+Enter 换行 · 支持点击或拖拽上传图片、PDF 与 Office 文档"}
          </div>
        </div>
      </div>
    </div>
  );
}
