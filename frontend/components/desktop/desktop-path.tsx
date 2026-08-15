"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import NextLink from "next/link";
import { ShellLink as Link } from "@/components/shell-link";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleGauge,
  Clock3,
  GitBranch,
  GitMerge,
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
  CalendarClock,
  Pause,
  PanelRightClose,
  PanelRightOpen,
  PlayCircle,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { AGENT_ICONS } from "@/components/agent-bits";
import { DesktopEmptyState } from "@/components/desktop/desktop-empty-state";
import { LearningBaselineGate } from "@/components/learning-baseline-gate";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceViewer } from "@/components/resource-viewer";
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
  defaultActivationDate,
  reflowSubjectPath,
  subjectActivationLabel,
  type SubjectLearningPath,
} from "@/lib/master-learning-path";
import { reflectionHref } from "@/lib/reflection";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import type { PathStep, ResourceItem } from "@/lib/types";
import { getDesktopViewSwap } from "@/lib/web-motion";
import { cn } from "@/lib/utils";
import styles from "./desktop-path.module.css";

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

export function GoalsSection({ mode }: { mode: OrchestratorMode }) {
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
  };

  const remove = async (id: string | number) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await deleteGoal(mode, id);
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
  const [deadline, setDeadline] = useState("");
  const inputClass = "mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35";

  const submit = () => {
    if (!topic.trim() || !goal.trim() || disabled) return;
    const request = [
      "请为我生成一条独立的科目学习路径。生成后保持待启用，由我决定何时加入总学习路径。",
      `学习主题：${topic.trim()}`,
      `学习目标：${goal.trim()}`,
      currentState.trim() ? `当前情况或卡点：${currentState.trim()}` : "",
      deadline ? `希望完成日期：${deadline}` : "",
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
              希望完成日期
              <input type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} className={inputClass} />
              <span className="mt-1.5 block text-[11px] font-normal text-muted-foreground">下一步会继续确认学情、每日时长和资料类型。</span>
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

function SubjectActivationDialog({
  subject,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath | null;
  onClose: () => void;
  onConfirm: (subjectId: string, date: string) => void;
}) {
  const [date, setDate] = useState(defaultActivationDate());

  useEffect(() => {
    if (subject) setDate(subject.activationDate || defaultActivationDate());
  }, [subject]);

  if (!subject) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`设置${subject.title}启用时间`} onClick={onClose}>
      <section className="w-full max-w-md rounded-xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-[#3a2a18] text-[#fffaf1]"><CalendarClock className="size-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">设置启用时间</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">{subject.title}</span></span>
          <button type="button" onClick={onClose} aria-label="关闭启用时间设置" className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">选择今天会立即加入总路径；选择未来日期会在当天自动加入统筹。在启用前不会占用每日学习时间。</p>
          <label className="block text-xs font-medium text-[#62513c]">
            启用日期
            <input type="date" min={defaultActivationDate()} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button disabled={!date} onClick={() => { onConfirm(subject.id, date); onClose(); }}>
              {date > defaultActivationDate() ? "确认定时启用" : "立即启用"}
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

function SubjectReplanDialog({
  subject,
  onClose,
  onConfirm,
}: {
  subject: SubjectLearningPath | null;
  onClose: () => void;
  onConfirm: (subjectId: string, dailyMinutes: number) => void;
}) {
  const [dailyMinutes, setDailyMinutes] = useState(40);

  useEffect(() => {
    if (subject) setDailyMinutes(subject.dailyMinutes);
  }, [subject]);

  if (!subject) return null;
  const boundedMinutes = Math.max(10, Math.min(240, Math.round(dailyMinutes || 0)));
  const estimatedDays = reflowSubjectPath(subject.path, boundedMinutes).length;
  const totalMinutes = subject.path.reduce(
    (total, step) => total + (step.steps ?? []).reduce((sum, task) => sum + task.minutes, 0),
    0,
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label={`重新编排${subject.title}学习路径`} onClick={onClose}>
      <section className="w-full max-w-md rounded-xl border border-[#d5c2a4] bg-[#fffaf2] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-[#dfcfb8] px-5 py-4">
          <span className="grid size-9 place-items-center rounded-lg bg-[#3a2a18] text-[#fffaf1]"><CalendarClock className="size-4" /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm">重新编排学习时间</strong><span className="mt-0.5 block truncate text-xs text-muted-foreground">{subject.title}</span></span>
          <button type="button" onClick={onClose} aria-label="关闭重新编排" className="grid size-8 place-items-center rounded-lg hover:bg-black/5"><X className="size-4" /></button>
        </header>
        <div className="space-y-4 px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">只调整现有任务和资源的日期分布，不重新生成任何资源，也不会清除已经完成的学习记录。</p>
          <label className="block text-xs font-medium text-[#62513c]">
            每天用于该科目的时间
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min={10} max={240} step={5} value={dailyMinutes} onChange={(event) => setDailyMinutes(Number(event.target.value))} className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62]/35" />
              <span className="text-xs text-muted-foreground">分钟</span>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2/60 p-3 text-xs">
            <span><span className="block text-muted-foreground">现有任务总时长</span><strong className="mt-1 block">{totalMinutes} 分钟</strong></span>
            <span><span className="block text-muted-foreground">重新编排后</span><strong className="mt-1 block">约 {estimatedDays} 天</strong></span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button disabled={!dailyMinutes || dailyMinutes < 10 || dailyMinutes > 240} onClick={() => { onConfirm(subject.id, boundedMinutes); onClose(); }}>确认重新编排</Button>
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

function SubjectPathPanel({
  subjects,
  selectedId,
  onSelect,
  onSchedule,
  onPause,
  onResume,
  onReplan,
  onSupplement,
  onDelete,
  onGenerate,
  compact = false,
}: {
  subjects: SubjectLearningPath[];
  selectedId?: string;
  onSelect: (subject: SubjectLearningPath) => void;
  onSchedule: (subject: SubjectLearningPath) => void;
  onPause: (subjectId: string) => void;
  onResume: (subjectId: string) => void;
  onReplan: (subject: SubjectLearningPath) => void;
  onSupplement: (subject: SubjectLearningPath) => void;
  onDelete: (subject: SubjectLearningPath) => void;
  onGenerate: () => void;
  compact?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-4", compact && styles.subjectSidebarPanel)}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">科目学习路径</h2>
          <p className="mt-1 text-xs text-muted-foreground">启用后由总路径统一安排</p>
        </div>
        <Button size="sm" onClick={onGenerate} className={cn("h-8 gap-1.5", compact && styles.subjectSidebarGenerate)}><Plus className="size-3.5" />生成科目路径</Button>
      </div>
      <div className={cn("mt-4 space-y-2.5", compact && styles.subjectSidebarList)}>
        {subjects.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">还没有科目路径。生成后可在这里设置启用日期。</p>
        ) : subjects.map((subject) => {
          const enabled = subject.status === "active" || subject.status === "completed";
          return (
            <div key={subject.id} className={cn("rounded-lg border p-3", compact && styles.subjectSidebarCard, selectedId === subject.id && "border-primary/50 bg-primary/[0.04]")}>
              <div className="flex items-start gap-2">
                <button type="button" onClick={() => onSelect(subject)} className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm">{subject.title}</strong>
                    <span className={cn("rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground", enabled && "bg-success/10 text-success")}>{subjectActivationLabel(subject)}</span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"><i className="block h-full rounded-full bg-primary" style={{ width: `${subject.progress}%` }} /></span>
                  <span className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>{subject.path.length} 天 · 每日 {subject.dailyMinutes} 分钟</span><span>进度 {subject.progress}%</span></span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(subject)}
                  aria-label={`删除${subject.title}学习路径`}
                  title="删除学习路径"
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className={cn("mt-2 flex flex-wrap justify-end gap-2 border-t pt-2", compact && styles.subjectSidebarActions)}>
                <button type="button" aria-label={`补充${subject.title}学习路径`} onClick={() => onSupplement(subject)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"><Plus className="size-3" />补充</button>
                <button type="button" aria-label={`重新编排${subject.title}学习路径`} onClick={() => onReplan(subject)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"><CalendarClock className="size-3" />重新编排</button>
                {(subject.status === "ready" || subject.status === "scheduled") && (
                  <button type="button" onClick={() => onSchedule(subject)} className="rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent">
                    {subject.status === "scheduled" ? "修改启用时间" : "设置启用时间"}
                  </button>
                )}
                {subject.status === "active" && (
                  <button type="button" onClick={() => onPause(subject.id)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"><Pause className="size-3" />暂停</button>
                )}
                {subject.status === "paused" && (
                  <button type="button" onClick={() => onResume(subject.id)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent"><RotateCcw className="size-3" />重新启用</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type FlowStageStatus = "complete" | "current" | "upcoming";

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

function FlowTaskNode({
  task,
  resources,
  onOpenResource,
}: {
  task: DailyTaskItem;
  resources: ResourceItem[];
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const resolvedTargets = task.resourceTargets.map((target) => ({
    target,
    resource: resolveResourceForTaskTarget(target, task, resources),
  }));
  const readyTarget = resolvedTargets.find((entry) => Boolean(entry.resource));
  const missingExactTarget = resolvedTargets.some(
    (entry) => Boolean(entry.target.id) && !entry.resource,
  );
  const targetType = readyTarget?.target.type ?? task.resourceTargets[0]?.type;
  const visualTitle = task.kind === "practice" || targetType === "quiz"
    ? "匹配练习"
    : task.kind === "review"
      ? "阶段复盘"
      : targetType === "video"
        ? "概念视频"
        : targetType === "code" || targetType === "interactive"
          ? "代码实践"
          : "概念讲义";
  const Icon = task.kind === "practice"
    ? ListChecks
    : task.kind === "review"
      ? BookOpenCheck
      : BookOpen;
  const content = (
    <>
      <span className={styles.taskIcon}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className={styles.taskCopy}>
        <strong>{visualTitle}</strong>
        <span>
          {readyTarget
            ? task.title
            : missingExactTarget
              ? "资料审核完成后自动出现"
              : task.action}
        </span>
      </span>
      <span className={styles.taskTime}>{task.minutes} 分钟</span>
      <span className={styles.taskOutputPort} aria-hidden />
    </>
  );

  if (readyTarget?.resource) {
    return (
      <button
        type="button"
        className={styles.taskCard}
        onClick={() => onOpenResource(readyTarget.resource!, task.key)}
      >
        {content}
      </button>
    );
  }

  if (missingExactTarget) {
    return (
      <div className={styles.taskCard} aria-disabled="true">
        {content}
      </div>
    );
  }

  return (
    <Link href={task.href} className={styles.taskCard}>
      {content}
    </Link>
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

function LearningPathFlowCanvas({
  dashboard,
  pathSteps,
  completedKeys,
  title,
  caption,
  pathId,
  view,
  onViewChange,
  resources,
  onOpenResource,
}: {
  dashboard: PathDashboardPlan;
  pathSteps: PathStep[];
  completedKeys: string[];
  title: string;
  caption: string;
  pathId: string;
  view: "master" | "subjects";
  onViewChange: (view: "master" | "subjects") => void;
  resources: ResourceItem[];
  onOpenResource: (resource: ResourceItem, taskKey: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const currentIndex = dashboard.stages.findIndex((stage) => stage.current);
  const resolvedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
  const completedStages = dashboard.stages.filter(
    (stage) => flowStageStatus(stage, resolvedCurrentIndex) === "complete",
  ).length;
  const todayPlan = dashboard.today?.plan;
  const firstActionHref = todayPlan?.tasks[0]?.href ?? "/desktop/path/study";
  const selectedStagePlan = selectedStageIndex !== null && pathSteps[selectedStageIndex]
    ? buildDailyTaskPlan(pathSteps[selectedStageIndex], selectedStageIndex, completedKeys)
    : null;

  useEffect(() => {
    setSelectedStageIndex(null);
  }, [pathId]);

  return (
    <section
      className={cn(styles.layout, !summaryOpen && styles.layoutSummaryCollapsed)}
      aria-label="学习路径连线画布"
    >
      <div className={styles.canvasColumn}>
        <span className={styles.spineLead} aria-hidden />
        <header className={styles.canvasHeader}>
          <div className={styles.canvasTitle}>
            <h2>{title}</h2>
            <p>{caption}</p>
            <div className={styles.canvasModeSwitch} role="tablist" aria-label="学习路径视图">
              <button
                type="button"
                role="tab"
                aria-selected={view === "master"}
                onClick={() => onViewChange("master")}
                className={cn(view === "master" && styles.canvasModeActive)}
              >
                总路径
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "subjects"}
                onClick={() => onViewChange("subjects")}
                className={cn(view === "subjects" && styles.canvasModeActive)}
              >
                科目路径
              </button>
            </div>
          </div>
        </header>

        <div className={`thin-scroll ${styles.canvasViewport}`}>
          <div
            className={styles.canvas}
            style={{ transform: `scale(${zoom})` }}
          >
            {dashboard.stages.map((stage) => {
              const status = flowStageStatus(stage, resolvedCurrentIndex);
              const isCurrent = status === "current";
              const isSelected = selectedStageIndex === stage.index;
              const side = isCurrent || stage.index % 2 === 0 ? "left" : "right";
              const stageCard = (
                <article
                  className={cn(
                    styles.stageCard,
                    side === "left" ? styles.cardLeft : styles.cardRight,
                    status === "complete" && styles.cardComplete,
                    status === "current" && styles.cardCurrent,
                    status === "upcoming" && styles.cardUpcoming,
                    isSelected && styles.cardSelected,
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <button
                    type="button"
                    className={styles.stageSelectButton}
                    aria-expanded={isSelected}
                    aria-controls={`stage-materials-${stage.index}`}
                    onClick={() => setSelectedStageIndex((value) =>
                      value === stage.index ? null : stage.index
                    )}
                  >
                    <div className={styles.stageHeader}>
                      <span className={styles.stageIndex}>
                        {String(stage.index + 1).padStart(2, "0")}
                      </span>
                      <div className={styles.stageCopy}>
                        <h3>{stage.title}</h3>
                        <p>{stage.desc}</p>
                      </div>
                      <span className={styles.stageState}>
                        {status === "complete"
                          ? "已完成"
                          : status === "current"
                            ? "进行中"
                            : "待学习"}
                      </span>
                    </div>
                    <div className={styles.stageMeta}>
                      <span><CalendarDays className="size-3.5" aria-hidden />{isCurrent ? "今天" : stage.day}</span>
                      <span><ListChecks className="size-3.5" aria-hidden />{stage.taskCount} 项任务</span>
                      <span><Clock3 className="size-3.5" aria-hidden />{stage.totalMinutes} 分钟</span>
                    </div>
                  </button>
                  {isCurrent && (
                    <Link href={firstActionHref} className={styles.stageAction}>
                      继续今日学习
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </article>
              );

              return (
                <div
                  key={`${stage.day}-${stage.index}`}
                  className={cn(
                    styles.stageRow,
                    isCurrent && styles.activeRow,
                    isSelected && styles.expandedRow,
                  )}
                >
                  <div
                    className={cn(
                      styles.cardSlot,
                      side === "left" ? styles.cardSlotLeft : styles.cardSlotRight,
                    )}
                  >
                    {stageCard}
                  </div>
                  <div
                    className={cn(
                      styles.spine,
                      status === "complete" && styles.spineComplete,
                      status === "current" && styles.spineCurrent,
                      status === "upcoming" && styles.spineUpcoming,
                    )}
                    aria-hidden
                  >
                    <span
                      className={cn(
                        styles.spineNode,
                        status === "complete" && styles.nodeComplete,
                        status === "current" && styles.nodeCurrent,
                      )}
                    />
                    {isCurrent && <span className={styles.flowParticle} />}
                  </div>
                  {isSelected && selectedStagePlan && selectedStagePlan.tasks.length > 0 && (
                    <div
                      id={`stage-materials-${stage.index}`}
                      className={cn(
                        styles.branchSlot,
                        side === "left" ? styles.branchSlotRight : styles.branchSlotLeft,
                        status === "complete" && styles.branchSlotComplete,
                        status === "upcoming" && styles.branchSlotUpcoming,
                      )}
                      aria-label={`${stage.title}学习资料`}
                    >
                      {selectedStagePlan.tasks.slice(0, 3).map((task) => (
                        <FlowTaskNode
                          key={`${pathId}-${task.key}`}
                          task={task}
                          resources={resources}
                          onOpenResource={onOpenResource}
                        />
                      ))}
                      <span className={styles.mergeNode} aria-hidden />
                    </div>
                  )}
                </div>
              );
            })}
            <span className={styles.pathTerminus} aria-hidden>
              <ArrowDown className="size-4" />
            </span>
          </div>
          <div className={styles.canvasControls} aria-label="路径画布缩放">
            <button
              type="button"
              aria-label="缩小路径画布"
              onClick={() => setZoom((value) => Math.max(0.85, Number((value - 0.1).toFixed(2))))}
            >
              <ZoomOut className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="居中路径画布"
              title={`${Math.round(zoom * 100)}%`}
              onClick={() => setZoom(1)}
            >
              <LocateFixed className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="放大学习路径画布"
              onClick={() => setZoom((value) => Math.min(1.15, Number((value + 0.1).toFixed(2))))}
            >
              <ZoomIn className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      <aside
        className={cn(styles.summaryRail, !summaryOpen && styles.summaryRailCollapsed)}
        aria-label="路径摘要"
      >
        <button
          type="button"
          className={styles.summaryToggle}
          onClick={() => setSummaryOpen((open) => !open)}
          aria-expanded={summaryOpen}
          aria-label={summaryOpen ? "收起路径摘要" : "展开路径摘要"}
          title={summaryOpen ? "收起路径摘要" : "展开路径摘要"}
        >
          {summaryOpen
            ? <PanelRightClose className="size-4" aria-hidden />
            : <PanelRightOpen className="size-4" aria-hidden />}
        </button>
        {summaryOpen && (
          <>
            <section className={styles.summarySection}>
              <h3>进度</h3>
              <div className={styles.progressDial} aria-label={`已完成 ${completedStages}/${dashboard.stages.length} 个阶段`}>
                <CircleGauge aria-hidden />
                <strong>{completedStages}<small>/{dashboard.stages.length}</small></strong>
              </div>
            </section>
            <section className={styles.summarySection}>
              <h3>预计完成</h3>
              <div className={styles.summaryValue}>
                {dashboard.stages.at(-1)?.day ?? "—"}
              </div>
              <p className={styles.summaryCaption}>完成当前路径全部阶段</p>
            </section>
            <section className={styles.summarySection}>
              <h3>图例说明</h3>
              <div className={styles.legend}>
                <span className={styles.legendComplete}><i />已完成</span>
                <span className={styles.legendCurrent}><i />进行中</span>
                <span className={styles.legendUpcoming}><i />待学习</span>
              </div>
              <p className={styles.branchLegend}>
                <GitBranch className={`size-4 ${styles.branchLegendIcon}`} aria-hidden />
                分支节点
              </p>
              <p className={styles.branchLegend}>
                <GitMerge className={`size-4 ${styles.branchLegendIcon}`} aria-hidden />
                合并节点
              </p>
            </section>
          </>
        )}
      </aside>
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
    recordTaskEvidence,
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
  } = useOrchestratorContext();
  const [openResource, setOpenResource] = useState<{
    item: ResourceItem;
    taskKey?: string;
  } | null>(null);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [view, setView] = useState<"master" | "subjects">("subjects");
  const viewSwap = getDesktopViewSwap(Boolean(useReducedMotion()));
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [activationSubject, setActivationSubject] = useState<SubjectLearningPath | null>(null);
  const [replanSubject, setReplanSubject] = useState<SubjectLearningPath | null>(null);
  const [supplementSubject, setSupplementSubject] = useState<SubjectLearningPath | null>(null);
  const [deleteSubject, setDeleteSubject] = useState<SubjectLearningPath | null>(null);
  const selectedSubject = subjectPaths.find((subject) => subject.id === selectedSubjectId)
    ?? subjectPaths[0];
  const displayPath = view === "master" ? masterPath : selectedSubject?.path ?? [];
  const displayAnchor = view === "master"
    ? masterPathScheduleAnchor
    : selectedSubject?.activationDate || defaultActivationDate();
  const dashboard = buildPathDashboardPlan(displayPath, completedMaterials, {
    anchorDate: displayAnchor,
  });
  const openSubject = (subject: SubjectLearningPath) => {
    setSelectedSubjectId(subject.id);
    setView("subjects");
  };
  const selectedSubjectName = learningSubjectName(
    selectedSubject?.title || selectedSubject?.requestSummary,
  );
  const flowTitle = view === "master"
    ? "总学习路径"
    : `${selectedSubjectName} · 学习路径`;
  const flowCaption = view === "master"
    ? "各科目学习阶段按日期统筹，支线卡片是当前阶段需要完成的真实学习任务。"
    : `系统梳理${selectedSubjectName}的核心知识与方法 · ${selectedSubject?.path.length ?? 0} 个阶段`;
  const subjectPathPanel = (
    <SubjectPathPanel
      compact
      subjects={subjectPaths}
      selectedId={selectedSubject?.id}
      onSelect={openSubject}
      onSchedule={setActivationSubject}
      onPause={pauseSubjectPath}
      onResume={resumeSubjectPath}
      onReplan={setReplanSubject}
      onSupplement={setSupplementSubject}
      onDelete={setDeleteSubject}
      onGenerate={() => setRequestDialogOpen(true)}
    />
  );

  return (
    <div className={cn("desktop-book-page thin-scroll h-full overflow-y-auto", styles.page)}>
      <div className={cn("desktop-book-page__frame mx-auto", styles.frame)}>

        {pendingLearningPath?.stage === "planning" && !pendingLearningPath.error && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] px-4 py-3 text-sm"
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
          <div className="rounded-2xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">
            正在恢复学习路径…
          </div>
        ) : (
          /* 视图切换只包这一层最外层容器：列表项很多，逐项 motion 会明显掉帧 */
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={view} {...viewSwap} className="space-y-4">
              {displayPath.length > 0 ? (
                <>
                  <div className={styles.pathWorkspace}>
                    <aside className={styles.subjectSidebar} aria-label="科目学习路径管理">
                      {subjectPathPanel}
                    </aside>
                    <LearningPathFlowCanvas
                      dashboard={dashboard}
                      pathSteps={displayPath}
                      completedKeys={completedMaterials}
                      title={flowTitle}
                      caption={flowCaption}
                      pathId={view === "master" ? "master" : selectedSubject?.id ?? "master"}
                      view={view}
                      onViewChange={setView}
                      resources={resources}
                      onOpenResource={(item, taskKey) => setOpenResource({ item, taskKey })}
                    />
                  </div>
                  {dashboard.today && (
                    <details className={styles.taskDetails}>
                      <summary>展开今日任务详情与学习产出</summary>
                      <TodayActionPanel
                        step={dashboard.today.step}
                        pathId={view === "master" ? "master" : selectedSubject?.id ?? "master"}
                        index={dashboard.today.index}
                        total={displayPath.length}
                        plan={dashboard.today.plan}
                        resources={resources}
                        onRecordEvidence={(key, content) => recordTaskEvidence(key, content, "written_response")}
                        onOpenResource={(item, taskKey) => setOpenResource({ item, taskKey })}
                      />
                    </details>
                  )}
                </>
              ) : (
                <div className={styles.pathWorkspace}>
                  <aside className={styles.subjectSidebar} aria-label="科目学习路径管理">
                    {subjectPathPanel}
                  </aside>
                  <div className={styles.emptyState}>
                    <DesktopEmptyState
                      icon={Route}
                      title={subjectPaths.length > 0 ? "总学习路径尚未启用" : "还没有科目学习路径"}
                      desc={subjectPaths.length > 0 ? "请在左侧为待启用科目设置日期；启用后，系统会把多个科目的每日任务统一排入这里。" : "点击左侧「生成科目路径」，完成生成后再设置启用时间。"}
                    />
                  </div>
                </div>
              )}

              {watchedVideos.length > 0 && (
                <div className={styles.management}>
                  <section className="rounded-xl border bg-card p-4">
                    <div className="flex items-center gap-1.5">
                      <PlayCircle className="size-4 text-primary" />
                      <h2 className="text-sm font-semibold">视频学习记录</h2>
                      <span className="ml-auto text-xs text-muted-foreground">{watchedVideos.length} 个</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {watchedVideos.slice(0, 3).map((video) => (
                        <div key={video.bvid} className="rounded-lg border bg-surface-2/40 p-3">
                          <div className="truncate text-xs font-semibold">{video.title}</div>
                          <NextLink href="/desktop/video-learning" className="mt-2 inline-flex text-xs font-medium text-primary hover:underline">
                            回到内置播放器
                          </NextLink>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <ResourceViewer
        item={openResource?.item ?? null}
        taskKey={openResource?.taskKey}
        onClose={() => setOpenResource(null)}
      />
      <LearningPathRequestDialog disabled={running || mode !== "live"} open={requestDialogOpen} onClose={() => setRequestDialogOpen(false)} onSubmit={requestLearningPath} />
      <SubjectActivationDialog subject={activationSubject} onClose={() => setActivationSubject(null)} onConfirm={activateSubjectPath} />
      <SubjectReplanDialog subject={replanSubject} onClose={() => setReplanSubject(null)} onConfirm={replanSubjectPath} />
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
