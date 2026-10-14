"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { currentAgentActivity, tracePublicSummary, visibleTraceEvents } from "@/lib/agent-progress";
import type { AgentMessageProgress, AgentRunStatus, AgentTraceStep } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<AgentRunStatus, string> = {
  pending: "等待中", running: "进行中", completed: "已完成",
  failed: "失败", blocked: "已阻塞", cancelled: "已取消",
};
const EVENT_LABEL = {
  reasoning: "推理摘要", tool: "工具调用", delegate: "协作任务",
  operation: "处理步骤", verification: "审核检查", result: "执行结果",
};

/** Public progress and execution records shown inside the floating teacher. */
export function AgentTracePanel({
  trace, streaming, cancellationRequested, fallbackReasoning, progress, processingStartedAt, processingEndedAt, compact = false,
}: {
  trace: AgentTraceStep[];
  streaming: boolean;
  cancellationRequested?: boolean;
  fallbackReasoning?: string;
  progress?: AgentMessageProgress;
  processingStartedAt?: number;
  processingEndedAt?: number;
  compact?: boolean;
}) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const open = userOpen ?? streaming;
  const events = visibleTraceEvents(trace);
  const shown = showEarlier ? events : events.slice(-6);
  const root = trace.findLast(step => ["run", "runtime", "orchestration"].includes(step.action_type));
  const failed = root?.status === "failed" || root?.status === "blocked";
  const terminalLabel = root?.status === "cancelled" ? "已停止" : failed ? "执行未完成" : root?.status === "completed" ? "已完成" : "已结束";
  const started = processingStartedAt || Math.min(...trace.map(step => Date.parse(step.started_at || "")).filter(Number.isFinite), mountedAt);
  const ended = processingEndedAt || Date.parse(root?.ended_at || "") || now;
  const elapsed = Math.max(0, Math.floor(((streaming ? now : ended) - started) / 1000));
  const duration = elapsed < 60 ? `${elapsed} 秒` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒`;
  const activity = currentAgentActivity(trace, progress);

  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node && open && followRef.current && !showEarlier) node.scrollTop = node.scrollHeight;
  }, [trace, progress, fallbackReasoning, open, showEarlier]);

  if (!streaming && !events.length && !fallbackReasoning && !progress) return null;

  return (
    <section className="mb-3 min-w-0 border-b border-current/15 pb-2" aria-label="智能教师执行进度">
      <button type="button" aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="flex min-h-8 w-full flex-wrap items-center gap-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <span className={cn("size-1.5 rounded-full bg-current", streaming && "motion-safe:animate-pulse")} aria-hidden />
        <span className="font-medium">{streaming ? cancellationRequested ? "正在停止" : "处理中" : terminalLabel}</span>
        <span className="opacity-65">{duration}{events.length ? ` · ${events.length} 条记录` : ""}</span>
        <ChevronRight className={cn("ml-auto size-3 shrink-0", open && "rotate-90")} aria-hidden />
      </button>
      {streaming && <p role="status" className="mb-2 break-words text-xs leading-5 opacity-80">
        {cancellationRequested ? "已请求停止，正在等待当前步骤结束；后续步骤不会继续执行。" : activity}
      </p>}
      {open && (
        <div ref={scrollRef} aria-label="处理过程" tabIndex={0}
          onScroll={event => {
            const node = event.currentTarget;
            followRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
          }}
          className={cn("thin-scroll space-y-3 overflow-y-auto overscroll-contain pr-1 text-xs leading-5 [overflow-wrap:anywhere]", compact ? "max-h-60" : "max-h-80")}>
          {events.length > 6 && <button type="button" className="underline underline-offset-4 opacity-70" onClick={() => setShowEarlier(!showEarlier)}>
            {showEarlier ? "只看最近记录" : `展开更早的 ${events.length - 6} 条记录`}
          </button>}
          {fallbackReasoning && <div><p className="mb-1 font-medium">推理摘要</p><p className="whitespace-pre-wrap opacity-80">{fallbackReasoning}</p></div>}
          {shown.map(step => {
            const summary = tracePublicSummary(step);
            const unfinished = step.status === "running" || step.status === "pending";
            return <div key={`${step.run_id}:${step.span_id}`} className="border-l border-current/20 pl-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium">{step.event_type === "reasoning" ? "推理摘要" : step.title || EVENT_LABEL[step.event_type]}</span>
                {step.event_type !== "reasoning" && <span className="text-[10px] opacity-60">{EVENT_LABEL[step.event_type]}</span>}
                <span className={cn("text-[10px]", step.status === "failed" || step.status === "blocked" ? "text-red-700" : "opacity-60")}>
                  {!streaming && unfinished ? "结束时未返回终态" : STATUS[step.status]}
                </span>
              </div>
              {summary && <p aria-live={streaming && unfinished ? "polite" : undefined} className="mt-1 whitespace-pre-wrap opacity-80">{summary}</p>}
            </div>;
          })}
          {progress && <p className="text-[11px] opacity-65">最新进度 · {progress.detail || progress.title}</p>}
        </div>
      )}
    </section>
  );
}
