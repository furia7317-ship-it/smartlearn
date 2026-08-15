"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Ban,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  GitBranch,
  Network,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench,
} from "lucide-react";

import {
  isTerminalRunStatus,
  runDurationMs,
  runHasOpenSpans,
  selectRunParticipants,
  selectRunSpans,
  type AgentRunRecord,
} from "@/lib/agent-run-store";
import { AGENT_MAP } from "@/lib/agents";
import type {
  AgentId,
  AgentRunEventType,
  AgentRunStatus,
  AgentTraceStep,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type DisplayDensity = "normal" | "verbose" | "result";

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  pending: "等待",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  blocked: "已阻塞",
  cancelled: "已取消",
};

const EVENT_LABEL: Record<AgentRunEventType, string> = {
  operation: "推导",
  reasoning: "思考",
  tool: "工具",
  delegate: "协作",
  verification: "检查",
  result: "结果",
};

function StatusGlyph({ status }: { status: AgentRunStatus }) {
  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 text-[#3f7d51]" />;
  }
  if (status === "running") {
    return <CircleDashed className="size-3.5 animate-spin text-[#a86f22]" />;
  }
  if (status === "cancelled") {
    return <Ban className="size-3.5 text-muted-foreground" />;
  }
  if (status === "failed") {
    return <AlertCircle className="size-3.5 text-[#a34036]" />;
  }
  if (status === "blocked") {
    return <ShieldCheck className="size-3.5 text-[#a34036]" />;
  }
  return <CircleDashed className="size-3.5 text-muted-foreground" />;
}

function agentLabel(agentId: string): string {
  return AGENT_MAP[agentId as AgentId]?.name ?? agentId;
}

function actionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    run: "运行",
    runtime: "运行",
    orchestration: "协同调度",
    delegate: "分派任务",
    subrun: "子智能体执行",
    plan: "制定计划",
    phase: "推进阶段",
    retrieval: "检索依据",
    tool_call: "调用工具",
    generation: "生成内容",
    review: "质量检查",
    verification: "核验结果",
    rework: "返工修正",
    integration: "整合结果",
    persistence: "保存资料",
    reasoning: "思考",
  };
  return labels[actionType] ?? actionType.replaceAll("_", " ");
}

function EventIcon({ type }: { type: AgentRunEventType }) {
  const iconClass = "size-3.5";
  if (type === "reasoning") return <Brain className={iconClass} />;
  if (type === "tool") return <Wrench className={iconClass} />;
  if (type === "delegate") return <Network className={iconClass} />;
  if (type === "verification") return <ShieldCheck className={iconClass} />;
  if (type === "result") return <Sparkles className={iconClass} />;
  return <GitBranch className={iconClass} />;
}

function toolPolicyLabels(span: AgentTraceStep): string[] {
  const policy = span.tool_policy;
  if (!policy) return [];
  const labels: string[] = [];
  if (policy.effect === "read") labels.push("只读");
  else if (policy.effect === "write") labels.push("会写入");
  else if (policy.effect) labels.push(String(policy.effect));
  if (policy.open_world) labels.push("访问外部");
  if (policy.destructive) labels.push("可能破坏");
  if (policy.approval === "auto") labels.push("自动执行");
  else if (policy.approval === "ask") labels.push("执行前确认");
  else if (policy.approval === "forbidden") labels.push("禁止执行");
  return labels;
}

function isRootSpan(run: AgentRunRecord, span: AgentTraceStep): boolean {
  return span.span_id === run.runId || ["run", "runtime", "orchestration"].includes(span.action_type);
}

function visibleSpans(
  run: AgentRunRecord,
  density: DisplayDensity,
): AgentTraceStep[] {
  const spans = selectRunSpans(run);
  if (density === "verbose") return spans;
  if (density === "result") {
    return spans.filter(
      (span) =>
        span.event_type === "result" ||
        span.status === "failed" ||
        span.status === "blocked",
    );
  }
  return spans.filter((span) => {
    if (isRootSpan(run, span)) return false;
    if (span.visibility === "verbose") return false;
    return true;
  });
}

function EventBody({ span, density }: { span: AgentTraceStep; density: DisplayDensity }) {
  const reasoning = span.reasoning_text || (
    span.event_type === "reasoning" ? span.decision_summary : undefined
  );
  const policyLabels = toolPolicyLabels(span);
  const summary =
    span.observation_summary ||
    span.detail ||
    span.decision_summary ||
    span.input_summary;

  if (span.event_type === "reasoning" && reasoning) {
    return (
      <p className="whitespace-pre-wrap text-[11px] leading-[1.65] text-[#5d5142]">
        {reasoning}
        {span.status === "running" && (
          <span className="ml-0.5 inline-block animate-pulse text-[#9b681f]" aria-hidden="true">
            ▍
          </span>
        )}
      </p>
    );
  }

  return (
    <>
      {summary && (
        <p className="text-[11px] leading-[1.6] text-[#645746]">
          {summary}
        </p>
      )}
      {span.event_type === "delegate" && (span.from_agent || span.to_agent) && (
        <p className="mt-1.5 text-[10px] text-[#806f5a]">
          {[span.from_agent && agentLabel(span.from_agent), span.to_agent && agentLabel(span.to_agent)]
            .filter(Boolean)
            .join(" → ")}
        </p>
      )}
      {policyLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {policyLabels.map((label) => (
            <span
              key={label}
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px]",
                label.includes("破坏") || label.includes("禁止")
                  ? "border-[#d8aaa4] bg-[#fff4f2] text-[#963e34]"
                  : "border-[#decfb9] bg-[#f8f2e8] text-[#6c5a43]",
              )}
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {density === "verbose" && span.evidence_ids.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {span.evidence_ids.map((id) => (
            <code
              key={id}
              className="max-w-full truncate rounded bg-[#eee5d7] px-1.5 py-0.5 text-[9px] text-[#665744]"
            >
              {id}
            </code>
          ))}
        </div>
      )}
      {span.error_code && (
        <p className="mt-1.5 text-[10px] text-[#963e34]">
          {span.error_code} · {span.retryable === false ? "不可重试" : "可以重试"}
        </p>
      )}
    </>
  );
}

function TimelineEvent({
  span,
  density,
  last,
}: {
  span: AgentTraceStep;
  density: DisplayDensity;
  last: boolean;
}) {
  const isReasoning = span.event_type === "reasoning";
  const title = span.title || actionLabel(span.action_type);
  const expandable =
    !isReasoning &&
    density === "verbose" &&
    Boolean(
      span.input_summary ||
      span.observation_summary ||
      span.decision_summary ||
      span.reasoning_text ||
      span.evidence_ids.length ||
      span.error_code,
    );

  return (
    <div className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
      {!last && (
        <span className="absolute bottom-[-10px] left-[11px] top-6 w-px bg-[#dfd3c1]" />
      )}
      <span
        className={cn(
          "relative z-[1] mt-0.5 grid size-6 place-items-center rounded-full border",
          span.event_type === "reasoning"
            ? "border-[#d2b684] bg-[#fbf1df] text-[#9b681f]"
            : span.event_type === "tool"
              ? "border-[#bfd0ba] bg-[#f0f6ee] text-[#4f7b50]"
              : "border-[#d9ccb9] bg-[#faf6ef] text-[#76634c]",
        )}
      >
        <EventIcon type={span.event_type} />
      </span>
      <div className="min-w-0 pb-3">
        {isReasoning ? (
          <div aria-live={span.status === "running" ? "polite" : undefined}>
            <EventBody span={span} density={density} />
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-[#382b1d]">{title}</p>
                <p className="mt-0.5 text-[9px] text-[#8a7963]">
                  {agentLabel(span.agent_id)} · {EVENT_LABEL[span.event_type]} · {STATUS_LABEL[span.status]}
                  {span.attempt > 1 ? ` · 第 ${span.attempt} 次` : ""}
                </p>
              </div>
              <StatusGlyph status={span.status} />
            </div>
            {expandable ? (
              <details className="group mt-1.5" open={span.status === "running"}>
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] text-[#8b714e]">
                  查看详情
                  <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-1.5 rounded-md border border-[#e4d8c7] bg-white/55 px-2.5 py-2">
                  <EventBody span={span} density={density} />
                </div>
              </details>
            ) : (
              <div className="mt-1.5">
                <EventBody span={span} density={density} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyRun() {
  return (
    <div className="m-3 rounded-lg border border-dashed border-[#cdbca3] bg-[#faf6ef] p-4 text-[12px] leading-5 text-[#756653]">
      <GitBranch className="mb-2 size-5 text-[#9d6b2d]" />
      发起问题后，这里会按实际顺序显示思考摘要、工具调用、智能体协作和核验结果。
    </div>
  );
}

export function AgentRunInspector({ run }: { run?: AgentRunRecord }) {
  const [density, setDensity] = useState<DisplayDensity>("normal");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spans = useMemo(
    () => (run ? visibleSpans(run, density) : []),
    [density, run],
  );
  const participants = useMemo(
    () => (run ? selectRunParticipants(run) : []),
    [run],
  );

  useEffect(() => {
    if (!run || isTerminalRunStatus(run.status)) return;
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [run, spans.length]);

  if (!run) return <EmptyRun />;

  const duration = runDurationMs(run);
  const hasOpenSpans = runHasOpenSpans(run);
  const waitingForTerminal = run.status === "running" && !hasOpenSpans;
  const terminalWithOpenSpans = isTerminalRunStatus(run.status) && hasOpenSpans;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="shrink-0 border-b border-[#ded0bc] bg-[#faf6ef] px-3 py-2.5"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <StatusGlyph status={run.status} />
          <span className="text-[12px] font-semibold text-[#382b1d]">
            {run.status === "running" ? "智能教师正在处理" : STATUS_LABEL[run.status]}
          </span>
          {duration !== undefined && (
            <span className="ml-auto text-[9px] text-[#81715d]">
              {(duration / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        {(waitingForTerminal || terminalWithOpenSpans) && (
          <p className="mt-1 text-[9px] text-[#9a463d]">
            {waitingForTerminal ? "等待后端结束信号" : "部分动作没有收到结束事件"}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <UsersRound className="size-3 text-[#9d6b2d]" />
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {participants.slice(0, 5).map((agentId) => (
              <span
                key={agentId}
                className="max-w-24 truncate rounded-full border border-[#dfd1bd] bg-white/65 px-1.5 py-0.5 text-[9px] text-[#5f503e]"
              >
                {agentLabel(agentId)}
              </span>
            ))}
            {participants.length > 5 && (
              <span className="text-[9px] text-[#81715d]">+{participants.length - 5}</span>
            )}
            {participants.length === 0 && (
              <span className="text-[9px] text-[#81715d]">等待参与者</span>
            )}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 rounded-md border border-[#ddcfbb] bg-white/55 p-0.5">
          {([
            ["normal", "过程"],
            ["verbose", "详细"],
            ["result", "结果"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDensity(value)}
              className={cn(
                "rounded px-1.5 py-1 text-[9px] transition",
                density === value
                  ? "bg-[#6f4d25] text-white shadow-sm"
                  : "text-[#74634f] hover:bg-[#f0e7d9]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollerRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {density === "result" && (
          <div className="mb-3 rounded-lg border border-[#dccdb8] bg-[#faf6ef] p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-[#382b1d]">
              <StatusGlyph status={run.status} />
              本轮{STATUS_LABEL[run.status]}
            </div>
            <p className="mt-1 text-[10px] leading-5 text-[#766653]">
              共记录 {run.eventOrder.length} 个事件，{selectRunSpans(run).length} 个动作，
              {participants.length} 个参与者。
            </p>
          </div>
        )}
        {spans.length > 0 ? (
          spans.map((span, index) => (
            <TimelineEvent
              key={span.span_id}
              span={span}
              density={density}
              last={index === spans.length - 1}
            />
          ))
        ) : (
          <div className="rounded-lg border border-dashed border-[#d8c9b4] px-3 py-4 text-center text-[10px] leading-5 text-[#81715d]">
            {run.status === "running" ? "正在等待下一条公开事件…" : "当前视图没有更多事件"}
          </div>
        )}
      </div>
    </div>
  );
}
