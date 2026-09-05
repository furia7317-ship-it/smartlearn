"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import NextLink from "next/link";
import { ShellLink as Link } from "@/components/shell-link";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  LocateFixed,
  Plus,
  Route,
  Sparkles,
  Target,
  Trash2,
  X,
  BookOpenCheck,
  Bell,
  CalendarClock,
  Mail,
  Pause,
  PlayCircle,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { AGENT_ICONS } from "@/components/agent-bits";
import { DesktopEmptyState } from "@/components/desktop/desktop-empty-state";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { AGENT_MAP } from "@/lib/agents";
import {
  buildDailyTaskPlan,
  buildPathDashboardPlan,
  getDailyTaskResourceAction,
  type DailyTaskItem,
  type DailyTaskPlan,
  type DailyTaskResource,
  type PathDashboardPlan,
  type PathStageSummary,
} from "@/lib/daily-task-plan";
import {
  assessmentToContext,
  deleteGoal,
  listAssessments,
  listGoals,
  saveGoal,
  type AssessmentRecord,
  type GoalRecord,
} from "@/lib/library";
import { resolveResourceForTaskTarget } from "@/lib/path-resource-links";
import {
  buildKnowledgePathGraph,
  KNOWLEDGE_NODE_HEIGHT,
  KNOWLEDGE_NODE_WIDTH,
  type KnowledgeGraphNode,
  type KnowledgePathGraph,
} from "@/lib/knowledge-path-graph";
import {
  clampKnowledgePathZoom,
  knowledgePathPanForZoomAnchor,
} from "@/lib/knowledge-path-viewport";
import {
  defaultActivationDate,
  type SubjectLearningPath,
} from "@/lib/master-learning-path";
import {
  emptyLearningPathWorkspaceSummary,
  getLearningPathWorkspaceSummary,
  type LearningPathWorkspaceSummary,
} from "@/lib/learning-path-api";
import { reflectionHref } from "@/lib/reflection";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import type { PathStep, ResourceItem } from "@/lib/types";
import { getDesktopViewSwap } from "@/lib/web-motion";
import { cn } from "@/lib/utils";
import styles from "./desktop-path.module.css";

const LearningBaselineGate = dynamic(
  () => import("@/components/learning-baseline-gate").then((module) => module.LearningBaselineGate),
  { ssr: false },
);

const ResourceViewer = dynamic(
  () => import("@/components/resource-viewer").then((module) => module.ResourceViewer),
  { ssr: false },
);

/**
 * 桌面专属「学习路径」——完全独立于 web 的 /path：自己的布局、自己的 StepCard/GoalsSection
 * 与桌面叶子组件，不用 web-route-frame。共用数据层（useOrchestratorContext / lib），改它不碰 web。
 */

const today = () => new Date().toISOString().slice(0, 10);

function typeName(t: DailyTaskResource["type"]): string {
  return AGENT_MAP[t]?.name.replace(/官|师|教练|导演/g, "") ?? t;
}

function TaskEvidenceForm({
  task,
  onSubmit,
}: {
  task: DailyTaskItem;
  onSubmit: (key: string, content: string) => void;
}) {
  const [content, setContent] = useState("");
  const prompts = task.prompts.length > 0
    ? task.prompts
    : task.action.includes("复盘")
      ? ["今天最容易出错的地方是什么？", "给明天的自己留下一个必须解决的问题。"]
      : ["不看资料，用自己的话复述今天的核心概念。", "写一个具体例子说明你会怎么应用它。"];

  if (task.completed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
        <CheckCircle2 className="size-3.5" /> 已根据学习产出记录完成
      </span>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-dashed bg-surface-2/45 p-3">
      <ol className="space-y-1 text-xs leading-relaxed text-foreground/85">
        {prompts.map((prompt, index) => (
          <li key={`${task.key}-prompt-${index}`}>
            <span className="mr-1 font-mono text-primary">Q{index + 1}</span>{prompt}
          </li>
        ))}
      </ol>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        placeholder="写下你的答案或复盘；提交后才会计入完成进度"
        className="mt-2 w-full resize-y rounded-md border bg-card px-3 py-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <button
        type="button"
        disabled={content.trim().length < 6}
        onClick={() => onSubmit(task.key, content)}
        className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        提交学习产出
      </button>
    </div>
  );
}

function TaskRow({
  task,
  day,
  pathId,
  resources,
  onRecordEvidence,
  onOpenResource,
}: {
  task: DailyTaskItem;
  day: string;
  pathId: string;
  resources: ResourceItem[];
  onRecordEvidence: (key: string, content: string) => void;
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const isReviewTask = task.kind === "review" || task.action.includes("复盘");
  const resolvedTargets = task.resourceTargets.map((target) => ({
    target,
    resource: resolveResourceForTaskTarget(target, task, resources),
  }));
  const hasReadyTarget = resolvedTargets.some((entry) => Boolean(entry.resource));
  const missingExactTarget = resolvedTargets.some(
    (entry) => Boolean(entry.target.id) && !entry.resource,
  );
  const needsWrittenEvidence =
    !isReviewTask &&
    (task.completionKind === "written_response" ||
      (!hasReadyTarget &&
        (task.action.includes("练习") || task.action.includes("复盘"))));

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3.5 transition-colors",
        task.completed && "border-success/30 bg-success/10"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-label={task.completed ? "已由学习行为完成" : "等待真实学习行为"}
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
            task.completed ? "text-success" : "text-muted-foreground"
          )}
        >
          {task.completed ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
              {task.action}
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold">
              {task.title}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {task.minutes} 分钟
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {task.detail}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {resolvedTargets.map(({ target, resource: taskResource }) => {
                const action = getDailyTaskResourceAction(target.type);
                if (taskResource) {
                  return (
                    <button
                      key={`${task.key}-${target.key}`}
                      type="button"
                      onClick={() => onOpenResource(taskResource, task.key)}
                      className="rounded-md border bg-card px-2 py-1 text-xs font-medium text-primary hover:bg-accent"
                    >
                      {action.label}
                    </button>
                  );
                }
                return null;
              })}
            {missingExactTarget && !hasReadyTarget && (
              <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                资料审核完成后自动出现
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              完成标准：{task.standard}
            </span>
            {task.resourceTypes.map((t) => {
              const Icon = AGENT_ICONS[t];
              return (
                <span
                  key={`${task.key}-${t}`}
                  className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  <Icon className="size-3" style={{ color: AGENT_MAP[t].color }} />
                  {typeName(t)}
                </span>
              );
            })}
          </div>
          {needsWrittenEvidence && (
            <TaskEvidenceForm task={task} onSubmit={onRecordEvidence} />
          )}
          {isReviewTask && (
            <Link
              href={reflectionHref(day, task.key, pathId)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <BookOpenCheck className="size-3.5" />
              {task.completed ? "再次查看复盘工作台" : "进入复盘工作台"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function TodayActionPanel({
  step,
  pathId,
  index,
  total,
  plan,
  resources,
  onRecordEvidence,
  onOpenResource,
}: {
  step: PathStep;
  pathId: string;
  index: number;
  total: number;
  plan: DailyTaskPlan;
  resources: ResourceItem[];
  onRecordEvidence: (key: string, content: string) => void;
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const progressRatio = plan.taskCount > 0 ? plan.completedTaskCount / plan.taskCount : 0;
  const firstActionHref = plan.tasks[0]?.href ?? "/path/study";

  return (
    <section className="rounded-2xl border border-primary/40 bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-danger px-2.5 py-1 font-mono text-xs font-semibold text-white">
              {step.day} 今天
            </span>
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              阶段 {index + 1}/{total}
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-danger">
              <span className="size-1.5 rounded-full bg-danger" />
              进行中
            </span>
          </div>
          <h2 className="mt-3 text-[19px] font-semibold tracking-tight">{step.title}</h2>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {step.desc}
          </p>
        </div>
        <Link
          href={firstActionHref}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          开始今天任务
          <ArrowUpRight className="size-4" />
        </Link>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border bg-surface-2/35 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">预计时长</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{plan.totalMinutes} 分钟</div>
        </div>
        <div className="rounded-lg border bg-surface-2/35 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">今日任务</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{plan.taskCount} 个任务</div>
        </div>
        <div className="rounded-lg border bg-surface-2/35 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">相关资料</div>
          <div className="mt-0.5 font-mono text-sm font-semibold">{plan.resourceCount} 份资料</div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-surface-2/35 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">今日进度</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {plan.progressLabel} 完成
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${Math.round(progressRatio * 100)}%` }}
          />
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {plan.tasks.map((task) => (
          <TaskRow
            key={task.key}
            task={task}
            day={step.day}
            pathId={pathId}
            resources={resources}
            onRecordEvidence={onRecordEvidence}
            onOpenResource={onOpenResource}
          />
        ))}
      </div>
    </section>
  );
}

export function GoalsSection({
  mode,
  onChanged,
}: {
  mode: OrchestratorMode;
  onChanged?: () => void;
}) {
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const refresh = useCallback(() => {
    if (mode === "checking") return;
    listGoals(mode).then(setGoals).catch(() => setGoals([]));
  }, [mode]);

  useEffect(() => {
    refresh();
    if (mode !== "checking") listAssessments(mode).then(setAssessments).catch(() => setAssessments([]));
  }, [mode, refresh]);

  const reset = () => {
    setTitle("");
    setStatus("");
    setStart("");
    setEnd("");
  };

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    await saveGoal(mode, {
      title: title.trim(),
      description: status.trim(),
      start_date: start || today(),
      target_date: end || null,
    });
    setSaving(false);
    reset();
    setOpen(false);
    refresh();
    onChanged?.();
  };

  const remove = async (id: string | number) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await deleteGoal(mode, id);
    onChanged?.();
  };

  const importAssessment = (id: string) => {
    const rec = assessments.find((a) => a.id === id);
    if (!rec) return;
    const ctx = assessmentToContext(rec);
    setStatus((prev) => (prev.trim() ? `${prev.trim()}\n${ctx}` : ctx));
  };

  const inputCls =
    "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-1.5">
        <Target className="size-4 text-primary" />
        <h2 className="text-[15px] font-semibold">学习目标</h2>
        <span className="text-xs text-muted-foreground">{goals.length} 个目标</span>
        <Button
          size="sm"
          variant={open ? "ghost" : "outline"}
          className="ml-auto h-8 gap-1"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {open ? "取消" : "新增目标"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border bg-surface-2/40 p-4">
          <div>
            <label className="text-[13px] font-medium text-muted-foreground">学习目标</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：两周内掌握动态规划，期中拿到 85+"
              className={cn(inputCls, "mt-1")}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-[13px] font-medium text-muted-foreground">当前状态</label>
              {assessments.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) importAssessment(e.target.value);
                    e.target.value = "";
                  }}
                  className="ml-auto h-7 rounded-md border bg-transparent px-1.5 text-xs outline-none"
                  defaultValue=""
                >
                  <option value="" className="bg-card">导入摸底数据…</option>
                  {assessments.map((a) => (
                    <option key={a.id} value={a.id} className="bg-card">
                      {a.subject} · {a.self_level}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <textarea
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="用自然语言描述你目前的掌握情况，或从右上角导入摸底数据"
              rows={3}
              className={cn(inputCls, "mt-1 resize-none")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] font-medium text-muted-foreground">开始日期（选填）</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={cn(inputCls, "mt-1")}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">不填默认今天</p>
            </div>
            <div>
              <label className="text-[13px] font-medium text-muted-foreground">结束日期</label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className={cn(inputCls, "mt-1")}
              />
            </div>
          </div>
          <Button onClick={submit} disabled={!title.trim() || saving} className="w-full gap-1.5">
            <Check className="size-4" />
            {saving ? "保存中…" : "保存目标"}
          </Button>
        </div>
      )}

      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.map((g) => (
            <div key={g.id} className="group rounded-lg border bg-surface-2/40 p-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{g.title}</h3>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[11px]",
                        g.status === "completed"
                          ? "bg-success/15 text-success"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {g.status === "completed" ? "已完成" : "进行中"}
                    </span>
                  </div>
                  {g.description && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                      {g.description}
                    </p>
                  )}
                  {(g.start_date || g.target_date) && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="size-3" />
                      {g.start_date || "今天"} → {g.target_date || "未设结束日期"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => remove(g.id)}
                  aria-label="删除目标"
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !open && (
          <p className="mt-3 rounded-lg border border-dashed px-3 py-5 text-center text-[13px] text-muted-foreground">
            还没有学习目标。点「新增目标」设定一个，可导入摸底数据或自然语言描述当前状态。
          </p>
        )
      )}
    </section>
  );
}

function LearningPathRequestDialog({
  disabled,
  open,
  onClose,
  onSubmit,
}: {
  disabled: boolean;
  open: boolean;
  onClose: () => void;
  onSubmit: (request: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [currentState, setCurrentState] = useState("");
  const [focus, setFocus] = useState("");
  const inputClass = "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35";

  const submit = () => {
    if (!topic.trim() || !goal.trim() || disabled) return;
    const request = [
      "请为我生成一条独立的科目学习路径。生成后保持待启用，由我决定何时加入总学习路径。",
      `学习主题：${topic.trim()}`,
      `学习目标：${goal.trim()}`,
      currentState.trim() ? `当前情况或卡点：${currentState.trim()}` : "",
      focus.trim() ? `希望优先掌握：${focus.trim()}` : "",
    ].filter(Boolean).join("\n");
    onSubmit(request);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="生成或重塑学习路径" onClick={onClose}>
      <section className="w-full max-w-3xl rounded-2xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-[#3a2a18] text-[#fffaf1]"><Sparkles className="size-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">生成科目学习路径</strong><span className="mt-0.5 block text-xs text-muted-foreground">生成后先进入待启用状态，由你决定何时交给总学习路径统筹</span></span>
          <button type="button" onClick={onClose} aria-label="关闭学习路径表单" className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
        </header>

        <div className="px-5 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-[#62513c]">
              学习主题 <span className="text-danger">*</span>
              <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="如：数据结构中的动态规划" className={inputClass} />
            </label>
            <label className="text-xs font-medium text-[#62513c]">
              希望达到的目标 <span className="text-danger">*</span>
              <input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="如：两周后能独立完成中等题" className={inputClass} />
            </label>
            <label className="text-xs font-medium text-[#62513c]">
              当前情况或卡点
              <textarea value={currentState} onChange={(event) => setCurrentState(event.target.value)} rows={3} placeholder="如：会写递归，但不会定义状态和转移方程" className={`${inputClass} resize-none`} />
            </label>
            <label className="text-xs font-medium text-[#62513c]">
              希望优先掌握的内容
              <textarea value={focus} onChange={(event) => setFocus(event.target.value)} rows={3} placeholder="如：先理解状态转移，再集中练习背包问题" className={`${inputClass} resize-none`} />
              <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">下一步会继续确认学情、学习重点和资料类型。</span>
            </label>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={submit} disabled={disabled || !topic.trim() || !goal.trim()} className="gap-1.5">
              <Sparkles className="size-4" />{disabled ? "当前任务运行中" : "继续确认并生成"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubjectDeleteDialog({
  subject,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath | null;
  onClose: () => void;
  onConfirm: (subjectId: string) => void;
}) {
  if (!subject) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`删除${subject.title}学习路径`} onClick={onClose}>
      <section className="w-full max-w-md rounded-xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-danger/10 text-danger"><Trash2 className="size-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">删除科目学习路径</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">{subject.title}</span></span>
          <button type="button" onClick={onClose} aria-label="关闭删除确认" className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">删除后，这条科目路径会立即退出总路径统筹并从路径列表移除。已经生成的讲义、视频和练习仍保留在资源中心。</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button variant="destructive" onClick={() => { onConfirm(subject.id); onClose(); }}>确认删除</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SubjectSupplementDialog({
  subject,
  disabled,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath | null;
  disabled: boolean;
  onClose: () => void;
  onConfirm: (subjectId: string, subjectTitle: string, detail: string) => void;
}) {
  const [detail, setDetail] = useState("");

  useEffect(() => {
    if (subject) setDetail("");
  }, [subject]);

  if (!subject) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`补充${subject.title}学习路径`} onClick={onClose}>
      <section className="w-full max-w-lg rounded-xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-[#3a2a18] text-[#fffaf1]"><Plus className="size-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">补充科目学习路径</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">新增内容会追加到「{subject.title}」，不会创建第二条科目路径</span></span>
          <button type="button" onClick={onClose} aria-label="关闭科目补充" className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <label className="block text-xs font-medium text-[#62513c]">
            需要补充的内容
            <textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={5} placeholder="例如：补充链表反转、双指针方法和两道配套练习" className="mt-1 w-full resize-y rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35" />
          </label>
          <p className="text-xs leading-relaxed text-muted-foreground">原有资源会继续复用；系统只为新增知识点生成必要资料，完成后自动追加到当前科目路径末尾。</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button disabled={disabled || detail.trim().length < 4} onClick={() => { onConfirm(subject.id, subject.title, detail); onClose(); }}>{disabled ? "当前任务运行中" : "继续补充"}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

type PathWorkspaceTab = "overview" | "courses" | "plan";

const PATH_WORKSPACE_TABS: readonly PathWorkspaceTab[] = ["overview", "courses", "plan"];

function subjectStatusLabel(subject: SubjectLearningPath): string {
  if (subject.status === "completed") return "已完成";
  if (subject.status === "active") return "总路径中";
  if (subject.status === "paused") return "已暂停";
  if (subject.status === "scheduled") return "待排入";
  return "未启用";
}

function CourseManagementWorkspace({
  subjects,
  watchedVideoCount,
  onView,
  onActivate,
  onPause,
  onResume,
  onSupplement,
  onDelete,
  onGenerate,
}: {
  subjects: SubjectLearningPath[];
  watchedVideoCount: number;
  onView: (subject: SubjectLearningPath) => void;
  onActivate: (subjectId: string) => void;
  onPause: (subjectId: string) => void;
  onResume: (subjectId: string) => void;
  onSupplement: (subject: SubjectLearningPath) => void;
  onDelete: (subject: SubjectLearningPath) => void;
  onGenerate: () => void;
}) {
  const activeSubjects = subjects.filter((subject) => subject.status === "active");
  const dailyMinutes = activeSubjects.reduce((total, subject) => total + subject.dailyMinutes, 0);
  const nextMilestone = subjects
    .filter((subject) => subject.progress < 100)
    .sort((left, right) => right.progress - left.progress)[0];
  const emptyCourseSlots = Math.max(0, 3 - subjects.length);
  const remainingTasks = nextMilestone
    ? Math.max(0, nextMilestone.totalTasks - nextMilestone.completedTasks)
    : 0;
  const estimatedDays = nextMilestone && nextMilestone.dailyMinutes > 0
    ? Math.max(1, Math.ceil((remainingTasks * 20) / nextMilestone.dailyMinutes))
    : 0;

  return (
    <div className={`thin-scroll ${styles.tabWorkspace}`}>
      <div className={styles.courseWorkspace}>
        <section className={styles.courseListPanel} aria-label="课程列表">
          <header className={styles.coursePanelHeader}>
            <div>
              <span className={styles.coursePanelTitle}><strong>我的课程</strong><i>{subjects.length}</i></span>
              <p>管理与编排你的课程路径，持续精进</p>
            </div>
            {watchedVideoCount > 0 ? (
              <NextLink href="/desktop/video-learning" className={styles.workspaceTextLink}>
                <PlayCircle className="size-4" aria-hidden />视频学习记录 {watchedVideoCount}
              </NextLink>
            ) : null}
          </header>
          {subjects.length === 0 ? (
            <div className={styles.workspaceEmpty}>
              <BookOpen className="size-6" aria-hidden />
              <strong>还没有课程</strong>
              <p>新增一门课程，系统会生成知识节点和对应资料。</p>
              <button type="button" onClick={onGenerate}>新增第一门课程</button>
            </div>
          ) : (
            <div className={styles.courseRows}>
              {subjects.map((subject, index) => (
                <article key={subject.id} className={styles.courseRow}>
                  <button type="button" className={styles.courseArtwork} onClick={() => onView(subject)} aria-label={`查看${subject.title}课程路径`}>
                    <Image src="/brand/path/course-data-structures-v1.webp" alt="" fill sizes="12vw" priority={index === 0} />
                    <span>{index + 1}</span>
                  </button>
                  <button type="button" className={styles.courseMain} onClick={() => onView(subject)}>
                    <span className={styles.courseTitleLine}>
                      <strong>{learningSubjectName(subject.title || subject.requestSummary)}</strong>
                    </span>
                    <span className={styles.courseStatusLine} data-status={subject.status}>
                      <CheckCircle2 className="size-3.5" aria-hidden />{subjectStatusLabel(subject)}
                    </span>
                    <span className={styles.courseProgress} aria-label={`课程进度 ${subject.progress}%`}>
                      <i style={{ width: `${subject.progress}%` }} />
                    </span>
                    <span className={styles.courseProgressValue}>{subject.progress}%</span>
                  </button>
                  <dl className={styles.courseMetrics}>
                    <div><dt><ListChecks className="size-4" aria-hidden />任务节点</dt><dd>{subject.completedTasks}/{subject.totalTasks || 0}</dd></div>
                    <div><dt><Target className="size-4" aria-hidden />知识点</dt><dd>{Math.round(subject.path.length * subject.progress / 100)}/{subject.path.length}</dd></div>
                  </dl>
                  <div className={styles.courseActions}>
                    <button type="button" onClick={() => onView(subject)}><GitBranch className="size-3.5" aria-hidden />查看路径</button>
                    <button type="button" onClick={() => onSupplement(subject)}><BookOpenCheck className="size-3.5" aria-hidden />补充内容</button>
                    {(subject.status === "ready" || subject.status === "scheduled") ? (
                      <button type="button" className={styles.courseActionStrong} onClick={() => onActivate(subject.id)}><Route className="size-3.5" aria-hidden />加入总路径</button>
                    ) : null}
                    {subject.status === "active" ? (
                      <button type="button" onClick={() => onPause(subject.id)}><Pause className="size-3.5" aria-hidden />暂停</button>
                    ) : null}
                    {subject.status === "paused" ? (
                      <button type="button" className={styles.courseActionStrong} onClick={() => onResume(subject.id)}><RotateCcw className="size-3.5" aria-hidden />启用</button>
                    ) : null}
                    <button type="button" className={styles.courseActionDanger} aria-label={`删除${subject.title}`} onClick={() => onDelete(subject)}>
                      <Trash2 className="size-3.5" aria-hidden />删除
                    </button>
                  </div>
                </article>
              ))}
              {Array.from({ length: emptyCourseSlots }, (_, index) => (
                <button key={`empty-course-${index}`} type="button" className={styles.courseEmptySlot} onClick={onGenerate}>
                  <span><Plus className="size-5" aria-hidden /></span>
                  <strong>添加下一门课程</strong>
                  <small>生成新的课程路径后，将在这里统一编排</small>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className={styles.courseSummary} aria-label="课程编排摘要">
          <header className={styles.summaryHeader}><h2>课程编排</h2><span aria-hidden>录</span></header>
          <section className={styles.summaryMeasure}>
            <div><span>进行中课程</span><strong>{activeSubjects.length}</strong><small>门</small></div>
            <BookOpen className="size-12" strokeWidth={1.2} aria-hidden />
          </section>
          <section className={styles.summaryMeasure}>
            <div><span>预计每日学习时长</span><strong>{dailyMinutes || subjects[0]?.dailyMinutes || 0}</strong><small>分钟</small></div>
            <CalendarClock className="size-12" strokeWidth={1.2} aria-hidden />
          </section>
          <section className={styles.summaryMilestone}>
            <span>下一个里程碑</span>
            {nextMilestone ? (
              <>
                <strong>{learningSubjectName(nextMilestone.title || nextMilestone.requestSummary)}</strong>
                <p>完成剩余 {remainingTasks} 个任务节点</p>
                <em>预计 <b>{estimatedDays}</b> 天内完成</em>
              </>
            ) : (
              <p>所有课程都已完成，可以新增课程继续学习。</p>
            )}
          </section>
          <button type="button" className={styles.summaryAddCourse} onClick={onGenerate}>新增课程<Plus className="size-5" aria-hidden /></button>
        </aside>
      </div>
    </div>
  );
}

function LearningPlanWorkspace({
  dashboard,
  path,
  pathId,
  subjects,
  resources,
  summary,
  mode,
  onRecordEvidence,
  onOpenResource,
  onReplan,
  onSummaryChanged,
}: {
  dashboard: PathDashboardPlan;
  path: PathStep[];
  pathId: string;
  subjects: SubjectLearningPath[];
  resources: ResourceItem[];
  summary: LearningPathWorkspaceSummary;
  mode: OrchestratorMode;
  onRecordEvidence: (key: string, content: string) => void;
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
  onReplan: (subjectId: string, dailyMinutes: number) => void;
  onSummaryChanged: () => void;
}) {
  const totalTasks = dashboard.stages.reduce((total, stage) => total + stage.taskCount, 0);
  const completedTasks = dashboard.stages.reduce((total, stage) => total + stage.completedTaskCount, 0);

  return (
    <div className={`thin-scroll ${styles.tabWorkspace}`}>
      <header className={styles.workspaceIntro}>
        <span className={styles.workspaceKicker}>TODAY&apos;S STUDY</span>
        <div>
          <h2>学习计划</h2>
          <p>今日任务来自当前路径；课程节奏和学习目标会共同影响后续安排。</p>
        </div>
        <Link href="/path/assessment" className={styles.workspaceSecondary}>进入考试测评<ArrowUpRight className="size-4" aria-hidden /></Link>
      </header>

      <div className={styles.planWorkspace}>
        <main className={styles.planMain}>
          {dashboard.today ? (
            <TodayActionPanel
              step={dashboard.today.step}
              pathId={pathId}
              index={dashboard.today.index}
              total={path.length}
              plan={dashboard.today.plan}
              resources={resources}
              onRecordEvidence={onRecordEvidence}
              onOpenResource={onOpenResource}
            />
          ) : (
            <div className={styles.workspaceEmpty}>
              <CalendarClock className="size-6" aria-hidden />
              <strong>今天还没有安排</strong>
              <p>先在课程管理中启用课程，系统会把知识节点编排进今日任务。</p>
            </div>
          )}

          <section className={styles.planUpcoming}>
            <div className={styles.panelHeading}>
              <div><strong>接下来学什么</strong><span>{completedTasks}/{totalTasks} 项学习内容已完成</span></div>
            </div>
            {dashboard.upcoming.length > 0 ? dashboard.upcoming.slice(0, 5).map((stage, index) => (
              <article key={`${stage.index}-${stage.title}`} className={styles.planStage}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{stage.title}</strong><p>{stage.desc}</p></div>
                <small>{stage.totalMinutes} 分钟 · {stage.taskCount} 项</small>
              </article>
            )) : <p className={styles.planComplete}>当前路径没有待学习节点。</p>}
          </section>
        </main>

        <aside className={styles.planSidebar}>
          <section className={styles.planSummaryCard}>
            <div className={styles.panelHeading}><div><strong>学习数据</strong><span>来自当前账号</span></div></div>
            <div className={styles.planSummaryGrid}>
              <div><span>进行中目标</span><strong>{summary.active_goals}</strong></div>
              <div><span>已完成目标</span><strong>{summary.completed_goals}</strong></div>
              <div><span>待复习卡片</span><strong>{summary.due_reviews}</strong></div>
              <div><span>错题记录</span><strong>{summary.wrong_questions}</strong></div>
            </div>
          </section>
          <section className={styles.planPacingCard}>
            <div className={styles.panelHeading}><div><strong>每日课程节奏</strong><span>10–240 分钟</span></div></div>
            <div className={styles.planCourseMinutes}>
              {subjects.length > 0 ? subjects.map((subject) => (
                <label key={subject.id}>
                  <span>{learningSubjectName(subject.title || subject.requestSummary)}</span>
                  <input
                    type="number"
                    min={10}
                    max={240}
                    step={5}
                    defaultValue={subject.dailyMinutes}
                    aria-label={`${subject.title}每日学习分钟数`}
                    onBlur={(event) => {
                      const minutes = Number(event.currentTarget.value);
                      if (Number.isFinite(minutes)) onReplan(subject.id, minutes);
                      else event.currentTarget.value = String(subject.dailyMinutes);
                    }}
                  />
                  <small>分钟</small>
                </label>
              )) : <p>暂无可调整的课程。</p>}
            </div>
          </section>
          <GoalsSection mode={mode} onChanged={onSummaryChanged} />
        </aside>
      </div>
    </div>
  );
}

type FlowStageStatus = "complete" | "current" | "upcoming";

type KnowledgeNodeStatus = "complete" | "current" | "available" | "locked";

function flowStageStatus(
  stage: PathStageSummary,
  currentIndex: number,
): FlowStageStatus {
  if (stage.current) return "current";
  if (
    stage.index < currentIndex ||
    (stage.taskCount > 0 && stage.completedTaskCount >= stage.taskCount)
  ) {
    return "complete";
  }
  return "upcoming";
}

function knowledgeNodeStatus(
  node: KnowledgeGraphNode,
  graph: KnowledgePathGraph,
  dashboard: PathDashboardPlan,
  currentIndex: number,
): KnowledgeNodeStatus {
  const summary = dashboard.stages[node.index];
  const base = summary ? flowStageStatus(summary, currentIndex) : "upcoming";
  if (base === "complete" || base === "current") return base;
  const parentIds = graph.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
  const ready = parentIds.length === 0 || parentIds.every((parentId) => {
    const parent = graph.nodes.find((item) => item.id === parentId);
    if (!parent) return true;
    const parentSummary = dashboard.stages[parent.index];
    return parentSummary && flowStageStatus(parentSummary, currentIndex) !== "upcoming";
  });
  return ready ? "available" : "locked";
}

function KnowledgeGraphEdgeView({
  source,
  target,
  muted,
  current,
}: {
  source: KnowledgeGraphNode;
  target: KnowledgeGraphNode;
  muted: boolean;
  current: boolean;
}) {
  const fromX = source.x + KNOWLEDGE_NODE_WIDTH;
  const fromY = source.y + KNOWLEDGE_NODE_HEIGHT / 2;
  const toX = target.x;
  const toY = target.y + KNOWLEDGE_NODE_HEIGHT / 2;
  const bendX = fromX + Math.max(24, (toX - fromX) / 2);
  const firstWidth = Math.max(0, bendX - fromX);
  const secondWidth = Math.max(0, toX - bendX);
  const verticalHeight = Math.abs(toY - fromY);
  const edgeClass = cn(
    styles.graphEdge,
    current && styles.graphEdgeCurrent,
    muted && styles.graphEdgeMuted,
  );
  const baseDelay = -((source.index * 0.19 + target.index * 0.11) % 1.25);
  const flowStyle = (delay: number, distance: number): CSSProperties => ({
    "--edge-flow-delay": `${delay.toFixed(2)}s`,
    "--edge-flow-distance": `${Math.max(0, distance + 2).toFixed(1)}px`,
  } as CSSProperties);

  return (
    <span className={styles.graphEdgeGroup} aria-hidden>
      <i
        className={edgeClass}
        style={{ left: fromX, top: fromY, width: firstWidth, ...flowStyle(baseDelay, firstWidth) }}
      />
      {Math.abs(toY - fromY) > 1 && (
        <i
          className={cn(
            edgeClass,
            styles.graphEdgeVertical,
            toY < fromY && styles.graphEdgeVerticalReverse,
          )}
          style={{
            left: bendX,
            top: Math.min(fromY, toY),
            height: verticalHeight,
            ...flowStyle(baseDelay + 0.34, verticalHeight),
          }}
        />
      )}
      <i
        className={cn(edgeClass, styles.graphEdgeArrow)}
        style={{ left: bendX, top: toY, width: secondWidth, ...flowStyle(baseDelay + 0.68, secondWidth) }}
      />
    </span>
  );
}

function resourceGroup(task: DailyTaskItem, target?: DailyTaskResource): string {
  if (task.kind === "review" || task.title.includes("测") || task.title.includes("检验")) return "检验掌握";
  if (task.kind === "practice" || target?.type === "quiz" || target?.type === "code") return "动手练";
  if (target?.type === "video" || target?.type === "interactive") return "看示例";
  return "先理解";
}

function KnowledgeResourceDrawer({
  selectedNode,
  selectedStatus,
  graph,
  plan,
  resources,
  completedCount,
  totalCount,
  onClose,
  onOpenResource,
}: {
  selectedNode: KnowledgeGraphNode | null;
  selectedStatus: KnowledgeNodeStatus | null;
  graph: KnowledgePathGraph;
  plan: DailyTaskPlan | null;
  resources: ResourceItem[];
  completedCount: number;
  totalCount: number;
  onClose: () => void;
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const seenRows = new Set<string>();
  const rows = (plan?.tasks.flatMap((task) => {
    const targets: Array<DailyTaskResource | undefined> = task.resourceTargets.length > 0
      ? task.resourceTargets
      : [undefined];
    return targets.map((target) => ({
      task,
      target,
      group: resourceGroup(task, target),
      resource: target ? resolveResourceForTaskTarget(target, task, resources) : undefined,
    }));
  }) ?? []).filter((row) => {
    const key = row.resource?.id || row.target?.id || `${row.task.key}:${row.target?.type ?? "task"}`;
    if (seenRows.has(key)) return false;
    seenRows.add(key);
    return true;
  });
  const groups = ["先理解", "看示例", "动手练", "检验掌握"]
    .map((label) => ({ label, rows: rows.filter((row) => row.group === label) }))
    .filter((group) => group.rows.length > 0);
  const firstReady = rows.find((row) => row.resource);
  const nodeTaskProgress = plan && plan.taskCount > 0
    ? Math.round((plan.completedTaskCount / plan.taskCount) * 100)
    : 0;
  const prerequisites = selectedNode?.step.prerequisites ?? [];
  const nextNodes = selectedNode
    ? graph.edges
        .filter((edge) => edge.from === selectedNode.id)
        .map((edge) => graph.nodes.find((node) => node.id === edge.to)?.step.title)
        .filter((title): title is string => Boolean(title))
    : [];

  if (!selectedNode || !plan) {
    return (
      <aside className={styles.resourceDrawer} aria-label="知识节点资料">
        <div className={styles.drawerOverview}>
          <span className={styles.drawerOverviewIcon}><GitBranch className="size-5" aria-hidden /></span>
          <h3>选择一个知识节点</h3>
          <p>点击路径中的任一节点，即可查看今天要学的内容和对应资料。</p>
          <strong>{completedCount}<small>/{totalCount}</small></strong>
          <span>个知识节点已掌握</span>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.resourceDrawer} aria-label={`${selectedNode.step.title}学习资料`}>
      <div className={`thin-scroll ${styles.drawerBody}`}>
        <section className={styles.railSection}>
          <header className={styles.railSectionTitle}>
            <span><Target className="size-4" aria-hidden />当前推进</span>
            <button type="button" onClick={onClose} aria-label="关闭节点资料"><X className="size-4" /></button>
          </header>
          <div className={styles.currentProgressCard}>
            <span className={styles.drawerEyebrow}>节点 {selectedNode.index + 1}</span>
            <h3>{selectedNode.step.title}</h3>
            <p>{selectedNode.step.objective || selectedNode.step.desc}</p>
            <span className={cn(
              styles.drawerNodeStatus,
              selectedStatus === "complete" && styles.drawerNodeStatusComplete,
              selectedStatus === "locked" && styles.drawerNodeStatusLocked,
            )}>
              <i aria-hidden />
              {selectedStatus === "complete"
                ? "已掌握"
                : selectedStatus === "current"
                  ? "当前学习"
                  : selectedStatus === "available"
                    ? "可学习"
                    : "待解锁"}
            </span>
            <div className={styles.currentProgressBar} aria-label={`节点进度 ${nodeTaskProgress}%`}>
              <i style={{ width: `${nodeTaskProgress}%` }} />
            </div>
            <div className={styles.currentProgressMeta}>
              <span>{plan.progressLabel} 项已完成</span>
              <strong>{nodeTaskProgress}%</strong>
            </div>
            {firstReady?.resource ? (
              <button className={styles.primaryStudyAction} type="button" onClick={() => onOpenResource(firstReady.resource!, firstReady.task.key)}>
                <PlayCircle className="size-4" aria-hidden />继续学习
              </button>
            ) : plan.tasks[0] ? (
              <Link className={styles.primaryStudyAction} href={plan.tasks[0].href}><PlayCircle className="size-4" aria-hidden />继续学习</Link>
            ) : null}
          </div>
        </section>

        <section className={styles.railSection} id="path-today-tasks">
          <header className={styles.railSectionTitle}>
            <span><CalendarClock className="size-4" aria-hidden />今日任务</span>
            <small>{plan.completedTaskCount}/{plan.tasks.length}</small>
          </header>
          <div className={styles.todayTaskList}>
            {plan.tasks.slice(0, 3).map((task) => {
              const ready = rows.find((row) => row.task.key === task.key && row.resource);
              const content = (
                <>
                  <span className={cn(styles.todayTaskState, task.completed && styles.todayTaskComplete)}>
                    {task.completed ? <Check className="size-3.5" aria-hidden /> : <BookOpen className="size-3.5" aria-hidden />}
                  </span>
                  <span><strong>{task.title}</strong><small>{task.action} · {task.minutes} 分钟</small></span>
                  <ChevronRight className="size-3.5" aria-hidden />
                </>
              );
              return ready?.resource ? (
                <button key={task.key} type="button" onClick={() => onOpenResource(ready.resource!, task.key)}>{content}</button>
              ) : (
                <Link key={task.key} href={task.href}>{content}</Link>
              );
            })}
          </div>
        </section>

        <section className={styles.railSection}>
          <header className={styles.railSectionTitle}>
            <span><FileText className="size-4" aria-hidden />节点资料</span>
            <Link href="/resources">查看全部资料</Link>
          </header>
          {groups.length > 0 ? (
            <div className={styles.nodeResourceList}>
              {groups.flatMap((group) => group.rows).slice(0, 4).map(({ task, target, resource }, index) => {
                const content = (
                  <>
                    <span className={styles.resourceRowIcon}>
                      {target?.type === "quiz" || task.kind === "practice"
                        ? <ListChecks className="size-3.5" aria-hidden />
                        : target?.type === "video" || target?.type === "interactive"
                          ? <PlayCircle className="size-3.5" aria-hidden />
                          : <BookOpen className="size-3.5" aria-hidden />}
                    </span>
                    <span className={styles.resourceRowCopy}>
                      <strong>{resource?.title || target?.title || task.title}</strong>
                      <small>{target ? typeName(target.type) : task.action} · {resource?.meta[0] || `${task.minutes} 分钟`}</small>
                    </span>
                    <ChevronRight className="size-3.5" aria-hidden />
                  </>
                );
                if (resource) return <button key={`${task.key}-${target?.key ?? index}`} type="button" onClick={() => onOpenResource(resource, task.key)}>{content}</button>;
                return <Link key={`${task.key}-${target?.key ?? index}`} href={task.href}>{content}</Link>;
              })}
            </div>
          ) : (
            <p className={styles.drawerEmpty}>这个节点暂时没有独立资料。</p>
          )}
          <dl className={styles.compactRelations}>
            <div><dt>先修</dt><dd>{prerequisites.length > 0 ? prerequisites.join("、") : "可直接开始"}</dd></div>
            <div><dt>解锁</dt><dd>{nextNodes.length > 0 ? nextNodes.join("、") : "当前路径目标"}</dd></div>
          </dl>
        </section>
      </div>
    </aside>
  );
}

function learningSubjectName(value?: string): string {
  if (!value) return "科目";
  const cleaned = value
    .normalize("NFKC")
    .trim()
    .replace(/^(?:请为我|请帮我|帮我|给我)?\s*(?:一个|一份|一条)?\s*\d+\s*(?:天|日|周)(?:的)?\s*/u, "")
    .replace(/(?:学习路径|学习计划|课程)$/u, "")
    .replace(/[·・\-—_:：\s]+$/u, "")
    .trim();
  return cleaned || "科目";
}

type LearningCourseChip = {
  id: string;
  name: string;
  progress: number;
};

function LearningPathFlowCanvas({
  dashboard,
  pathSteps,
  completedKeys,
  title,
  caption,
  pathId,
  courses,
  activeCourseId,
  onCourseChange,
  resources,
  onOpenResource,
}: {
  dashboard: PathDashboardPlan;
  pathSteps: PathStep[];
  completedKeys: string[];
  title: string;
  caption: string;
  pathId: string;
  courses: LearningCourseChip[];
  activeCourseId: string;
  onCourseChange: (courseId: string) => void;
  resources: ResourceItem[];
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);
  const didPanRef = useRef(false);
  const currentIndex = dashboard.stages.findIndex((stage) => stage.current);
  const resolvedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(resolvedCurrentIndex);
  const graph = useMemo(() => buildKnowledgePathGraph(pathSteps), [pathSteps]);
  const graphNodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const completedStages = useMemo(
    () => dashboard.stages.filter(
      (stage) => flowStageStatus(stage, resolvedCurrentIndex) === "complete",
    ).length,
    [dashboard.stages, resolvedCurrentIndex],
  );
  const selectedStagePlan = useMemo(
    () => selectedStageIndex !== null && pathSteps[selectedStageIndex]
      ? buildDailyTaskPlan(pathSteps[selectedStageIndex], selectedStageIndex, completedKeys)
      : null,
    [completedKeys, pathSteps, selectedStageIndex],
  );
  const selectedNode = useMemo(
    () => selectedStageIndex === null
      ? null
      : graph.nodes.find((node) => node.index === selectedStageIndex) ?? null,
    [graph.nodes, selectedStageIndex],
  );
  const nodeStatuses = useMemo(
    () => new Map(graph.nodes.map((node) => [
      node.id,
      knowledgeNodeStatus(node, graph, dashboard, resolvedCurrentIndex),
    ])),
    [dashboard, graph, resolvedCurrentIndex],
  );

  useEffect(() => {
    setSelectedStageIndex(resolvedCurrentIndex);
  }, [pathId, resolvedCurrentIndex]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current);
  }, []);

  const schedulePanRender = useCallback((nextPan: { x: number; y: number }) => {
    panRef.current = nextPan;
    pendingPanRef.current = nextPan;
    if (panFrameRef.current !== null) return;
    panFrameRef.current = window.requestAnimationFrame(() => {
      panFrameRef.current = null;
      const pending = pendingPanRef.current;
      pendingPanRef.current = null;
      if (pending) setPan(pending);
    });
  }, []);

  const zoomAroundPointer = useCallback((requestedZoom: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const currentZoom = zoomRef.current;
    const nextZoom = clampKnowledgePathZoom(requestedZoom);
    if (Math.abs(nextZoom - currentZoom) < 0.001) return;

    const bounds = viewport.getBoundingClientRect();
    const anchorX = clientX === undefined ? viewport.clientWidth / 2 : clientX - bounds.left;
    const anchorY = clientY === undefined ? viewport.clientHeight / 2 : clientY - bounds.top;
    const nextPan = knowledgePathPanForZoomAnchor({
      panX: panRef.current.x,
      panY: panRef.current.y,
      anchorX,
      anchorY,
      currentZoom,
      nextZoom,
    });

    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    pendingPanRef.current = null;
    setZoom(nextZoom);
    setPan(nextPan);
  }, []);

  const centerPathCanvas = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextZoom = clampKnowledgePathZoom(Math.min(
      1,
      (viewport.clientWidth - 48) / graph.width,
      (viewport.clientHeight - 48) / graph.height,
    ));
    const nextPan = {
      x: Math.round((viewport.clientWidth - graph.width * nextZoom) / 2),
      y: graph.height * nextZoom < viewport.clientHeight
        ? 24
        : Math.round((viewport.clientHeight - graph.height * nextZoom) / 2),
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    pendingPanRef.current = null;
    setZoom(nextZoom);
    setPan(nextPan);
  }, [graph.height, graph.width]);

  useEffect(() => {
    centerPathCanvas();
  }, [centerPathCanvas, pathId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0015);
      zoomAroundPointer(zoomRef.current * zoomFactor, event.clientX, event.clientY);
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [zoomAroundPointer]);

  const handleCanvasPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-controls], [data-knowledge-node]")) return;

    didPanRef.current = false;
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleCanvasPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (!gesture.moved && Math.hypot(deltaX, deltaY) < 4) return;
    if (!gesture.moved) {
      gesture.moved = true;
      didPanRef.current = true;
      setIsPanning(true);
    }

    const nextPan = { x: gesture.panX + deltaX, y: gesture.panY + deltaY };
    schedulePanRender(nextPan);
    event.preventDefault();
  }, [schedulePanRender]);

  const finishCanvasPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    panGestureRef.current = null;
    setIsPanning(false);
    window.setTimeout(() => {
      didPanRef.current = false;
    }, 0);
  }, []);

  const handleCanvasClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!didPanRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <section className={styles.layout} aria-label="学习路径知识依赖图">
      <div className={styles.canvasColumn}>
        <header className={styles.canvasHeader}>
          <div className={styles.canvasTitle}>
            <h2>{title}</h2>
            <p>{caption}</p>
            <div className={styles.courseChips} aria-label="课程筛选">
              <button
                type="button"
                aria-pressed={activeCourseId === ""}
                onClick={() => onCourseChange("")}
                className={cn(activeCourseId === "" && styles.courseChipActive)}
              >
                全部课程
              </button>
              {courses.slice(0, 4).map((course) => (
                <button
                  key={course.id}
                  type="button"
                  aria-pressed={activeCourseId === course.id}
                  onClick={() => onCourseChange(course.id)}
                  className={cn(activeCourseId === course.id && styles.courseChipActive)}
                >
                  {course.name}<small>{course.progress}%</small>
                </button>
              ))}
            </div>
          </div>
        </header>

        <div
          ref={viewportRef}
          className={cn("thin-scroll", styles.canvasViewport, isPanning && styles.canvasViewportPanning)}
          data-zoom={Math.round(zoom * 100)}
          data-pan-x={Math.round(pan.x)}
          data-pan-y={Math.round(pan.y)}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={finishCanvasPan}
          onPointerCancel={finishCanvasPan}
          onClickCapture={handleCanvasClickCapture}
        >
          <div className={styles.graphStage}>
            <div
              className={styles.graphSurface}
              style={{
                width: graph.width,
                height: graph.height,
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
            >
            {graph.edges.map((edge) => {
              const source = graphNodesById.get(edge.from);
              const target = graphNodesById.get(edge.to);
              if (!source || !target) return null;
              const targetStatus = nodeStatuses.get(target.id) ?? "locked";
              return (
                <KnowledgeGraphEdgeView
                  key={edge.id}
                  source={source}
                  target={target}
                  current={targetStatus === "current"}
                  muted={targetStatus === "locked"}
                />
              );
            })}
            {graph.nodes.map((node) => {
              const summary = dashboard.stages[node.index];
              const status = nodeStatuses.get(node.id) ?? "locked";
              const selected = selectedStageIndex === node.index;
              return (
                <button
                  key={node.id}
                  type="button"
                  data-knowledge-node
                  className={cn(
                    styles.knowledgeNode,
                    status === "complete" && styles.knowledgeNodeComplete,
                    status === "current" && styles.knowledgeNodeCurrent,
                    status === "available" && styles.knowledgeNodeAvailable,
                    status === "locked" && styles.knowledgeNodeLocked,
                    selected && styles.knowledgeNodeSelected,
                  )}
                  style={{ left: node.x, top: node.y }}
                  aria-pressed={selected}
                  aria-current={status === "current" ? "step" : undefined}
                  onClick={() => setSelectedStageIndex(node.index)}
                >
                  <span className={styles.knowledgeNodePort} aria-hidden />
                  <span className={styles.knowledgeNodeIndex} aria-hidden>{node.index + 1}</span>
                  <strong>{node.step.title}</strong>
                  <span className={styles.knowledgeNodeStatus}>
                    {status === "complete" ? <CheckCircle2 className="size-3.5" aria-hidden /> : status === "locked" ? <Circle className="size-3.5" aria-hidden /> : <span />}
                    {status === "complete" ? "已掌握" : status === "current" ? "当前学习" : status === "available" ? "可学习" : "待解锁"}
                  </span>
                  <p>{node.step.objective || node.step.desc}</p>
                  <span className={styles.knowledgeNodeProgress} aria-hidden>
                    <i style={{ width: `${summary && summary.taskCount > 0 ? Math.round((summary.completedTaskCount / summary.taskCount) * 100) : 0}%` }} />
                  </span>
                  <small>{summary?.resourceCount ?? 0} 份资料 · {summary?.taskCount ?? 0} 项内容</small>
                </button>
              );
            })}
            </div>
          </div>
          <div className={styles.canvasLegend} aria-label="知识节点图例">
            <span className={styles.legendComplete}><i />已掌握</span>
            <span className={styles.legendCurrent}><i />当前学习</span>
            <span className={styles.legendAvailable}><i />可学习</span>
            <span className={styles.legendLocked}><i />待解锁</span>
          </div>
          <div className={styles.canvasZoomHint} aria-hidden>左键拖动 · 滚轮缩放</div>
          <div className={styles.canvasControls} data-canvas-controls aria-label="路径画布缩放">
            <button
              type="button"
              aria-label="缩小路径画布"
              onClick={() => zoomAroundPointer(zoomRef.current - 0.1)}
            >
              <ZoomOut className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              className={styles.canvasZoomLevel}
              aria-label="居中路径画布"
              title="恢复 100% 并居中"
              onClick={centerPathCanvas}
            >
              <LocateFixed className="size-3.5" aria-hidden />
              <span>{Math.round(zoom * 100)}%</span>
            </button>
            <button
              type="button"
              aria-label="放大学习路径画布"
              onClick={() => zoomAroundPointer(zoomRef.current + 0.1)}
            >
              <ZoomIn className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <KnowledgeResourceDrawer
        selectedNode={selectedNode}
        selectedStatus={selectedNode ? nodeStatuses.get(selectedNode.id) ?? "locked" : null}
        graph={graph}
        plan={selectedStagePlan}
        resources={resources}
        completedCount={completedStages}
        totalCount={dashboard.stages.length}
        onClose={() => setSelectedStageIndex(null)}
        onOpenResource={onOpenResource}
      />
    </section>
  );
}

export default function DesktopPath() {
  const {
    hydrated,
    mode,
    subjectPaths,
    masterPath,
    masterPathScheduleAnchor,
    activateSubjectPath,
    pauseSubjectPath,
    resumeSubjectPath,
    replanSubjectPath,
    deleteSubjectPath,
    resources,
    completedMaterials,
    watchedVideos,
    running,
    requestLearningPath,
    requestSubjectPathSupplement,
    pendingLearningPath,
    continueLearningPath,
    retryLearningPath,
    editLearningPath,
    openLearningPathKnowledgeBase,
    cancelLearningPath,
    recordLearningPathClarification,
    recordTaskEvidence,
  } = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    mode: state.mode,
    subjectPaths: state.subjectPaths,
    masterPath: state.masterPath,
    masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    activateSubjectPath: state.activateSubjectPath,
    pauseSubjectPath: state.pauseSubjectPath,
    resumeSubjectPath: state.resumeSubjectPath,
    replanSubjectPath: state.replanSubjectPath,
    deleteSubjectPath: state.deleteSubjectPath,
    resources: state.resources,
    completedMaterials: state.completedMaterials,
    watchedVideos: state.watchedVideos,
    running: state.running,
    requestLearningPath: state.requestLearningPath,
    requestSubjectPathSupplement: state.requestSubjectPathSupplement,
    pendingLearningPath: state.pendingLearningPath,
    continueLearningPath: state.continueLearningPath,
    retryLearningPath: state.retryLearningPath,
    editLearningPath: state.editLearningPath,
    openLearningPathKnowledgeBase: state.openLearningPathKnowledgeBase,
    cancelLearningPath: state.cancelLearningPath,
    recordLearningPathClarification: state.recordLearningPathClarification,
    recordTaskEvidence: state.recordTaskEvidence,
  }));
  const viewSwap = getDesktopViewSwap(Boolean(useReducedMotion()));
  const [openResource, setOpenResource] = useState<{
    item: ResourceItem;
    taskKey?: string;
  } | null>(null);
  const [resourceViewerActivated, setResourceViewerActivated] = useState(false);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [activeCourseId, setActiveCourseId] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useDesktopModuleStringState<PathWorkspaceTab>(
    "path",
    "workspace.tab",
    "overview",
    PATH_WORKSPACE_TABS,
  );
  const [selectedSubjectId, setSelectedSubjectId] = useDesktopModuleStringState<string>(
    "path",
    "workspace.subject",
    ""
  );
  const [supplementSubject, setSupplementSubject] = useState<SubjectLearningPath | null>(null);
  const [deleteSubject, setDeleteSubject] = useState<SubjectLearningPath | null>(null);
  const [workspaceSummary, setWorkspaceSummary] = useState<LearningPathWorkspaceSummary>(
    () => emptyLearningPathWorkspaceSummary(),
  );
  const refreshWorkspaceSummary = useCallback(() => {
    if (mode !== "live") {
      setWorkspaceSummary(emptyLearningPathWorkspaceSummary());
      return;
    }
    getLearningPathWorkspaceSummary()
      .then(setWorkspaceSummary)
      .catch(() => setWorkspaceSummary(emptyLearningPathWorkspaceSummary()));
  }, [mode]);

  useEffect(() => {
    if (hydrated) refreshWorkspaceSummary();
  }, [hydrated, refreshWorkspaceSummary]);

  const selectedSubject = subjectPaths.find((subject) => subject.id === selectedSubjectId)
    ?? subjectPaths[0];
  const focusedSubject = activeCourseId
    ? subjectPaths.find((subject) => subject.id === activeCourseId)
    : undefined;
  const displayPath = focusedSubject?.path ?? masterPath;
  const view = activeCourseId || "master";
  const displayAnchor = focusedSubject?.activationDate || masterPathScheduleAnchor;
  const dashboard = buildPathDashboardPlan(displayPath, completedMaterials, {
    anchorDate: displayAnchor,
  });
  const openSubject = (subject: SubjectLearningPath) => {
    setSelectedSubjectId(subject.id);
    setActiveCourseId(subject.id);
  };
  const flowTitle = "循序渐进 · 融汇而学";
  const integratedSubjectCount = subjectPaths.filter((subject) => subject.status === "active" || subject.status === "paused").length || subjectPaths.length;
  const flowCaption = focusedSubject
    ? `按知识依赖梳理 ${learningSubjectName(focusedSubject.title || focusedSubject.requestSummary)} · ${focusedSubject.path.length} 个知识节点`
    : `按知识依赖整合 ${integratedSubjectCount} 门课程 · ${masterPath.length} 个知识节点`;
  const courseChips: LearningCourseChip[] = subjectPaths.map((subject) => {
    const subjectDashboard = buildPathDashboardPlan(subject.path, completedMaterials, {
      anchorDate: subject.activationDate || defaultActivationDate(),
    });
    const completed = subjectDashboard.stages.filter((stage) => stage.taskCount > 0 && stage.completedTaskCount >= stage.taskCount).length;
    return {
      id: subject.id,
      name: learningSubjectName(subject.title || subject.requestSummary),
      progress: subjectDashboard.stages.length > 0
        ? Math.round((completed / subjectDashboard.stages.length) * 100)
        : 0,
    };
  });
  const subjectPathControls = (
    <div className={styles.subjectToolbar} aria-label="科目路径选择与管理">
      <label className={styles.subjectSelect}>
        <span>课程</span>
        <select
          value={selectedSubject?.id ?? ""}
          onChange={(event) => {
            const subject = subjectPaths.find((item) => item.id === event.target.value);
            if (subject) openSubject(subject);
          }}
          disabled={subjectPaths.length === 0}
          aria-label="选择科目学习路径"
        >
          {subjectPaths.length === 0 ? <option value="">暂无科目路径</option> : null}
          {subjectPaths.map((subject) => (
            <option key={subject.id} value={subject.id}>{learningSubjectName(subject.title || subject.requestSummary)}</option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.subjectGenerate} onClick={() => setRequestDialogOpen(true)}>
        <Plus className="size-3.5" aria-hidden />新增课程
      </button>
      {selectedSubject ? (
        <details className={styles.subjectManage}>
          <summary>管理路径</summary>
          <div>
            <button type="button" onClick={() => setSupplementSubject(selectedSubject)}><Plus className="size-3" aria-hidden />补充内容</button>
            {(selectedSubject.status === "ready" || selectedSubject.status === "scheduled") ? (
              <button type="button" onClick={() => activateSubjectPath(selectedSubject.id, defaultActivationDate())}><Route className="size-3" aria-hidden />加入总路径</button>
            ) : null}
            {selectedSubject.status === "active" ? (
              <button type="button" onClick={() => pauseSubjectPath(selectedSubject.id)}><Pause className="size-3" aria-hidden />暂停路径</button>
            ) : null}
            {selectedSubject.status === "paused" ? (
              <button type="button" onClick={() => resumeSubjectPath(selectedSubject.id)}><RotateCcw className="size-3" aria-hidden />重新启用</button>
            ) : null}
            <button type="button" className={styles.subjectDelete} onClick={() => setDeleteSubject(selectedSubject)}><Trash2 className="size-3" aria-hidden />删除路径</button>
          </div>
        </details>
      ) : null}
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.pathTopbar}>
          <div className={styles.pathTopbarTitle}>
            <h1>学习路径</h1>
            <span aria-hidden>学</span>
          </div>
          <nav className={styles.pathTopbarNav} aria-label="学习路径页面导航">
            <button
              type="button"
              aria-pressed={activeWorkspaceTab === "overview"}
              className={activeWorkspaceTab === "overview" ? styles.pathTopbarActive : undefined}
              onClick={() => setActiveWorkspaceTab("overview")}
            >
              路径总览
            </button>
            <button
              type="button"
              aria-pressed={activeWorkspaceTab === "courses"}
              className={activeWorkspaceTab === "courses" ? styles.pathTopbarActive : undefined}
              onClick={() => setActiveWorkspaceTab("courses")}
            >
              课程管理<span className={styles.pathNavCount}>{subjectPaths.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={activeWorkspaceTab === "plan"}
              className={activeWorkspaceTab === "plan" ? styles.pathTopbarActive : undefined}
              onClick={() => setActiveWorkspaceTab("plan")}
            >
              学习计划{dashboard.today?.plan.taskCount ? <span className={styles.pathNavCount}>{dashboard.today.plan.taskCount}</span> : null}
            </button>
            <Link href="/path/assessment">
              考试测评
            </Link>
          </nav>
          <div className={styles.pathTopbarTools}>
            <details className={styles.pathNoticeMenu}>
              <summary aria-label="查看通知"><Bell className="size-[18px]" aria-hidden /></summary>
              <div><strong>学习提醒</strong><p>完成今日任务后，路径进度会自动更新。</p></div>
            </details>
            <TeacherOpenButton
              context={{
                module: "path",
                title: "学习路径",
                detail: "围绕当前学习路径、课程编排与学习计划提问。",
              }}
              aria-label="打开智能教师消息"
            >
              <Mail className="size-[18px]" aria-hidden />
            </TeacherOpenButton>
          </div>
        </header>

        {pendingLearningPath?.stage === "planning" && !pendingLearningPath.error && (
          <div
            className={styles.planningNotice}
            role="status"
            aria-live="polite"
          >
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <strong className="font-semibold">正在后台生成新的学习路径</strong>
              <span className="ml-2 text-muted-foreground">你可以继续查看和完成当前任务，生成完成后本页会自动更新。</span>
            </div>
          </div>
        )}

        {!hydrated ? (
          <div className={styles.pathLoading}>
            正在恢复学习路径…
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${activeWorkspaceTab}:${view}`} {...viewSwap} className={styles.pathBody}>
              {activeWorkspaceTab === "courses" ? (
                <CourseManagementWorkspace
                  subjects={subjectPaths}
                  watchedVideoCount={watchedVideos.length}
                  onView={(subject) => {
                    openSubject(subject);
                    setActiveWorkspaceTab("overview");
                  }}
                  onActivate={(subjectId) => activateSubjectPath(subjectId, defaultActivationDate())}
                  onPause={pauseSubjectPath}
                  onResume={resumeSubjectPath}
                  onSupplement={setSupplementSubject}
                  onDelete={setDeleteSubject}
                  onGenerate={() => setRequestDialogOpen(true)}
                />
              ) : activeWorkspaceTab === "plan" ? (
                <LearningPlanWorkspace
                  dashboard={dashboard}
                  path={displayPath}
                  pathId={activeCourseId || "master"}
                  subjects={subjectPaths}
                  resources={resources}
                  summary={workspaceSummary}
                  mode={mode}
                  onRecordEvidence={(key, content) => recordTaskEvidence(key, content, "written_response")}
                  onOpenResource={(item, taskKey) => {
                    setResourceViewerActivated(true);
                    setOpenResource({ item, taskKey });
                  }}
                  onReplan={replanSubjectPath}
                  onSummaryChanged={refreshWorkspaceSummary}
                />
              ) : displayPath.length > 0 ? (
                <LearningPathFlowCanvas
                  dashboard={dashboard}
                  pathSteps={displayPath}
                  completedKeys={completedMaterials}
                  title={flowTitle}
                  caption={flowCaption}
                  pathId={activeCourseId || "master"}
                  courses={courseChips}
                  activeCourseId={activeCourseId}
                  onCourseChange={(courseId) => {
                    setActiveCourseId(courseId);
                    if (courseId) setSelectedSubjectId(courseId);
                  }}
                  resources={resources}
                  onOpenResource={(item, taskKey) => {
                    setResourceViewerActivated(true);
                    setOpenResource({ item, taskKey });
                  }}
                />
              ) : (
                <div className={styles.emptyWorkspace}>
                  <div className={styles.emptyToolbar}>{subjectPathControls}</div>
                  <div className={styles.emptyState}>
                    <DesktopEmptyState
                      icon={Route}
                      title={subjectPaths.length > 0 ? "总学习路径尚未启用" : "还没有科目学习路径"}
                      desc={subjectPaths.length > 0 ? "请在上方管理中把需要统筹的科目加入总路径；系统会按知识依赖展示跨科目关系。" : "点击上方「生成科目路径」，完成后即可查看知识分叉并加入总路径。"}
                    />
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      {resourceViewerActivated ? (
        <ResourceViewer
          item={openResource?.item ?? null}
          taskKey={openResource?.taskKey}
          onClose={() => setOpenResource(null)}
        />
      ) : null}
      <LearningPathRequestDialog disabled={running || mode !== "live"} open={requestDialogOpen} onClose={() => setRequestDialogOpen(false)} onSubmit={requestLearningPath} />
      <SubjectSupplementDialog subject={supplementSubject} disabled={running || mode !== "live"} onClose={() => setSupplementSubject(null)} onConfirm={requestSubjectPathSupplement} />
      <SubjectDeleteDialog subject={deleteSubject} onClose={() => setDeleteSubject(null)} onConfirm={deleteSubjectPath} />
      {pendingLearningPath?.request &&
        (pendingLearningPath.stage === "confirming" || Boolean(pendingLearningPath.error)) && (
        <LearningBaselineGate
          request={pendingLearningPath.request}
          onChoose={continueLearningPath}
          onCancel={cancelLearningPath}
          planningError={pendingLearningPath.error ?? null}
          onRetryPlan={retryLearningPath}
          onEditPlan={editLearningPath}
          onOpenKnowledgeBase={openLearningPathKnowledgeBase}
          planning={pendingLearningPath.stage === "planning"}
          initialConfirmation={pendingLearningPath.confirmation}
          onClarification={recordLearningPathClarification}
        />
      )}
    </div>
  );
}
