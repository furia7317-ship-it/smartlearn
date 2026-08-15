"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { SquareTerminal } from "lucide-react";

import { AgentIconTile, AGENT_ICONS, StatusIcon } from "@/components/agent-bits";
import { Progress } from "@/components/ui/progress";
import { AGENT_MAP, WORKER_IDS } from "@/lib/agents";
import {
  PHASE_LABEL,
  type AgentId,
  type AgentRuntime,
  type LogLine,
  type Phase,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/* ── 管线节点 ─────────────────────────────────── */

function StageRow({ id, rt }: { id: AgentId; rt: AgentRuntime }) {
  const meta = AGENT_MAP[id];
  const active = rt.status === "working" || rt.status === "rework";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2 transition-all duration-300",
        active && "agent-working border-primary/50",
        rt.status === "done" && "border-success/30"
      )}
    >
      <AgentIconTile id={id} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-tight">{meta.name}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {active && rt.detail ? rt.detail : meta.duty}
        </div>
      </div>
      <StatusIcon status={rt.status} />
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-px">
      <svg width="2" height="14" aria-hidden>
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="14"
          stroke={active ? "var(--primary)" : "var(--border)"}
          strokeWidth="2"
          className={active ? "edge-flowing" : undefined}
        />
      </svg>
    </div>
  );
}

function WorkerCell({ id, rt }: { id: AgentId; rt: AgentRuntime }) {
  const meta = AGENT_MAP[id];
  const Icon = AGENT_ICONS[id];
  const working = rt.status === "working" || rt.status === "rework";
  const skipped = rt.status === "skipped";
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-2 py-1.5 transition-all duration-300",
        working && "border-primary/50 shadow-sm",
        rt.status === "rework" && "border-warning/60",
        rt.status === "done" && "border-success/30",
        skipped && "border-dashed opacity-55"
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className="size-3.5 shrink-0"
          style={{ color: skipped ? "var(--muted-foreground)" : meta.color }}
        />
        <span className="truncate text-[11px] font-medium">{meta.name}</span>
        <span className="ml-auto shrink-0">
          <StatusIcon status={rt.status} className="size-3" />
        </span>
      </div>
      {skipped ? (
        <div className="mt-1.5 text-[10px] leading-none text-muted-foreground">
          分诊未选用
        </div>
      ) : (
        <Progress
          value={rt.progress}
          className="mt-1.5 h-1"
          indicatorClassName={cn(
            working && "progress-shimmer",
            rt.status === "rework" && "bg-warning"
          )}
        />
      )}
    </div>
  );
}

/* ── 事件流终端 ───────────────────────────────── */

function LogTerminal({ logs, running }: { logs: LogLine[]; running: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="flex h-[218px] shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-1.5 border-b border-zinc-800/80 px-3 py-1.5">
        <SquareTerminal className="size-3.5 text-zinc-500" />
        <span className="text-[11px] font-medium text-zinc-400">
          协同事件流 · SSE
        </span>
        {running && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-success">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            LIVE
          </span>
        )}
      </div>
      <div
        ref={boxRef}
        className="thin-scroll flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.7]"
      >
        {logs.length === 0 ? (
          <div className="pt-2 text-zinc-600">
            $ 等待任务下发… 与我对话即可唤醒智能体团队
          </div>
        ) : (
          logs.map((l) => (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className="flex gap-1.5"
            >
              <span className="shrink-0 text-zinc-600">[{l.ts}]</span>
              <span
                className="shrink-0 font-medium"
                style={{ color: AGENT_MAP[l.agent].color }}
              >
                {AGENT_MAP[l.agent].name}
              </span>
              <span
                className={cn(
                  "break-all",
                  l.level === "ok" && "text-success",
                  l.level === "warn" && "text-warning",
                  l.level === "info" && "text-zinc-300"
                )}
              >
                {l.text}
              </span>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── 面板主体 ─────────────────────────────────── */

export function AgentPanel({
  agents,
  logs,
  phase,
  running,
}: {
  agents: Record<AgentId, AgentRuntime>;
  logs: LogLine[];
  phase: Phase;
  running: boolean;
}) {
  const workerIds = [...WORKER_IDS, "courseware" as const];
  const doneCount = workerIds.filter((worker) => agents[worker].status === "done").length;
  const generating = workerIds.some(
    (w) => agents[w].status === "working" || agents[w].status === "rework"
  );
  const participantCount = Object.values(agents).filter(
    (agent) => agent.status !== "idle" && agent.status !== "skipped",
  ).length;

  return (
    <div className="thin-scroll flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3 pt-2">
      {/* 状态条 */}
      <div className="flex shrink-0 items-center gap-2 rounded-xl border bg-card px-3 py-2">
        <span
          className={cn(
            "size-2 rounded-full",
            running ? "bg-danger" : "bg-success"
          )}
        />
        <span className="text-xs font-medium">{PHASE_LABEL[phase]}</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          本轮活动 {participantCount}
        </span>
      </div>

      {/* 协同管线 */}
      <div className="shrink-0">
        <StageRow id="profiler" rt={agents.profiler} />
        <Connector active={agents.profiler.status === "working"} />
        <StageRow id="outliner" rt={agents.outliner} />
        <Connector active={agents.outliner.status === "working"} />
        <StageRow id="supervisor" rt={agents.supervisor} />
        <Connector active={agents.supervisor.status === "working" || generating} />

        <div
          className={cn(
            "rounded-xl border border-dashed p-2 transition-colors",
            generating
              ? "border-primary/40 bg-primary/[0.04]"
              : "border-border bg-muted/30"
          )}
        >
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              并行生成区 · LangGraph 扇出
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {doneCount}/{workerIds.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {workerIds.map((w) => (
              <WorkerCell key={w} id={w} rt={agents[w]} />
            ))}
          </div>
        </div>

        <Connector active={agents.reviewer.status === "working"} />
        <StageRow id="reviewer" rt={agents.reviewer} />
        <Connector active={agents.integrator.status === "working"} />
        <StageRow id="integrator" rt={agents.integrator} />
        <Connector active={agents.planner.status === "working"} />
        <StageRow id="planner" rt={agents.planner} />
        <Connector active={agents.tutor.status === "working"} />
        <StageRow id="tutor" rt={agents.tutor} />
      </div>

      {/* 事件流 */}
      <LogTerminal logs={logs} running={running} />
    </div>
  );
}
