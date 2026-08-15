"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Braces,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  TerminalSquare,
} from "lucide-react";

import type { CodeTraceStep, CodeVisualizationResponse } from "@/lib/code-lab";
import { cn } from "@/lib/utils";

function displayValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const POINTER_NAMES = new Set([
  "i",
  "j",
  "k",
  "index",
  "left",
  "right",
  "low",
  "high",
  "mid",
  "min_idx",
  "max_idx",
]);

const BAR_TONES = [
  "border-cyan-800/50 bg-cyan-500 text-cyan-950",
  "border-emerald-800/50 bg-emerald-500 text-emerald-950",
  "border-sky-800/50 bg-sky-500 text-sky-950",
  "border-rose-800/50 bg-rose-500 text-white",
  "border-amber-800/50 bg-amber-400 text-amber-950",
  "border-lime-800/50 bg-lime-500 text-lime-950",
  "border-indigo-800/50 bg-indigo-500 text-white",
] as const;

const POINTER_TONES: Record<string, { label: string; strip: string }> = {
  i: { label: "border-cyan-600 bg-cyan-50 text-cyan-900", strip: "bg-cyan-600" },
  j: { label: "border-rose-600 bg-rose-50 text-rose-900", strip: "bg-rose-600" },
  k: { label: "border-indigo-600 bg-indigo-50 text-indigo-900", strip: "bg-indigo-600" },
  left: { label: "border-emerald-600 bg-emerald-50 text-emerald-900", strip: "bg-emerald-600" },
  low: { label: "border-emerald-600 bg-emerald-50 text-emerald-900", strip: "bg-emerald-600" },
  right: { label: "border-orange-600 bg-orange-50 text-orange-900", strip: "bg-orange-600" },
  high: { label: "border-orange-600 bg-orange-50 text-orange-900", strip: "bg-orange-600" },
  mid: { label: "border-blue-600 bg-blue-50 text-blue-900", strip: "bg-blue-600" },
  min_idx: { label: "border-fuchsia-600 bg-fuchsia-50 text-fuchsia-900", strip: "bg-fuchsia-600" },
  max_idx: { label: "border-lime-700 bg-lime-50 text-lime-950", strip: "bg-lime-600" },
  index: { label: "border-teal-600 bg-teal-50 text-teal-900", strip: "bg-teal-600" },
};

function stableToneIndex(value: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % length;
}

function pointerTone(name: string) {
  return POINTER_TONES[name] ?? {
    label: "border-zinc-500 bg-zinc-50 text-zinc-900",
    strip: "bg-zinc-600",
  };
}

const SORT_ALGORITHM_LABELS: Record<string, string> = {
  bubble_sort: "冒泡排序",
  selection_sort: "选择排序",
  insertion_sort: "插入排序",
  quick_sort: "快速排序",
  merge_sort: "归并排序",
  heap_sort: "堆排序",
};

function stripPythonComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "#") return line.slice(0, index).trimEnd();
  }

  return line.trimEnd();
}

function traceStepExplanation(step: CodeTraceStep): string {
  if (step.event === "call") {
    return `进入 ${step.function}，建立新的调用栈帧。`;
  }
  if (step.event === "return") {
    return `${step.function} 执行结束，返回上一层调用。`;
  }
  if (step.event === "exception") {
    return `第 ${step.line} 行抛出异常，执行在这里停止。`;
  }

  const descriptions = step.changes.map((change) => {
    if (Array.isArray(change.before) && Array.isArray(change.after)) {
      const before = change.before;
      const after = change.after;
      const indexes = after.flatMap((value, index) => (
        displayValue(value) !== displayValue(before[index]) ? [index] : []
      ));
      if (indexes.length >= 2) {
        return `数组 ${change.name} 在下标 ${indexes.join("、")} 完成位置交换`;
      }
      if (indexes.length === 1) {
        const index = indexes[0];
        return `数组 ${change.name} 的下标 ${index} 更新为 ${displayValue(after[index])}`;
      }
    }
    return `变量 ${change.name} 从 ${displayValue(change.before)} 更新为 ${displayValue(change.after)}`;
  });

  if (descriptions.length > 0) return `${descriptions.join("；")}。`;
  if (step.stdout_delta) return `这一行产生输出：${step.stdout_delta.trim()}`;
  return `执行第 ${step.line} 行，程序状态保持不变。`;
}

function ArrayDiagram({
  name,
  values,
  variables,
  before,
}: {
  name: string;
  values: unknown[];
  variables: Record<string, unknown>;
  before: unknown;
}) {
  const numeric = values.every((value) => typeof value === "number" && Number.isFinite(value));
  const previous = Array.isArray(before) ? before : null;
  const changed = new Set(
    previous ? values.flatMap((value, index) => (
      displayValue(value) !== displayValue(previous[index]) ? [index] : []
    )) : [],
  );
  const pointers = new Map<number, string[]>();
  for (const [pointerName, pointerValue] of Object.entries(variables)) {
    if (
      POINTER_NAMES.has(pointerName)
      && typeof pointerValue === "number"
      && Number.isInteger(pointerValue)
      && pointerValue >= 0
      && pointerValue < values.length
    ) {
      pointers.set(pointerValue, [...(pointers.get(pointerValue) ?? []), pointerName]);
    }
  }
  const operation = changed.size >= 2 ? "位置交换" : changed.size === 1 ? "数值更新" : "读取状态";

  if (!numeric) {
    return (
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-1.5 py-2">
          {values.map((value, index) => (
            <div key={`${name}:${index}`} className="flex items-center gap-1.5">
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "min-w-12 border px-2 py-2 text-center font-mono text-[10px]",
                  changed.has(index) ? "border-amber-500 bg-amber-50" : "border-teal-700/30 bg-teal-50",
                )}
              >
                {displayValue(value)}
              </motion.div>
              {index < values.length - 1 && <ArrowRight className="size-3 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const numbers = values as number[];
  const maxMagnitude = Math.max(1, ...numbers.map((value) => Math.abs(value)));
  const slotWidth = 56;
  const canvasWidth = Math.max(280, values.length * slotWidth);
  const offset = Math.max(0, (canvasWidth - values.length * slotWidth) / 2);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground/75">{name}</span>
        <span>{operation} · {values.length} 项</span>
      </div>
      <div className="relative h-[178px]" style={{ width: canvasWidth }}>
        {values.map((_, index) => {
          const labels = pointers.get(index) ?? [];
          return (
            <div
              key={`${name}:pointer:${index}`}
              className="absolute top-0 flex h-9 w-12 flex-wrap content-start justify-center gap-0.5"
              style={{ left: offset + index * slotWidth }}
            >
              <AnimatePresence mode="popLayout">
                {labels.slice(0, 3).map((label) => (
                  <motion.span
                    key={label}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 5 }}
                    className={cn(
                      "border-b-2 px-1 font-mono text-[9px] font-bold",
                      pointerTone(label).label,
                    )}
                  >
                    {label}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          );
        })}
        <div className="absolute inset-x-0 bottom-6 h-px bg-border" />
        {values.map((value, index) => {
            const number = value as number;
            const height = 24 + Math.round((Math.abs(number) / maxMagnitude) * 92);
            const pointerLabels = pointers.get(index) ?? [];
            const serialized = displayValue(value);
            const barTone = BAR_TONES[stableToneIndex(serialized, BAR_TONES.length)];
            return (
              <motion.div
                key={`${name}:slot:${index}`}
                initial={{ opacity: 0, scaleY: 0.25 }}
                animate={{
                  height,
                  opacity: 1,
                  scaleY: 1,
                }}
                transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.7 }}
                className={cn(
                  "absolute bottom-7 flex w-11 origin-bottom items-start justify-center border pt-2 font-mono text-[10px] font-bold shadow-sm",
                  barTone,
                  changed.has(index) && "ring-2 ring-amber-400 ring-offset-1 ring-offset-background",
                  number < 0 && "border-b-4 border-b-rose-950",
                )}
                style={{ left: offset + index * slotWidth }}
                title={`${name}[${index}] = ${number}`}
              >
                {pointerLabels.length > 0 && (
                  <span className="absolute inset-x-0 top-0 flex h-1" aria-hidden="true">
                    {pointerLabels.slice(0, 3).map((label) => (
                      <span key={label} className={cn("h-full flex-1", pointerTone(label).strip)} />
                    ))}
                  </span>
                )}
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={serialized}
                    initial={{ opacity: 0, y: -7 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 7 }}
                    className="max-w-10 truncate px-0.5"
                  >
                    {number}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            );
          })}
        {values.map((_, index) => (
          <span
            key={`${name}:index:${index}`}
            className="absolute bottom-0 w-11 text-center font-mono text-[9px] text-muted-foreground"
            style={{ left: offset + index * slotWidth }}
          >
            [{index}]
          </span>
        ))}
      </div>
    </div>
  );
}

function ScalarDashboard({
  values,
  arrayLength,
}: {
  values: [string, unknown][];
  arrayLength: number;
}) {
  const numericValues = values
    .map(([, value]) => typeof value === "number" ? Math.abs(value) : 0);
  const numericMax = Math.max(1, arrayLength - 1, ...numericValues);

  return (
    <div className="space-y-2">
      {values.length ? values.map(([name, value]) => {
        if (typeof value === "boolean") {
          return (
            <motion.div layout key={name} className="flex items-center justify-between gap-3 border-b pb-2 text-[10.5px] last:border-b-0">
              <span className="font-mono text-foreground/70">{name}</span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className={cn("relative h-4 w-7 rounded-full", value ? "bg-emerald-500" : "bg-muted-foreground/30")}>
                  <motion.span
                    animate={{ x: value ? 13 : 2 }}
                    className="absolute top-0.5 size-3 rounded-full bg-white shadow"
                  />
                </span>
                {value ? "true" : "false"}
              </span>
            </motion.div>
          );
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          const pointer = POINTER_NAMES.has(name);
          const denominator = pointer && arrayLength > 1 ? arrayLength - 1 : numericMax;
          const percentage = Math.min(100, Math.max(0, (Math.abs(value) / Math.max(1, denominator)) * 100));
          return (
            <motion.div layout key={name} className="border-b pb-2 last:border-b-0">
              <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10.5px]">
                <span className="text-foreground/70">{name}</span>
                <motion.span key={`${name}:${value}`} initial={{ scale: 1.25, color: "#b45309" }} animate={{ scale: 1, color: "#18181b" }} className="font-bold">
                  {value}
                </motion.span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  animate={{ width: `${percentage}%` }}
                  transition={{ type: "spring", stiffness: 220, damping: 25 }}
                  className={cn("h-full", pointer ? "bg-amber-500" : "bg-cyan-600")}
                />
              </div>
            </motion.div>
          );
        }
        return (
          <motion.div layout key={name} className="flex items-baseline justify-between gap-2 border-b pb-2 font-mono text-[10.5px] last:border-b-0">
            <span className="truncate text-foreground/70">{name}</span>
            <span className="max-w-[65%] truncate font-semibold">{displayValue(value)}</span>
          </motion.div>
        );
      }) : <p className="text-[11px] text-muted-foreground">暂无变量</p>}
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md border bg-background text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function CodeExecutionVisualizer({
  code,
  result,
}: {
  code: string;
  result: CodeVisualizationResponse;
}) {
  const trace = result.execution.trace;
  const [traceIndex, setTraceIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [intervalMs, setIntervalMs] = useState(900);
  const codeViewportRef = useRef<HTMLDivElement>(null);
  const current = trace[Math.min(traceIndex, Math.max(0, trace.length - 1))];
  const currentLine = current?.line;
  const lines = useMemo(() => code.split(/\r?\n/), [code]);
  const displayLines = useMemo(
    () => lines
      .map((line, index) => ({ code: stripPythonComment(line), lineNumber: index + 1 }))
      .filter((line) => line.code.trim().length > 0),
    [lines],
  );
  const exactPlanStep = useMemo(
    () => result.plan.steps.find((step) => step.trace_index === traceIndex),
    [result.plan.steps, traceIndex],
  );
  const algorithmTracks = useMemo(() => {
    const seen = new Set<string>();
    return trace.flatMap((step, index) => {
      const frame = [...step.stack]
        .reverse()
        .find((candidate) => SORT_ALGORITHM_LABELS[candidate.function]);
      if (!frame || seen.has(frame.function)) return [];
      seen.add(frame.function);
      return [{ functionName: frame.function, label: SORT_ALGORITHM_LABELS[frame.function], startIndex: index }];
    });
  }, [trace]);
  const activeAlgorithm = useMemo(() => {
    const stackFrame = [...(current?.stack ?? [])]
      .reverse()
      .find((frame) => SORT_ALGORITHM_LABELS[frame.function]);
    if (stackFrame) {
      return algorithmTracks.find((track) => track.functionName === stackFrame.function) ?? null;
    }
    return [...algorithmTracks].reverse().find((track) => track.startIndex <= traceIndex) ?? null;
  }, [algorithmTracks, current?.stack, traceIndex]);

  useEffect(() => {
    if (!playing) return;
    if (traceIndex >= trace.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setTraceIndex((value) => Math.min(trace.length - 1, value + 1)),
      intervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [intervalMs, playing, trace.length, traceIndex]);

  useEffect(() => {
    const viewport = codeViewportRef.current;
    if (!viewport || !currentLine) return;
    const activeLine = viewport.querySelector<HTMLElement>(`[data-code-line="${currentLine}"]`);
    if (!activeLine) return;
    const frame = window.requestAnimationFrame(() => {
      const viewportRect = viewport.getBoundingClientRect();
      const activeRect = activeLine.getBoundingClientRect();
      const lineTop = activeRect.top - viewportRect.top + viewport.scrollTop;
      const top = Math.max(0, lineTop - (viewport.clientHeight - activeLine.offsetHeight) / 2);
      viewport.scrollTo({
        top,
        behavior: playing ? "smooth" : "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentLine, playing, traceIndex]);

  const arrays = Object.entries(current?.variables ?? {}).filter(([, value]) => Array.isArray(value));
  const scalars = Object.entries(current?.variables ?? {}).filter(([, value]) => !Array.isArray(value));
  const largestArrayLength = Math.max(0, ...arrays.map(([, value]) => (value as unknown[]).length));
  const maxIndex = Math.max(0, trace.length - 1);
  const tracedExplanation = current ? traceStepExplanation(current) : "";
  const currentExplanation = current && (
    current.changes.length > 0
    || Boolean(current.stdout_delta)
    || current.event !== "line"
  )
    ? tracedExplanation
    : exactPlanStep?.explanation ?? tracedExplanation;

  return (
    <section className="overflow-hidden rounded-lg border bg-background" aria-label="代码运行过程">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-primary" />
            <h3 className="text-[13px] font-semibold">真实执行轨迹</h3>
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              result.ai_status === "completed"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900",
            )}>
              {result.ai_status === "completed" ? "AI 已编排" : "基础讲解"}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{result.plan.overview}</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="重新开始" onClick={() => { setTraceIndex(0); setPlaying(false); }}>
            <RotateCcw className="size-3.5" />
          </IconButton>
          <IconButton label="第一步" disabled={traceIndex <= 0} onClick={() => setTraceIndex(0)}>
            <ChevronFirst className="size-3.5" />
          </IconButton>
          <IconButton label="上一步" disabled={traceIndex <= 0} onClick={() => setTraceIndex((value) => Math.max(0, value - 1))}>
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <button
            type="button"
            title={playing ? "暂停" : "播放"}
            aria-label={playing ? "暂停" : "播放"}
            disabled={trace.length < 2}
            onClick={() => {
              if (traceIndex >= maxIndex) setTraceIndex(0);
              setPlaying((value) => !value);
            }}
            className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <IconButton label="下一步" disabled={traceIndex >= maxIndex} onClick={() => setTraceIndex((value) => Math.min(maxIndex, value + 1))}>
            <ChevronRight className="size-3.5" />
          </IconButton>
          <IconButton label="最后一步" disabled={traceIndex >= maxIndex} onClick={() => setTraceIndex(maxIndex)}>
            <ChevronLast className="size-3.5" />
          </IconButton>
          <label className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            速度
            <select
              value={intervalMs}
              onChange={(event) => setIntervalMs(Number(event.target.value))}
              className="h-8 rounded-md border bg-background px-1.5 text-[11px] text-foreground outline-none"
            >
              <option value={1400}>慢</option>
              <option value={900}>正常</option>
              <option value={480}>快</option>
            </select>
          </label>
        </div>
      </header>

      {current ? (
        <div className="grid grid-cols-1 lg:h-[min(72vh,720px)] lg:min-h-[520px] lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,0.95fr)]">
          <div className="min-w-0 border-b bg-zinc-950 py-2 text-zinc-100 lg:h-full lg:min-h-0 lg:border-b-0 lg:border-r">
            <div ref={codeViewportRef} className="thin-scroll max-h-[360px] overflow-auto font-mono text-[12px] leading-6 lg:h-full lg:max-h-none">
              {displayLines.map(({ code: displayLine, lineNumber }) => {
                const active = lineNumber === current.line;
                return (
                  <div
                    key={lineNumber}
                    data-code-line={lineNumber}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "grid min-h-6 grid-cols-[16px_38px_minmax(0,1fr)] border-l-2 border-transparent px-2",
                      active && "border-amber-400 bg-amber-300/15",
                    )}
                  >
                    <span className="grid place-items-center text-amber-300">
                      {active && (
                        <motion.span
                          key={`tracker:${traceIndex}`}
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          aria-label="当前执行行"
                        >
                          <Play className="size-2.5 fill-current" />
                        </motion.span>
                      )}
                    </span>
                    <span className={cn("select-none pr-3 text-right text-zinc-500", active && "text-amber-300")}>{lineNumber}</span>
                    <code className="whitespace-pre">{displayLine}</code>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="thin-scroll min-w-0 overflow-y-auto p-3 lg:h-full lg:min-h-0">
            {algorithmTracks.length > 1 && (
              <div className="mb-3" role="tablist" aria-label="排序算法轨迹">
                <div className="mb-1.5 text-[10px] font-semibold text-muted-foreground">排序算法轨迹</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {algorithmTracks.map((track) => {
                    const active = activeAlgorithm?.functionName === track.functionName;
                    return (
                      <button
                        key={track.functionName}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setPlaying(false);
                          setTraceIndex(track.startIndex);
                        }}
                        className={cn(
                          "min-h-8 border px-2 py-1 text-[10.5px] font-medium transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-muted/25 text-foreground hover:bg-muted",
                        )}
                      >
                        {track.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <motion.div
              key={`${traceIndex}:${current.line}`}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="border-l-2 border-primary pl-3"
            >
              <div className="text-[11px] font-semibold text-primary">第 {current.line} 行</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">
                {currentExplanation}
              </p>
            </motion.div>

            {arrays.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Activity className="size-3.5" /> 数据变化画布
                </div>
                {arrays.map(([name, value]) => (
                  <ArrayDiagram
                    key={name}
                    name={activeAlgorithm ? `${activeAlgorithm.label} · ${name}` : name}
                    values={value as unknown[]}
                    variables={current.variables}
                    before={current.changes.find((change) => change.name === name)?.before}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Layers3 className="size-3.5" /> 运行指标
                </div>
                <ScalarDashboard values={scalars} arrayLength={largestArrayLength} />
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Layers3 className="size-3.5" /> 调用栈
                </div>
                <div className="relative min-h-10 border-l-2 border-cyan-700/25 pl-2">
                  <AnimatePresence initial={false} mode="popLayout">
                    {current.stack.map((frame, index) => (
                      <motion.div
                        layout
                        key={`${frame.function}:${index}`}
                        initial={{ opacity: 0, x: 14, scale: 0.94 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 14, scale: 0.94 }}
                        transition={{ type: "spring", stiffness: 260, damping: 25 }}
                        className="relative mb-1.5 border bg-muted/25 px-2 py-1.5 text-[10.5px] last:mb-0"
                      >
                        <span className="absolute -left-[13px] top-2 size-2 rounded-full border-2 border-background bg-cyan-600" />
                        <span className="block truncate font-mono font-semibold">{frame.function}</span>
                        <span className="text-muted-foreground">当前第 {frame.line} 行</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {current.stack.length === 0 && (
                    <p className="pl-1 text-[10.5px] text-muted-foreground">栈已清空</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <TerminalSquare className="size-3.5" /> 输出
              </div>
              <pre className="min-h-14 whitespace-pre-wrap rounded-md bg-zinc-900 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-100">
                {current.stdout || "等待程序输出..."}
              </pre>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-4 py-8 text-sm text-muted-foreground">
          {result.execution.error
            ? `${result.execution.error.type}：${result.execution.error.message}`
            : "执行器没有返回可播放步骤。"}
        </div>
      )}

      <footer className="flex items-center gap-3 border-t bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground">
        <span className="shrink-0">{trace.length ? `${traceIndex + 1} / ${trace.length}` : "0 / 0"}</span>
        {result.execution.trace_truncated && (
          <span className="shrink-0 text-amber-700">中间轨迹已压缩</span>
        )}
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${trace.length ? ((traceIndex + 1) / trace.length) * 100 : 0}%` }}
          />
        </div>
        <span className="shrink-0">{result.execution.execution_time_ms.toFixed(1)} ms</span>
      </footer>
    </section>
  );
}
