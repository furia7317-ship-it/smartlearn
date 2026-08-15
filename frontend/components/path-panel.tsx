"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  BookOpenCheck,
  Circle,
  Clock3,
  FileText,
  Flag,
  Map,
  PlayCircle,
  Target,
} from "lucide-react";

import { AGENT_ICONS } from "@/components/agent-bits";
import { ShellLink as Link } from "@/components/shell-link";
import { AGENT_MAP } from "@/lib/agents";
import { buildDailyTaskPlan, getDailyTaskResourceAction } from "@/lib/daily-task-plan";
import {
  collectPathResourceTypes,
  findResourceForTask,
  resolveResourceForTaskTarget,
} from "@/lib/path-resource-links";
import type { PathStep, ResourceItem } from "@/lib/types";
import { reflectionHref } from "@/lib/reflection";
import { pathScheduleCurrentIndex } from "@/lib/path-schedule-clock";
import { cn } from "@/lib/utils";

function CompactEvidenceForm({
  task,
  onSubmit,
}: {
  task: ReturnType<typeof buildDailyTaskPlan>["tasks"][number];
  onSubmit?: (key: string, content: string) => void;
}) {
  const [content, setContent] = useState("");
  const prompts = task.prompts.length > 0
    ? task.prompts
    : task.action.includes("复盘")
      ? ["今天最容易出错的地方是什么？", "明天最需要解决的问题是什么？"]
      : ["不用看资料，复述今天的核心概念。", "写一个能应用它的具体例子。"];
  if (task.completed) {
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-[10px] font-medium text-success">
        <CheckCircle2 className="size-3" /> 已按学习产出记录
      </span>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-dashed bg-card p-2">
      <ol className="space-y-1 text-[10px] leading-relaxed text-foreground/85">
        {prompts.map((prompt, index) => (
          <li key={`${task.key}-prompt-${index}`}><span className="mr-1 font-mono text-primary">Q{index + 1}</span>{prompt}</li>
        ))}
      </ol>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        placeholder="写下答案或复盘"
        className="mt-1.5 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <button
        type="button"
        disabled={!onSubmit || content.trim().length < 6}
        onClick={() => onSubmit?.(task.key, content)}
        className="mt-1.5 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        提交学习产出
      </button>
    </div>
  );
}

export function PathPanel({
  path,
  completed = [],
  resources = [],
  scheduleAnchor,
  onRecordEvidence,
  onOpenResource,
}: {
  path: PathStep[];
  completed?: string[];
  resources?: ResourceItem[];
  scheduleAnchor?: string;
  onRecordEvidence?: (key: string, content: string) => void;
  onOpenResource?: (resource: ResourceItem, taskKey?: string) => void;
}) {
  const currentIndex = pathScheduleCurrentIndex(path, scheduleAnchor);
  const initialDay = path[currentIndex]?.day ?? path[0]?.day ?? "";
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const selectedIndex = useMemo(() => {
    const exact = path.findIndex((step) => step.day === selectedDay);
    if (exact >= 0) return exact;
    return currentIndex >= 0 ? currentIndex : 0;
  }, [currentIndex, path, selectedDay]);
  const selectedStep = path[selectedIndex];
  const plan = selectedStep
    ? buildDailyTaskPlan(selectedStep, selectedIndex, completed)
    : null;
  const nextTask = plan?.tasks.find((task) => !task.completed) ?? plan?.tasks[0];
  const nextResource = nextTask ? findResourceForTask(nextTask, resources) : undefined;
  const progressRatio = plan && plan.taskCount > 0 ? plan.completedTaskCount / plan.taskCount : 0;
  const pathResourceTypes = useMemo(
    () => collectPathResourceTypes(path, resources),
    [path, resources],
  );

  if (path.length === 0) {
    return (
      <div className="flex h-full flex-col gap-2 p-3 pt-2">
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Map className="mx-auto mb-2 size-5 text-muted-foreground/50" />
          <p className="text-xs font-semibold">总学习路径 · 尚未启用</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            请先在学习路径页设置科目启用时间，
            <br />
            启用后会在这里统一显示
            <br />
            多个科目的每日任务
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 pt-2">
      <div className="shrink-0 rounded-lg border bg-card px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold">总学习路径 · 今日安排</span>
          {plan && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {plan.progressLabel} 完成
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
          {path.map((step) => {
            const selected = step.day === selectedStep?.day;
            return (
              <button
                key={step.day}
                type="button"
                aria-label={`查看 ${step.day} 学习内容`}
                aria-pressed={selected}
                onClick={() => setSelectedDay(step.day)}
                className={cn(
                  "h-7 min-w-10 rounded-md px-2 font-mono text-[10px] font-semibold transition-colors",
                  selected
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {step.day}
              </button>
            );
          })}
        </div>
        <div className="mt-2 border-t pt-2">
          <span className="text-[10px] text-muted-foreground">全路径资料类型</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {pathResourceTypes.map((type) => {
              const Icon = AGENT_ICONS[type];
              return (
                <span key={`path-type-${type}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                  <Icon className="size-2.5" style={{ color: AGENT_MAP[type].color }} />
                  {AGENT_MAP[type].name.replace(/家|师|官|导演|教练/g, "")}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {selectedStep && plan && (
        <motion.div
          key={selectedStep.day}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          className="rounded-lg border bg-card p-3.5"
        >
          <div className="flex items-start gap-2.5">
            <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[10px] font-semibold text-background">
              {selectedStep.day}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold">
                  {selectedIndex === currentIndex ? "今天任务" : `${selectedStep.day} 任务`}
                </span>
                {selectedIndex === currentIndex && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-danger">
                    <span className="size-1 rounded-full bg-danger" />
                    今天
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                <Target className="mt-0.5 size-3 shrink-0 text-primary" />
                <span>目标：{plan.objective}</span>
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <div className="rounded-md bg-muted px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock3 className="size-3" />
                预计
              </div>
              <div className="mt-0.5 font-mono text-[12px] font-semibold">
                {plan.totalMinutes} 分钟
              </div>
            </div>
            <div className="rounded-md bg-muted px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Flag className="size-3" />
                任务
              </div>
              <div className="mt-0.5 font-mono text-[12px] font-semibold">
                {plan.taskCount} 个任务
              </div>
            </div>
            <div className="rounded-md bg-muted px-2 py-1.5">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <FileText className="size-3" />
                资料
              </div>
              <div className="mt-0.5 font-mono text-[12px] font-semibold">
                {plan.resourceCount} 份
              </div>
            </div>
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.round(progressRatio * 100)}%` }}
            />
          </div>

          {nextTask && nextResource && onOpenResource && (
            <button
              type="button"
              onClick={() => onOpenResource(nextResource, nextTask.key)}
              className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <PlayCircle className="size-3.5" />
              {selectedIndex === currentIndex ? "开始今天任务" : `继续 ${selectedStep.day}`}
            </button>
          )}

          <div className="mt-3 space-y-2">
            {plan.tasks.map((task, taskIndex) => {
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
                  key={task.key}
                  className={cn(
                    "rounded-lg border bg-surface-2/35 p-2.5 transition-colors",
                    task.completed && "border-success/30 bg-success/10"
                  )}
                >
                <div className="flex items-start gap-2">
                  <span
                    aria-label={task.completed ? "已由学习行为完成" : "等待真实学习行为"}
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                      task.completed ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {task.completed ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      <Circle className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                        {task.action}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                        {task.title}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {task.minutes} 分钟
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {task.detail}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {resolvedTargets.map(({ target, resource: taskResource }) => {
                          const action = getDailyTaskResourceAction(target.type);
                          if (taskResource && onOpenResource) {
                            return (
                              <button
                                key={`${task.key}-${target.key}`}
                                type="button"
                                onClick={() => onOpenResource(taskResource, task.key)}
                                className="rounded-md border bg-card px-2 py-1 text-[10px] font-medium text-primary hover:bg-accent"
                              >
                                {action.label}
                              </button>
                            );
                          }
                          return null;
                        })}
                      {missingExactTarget && !hasReadyTarget && (
                        <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                          资料审核完成后自动出现
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        完成标准：{task.standard}
                      </span>
                    </div>
                    {needsWrittenEvidence && (
                      <CompactEvidenceForm task={task} onSubmit={onRecordEvidence} />
                    )}
                    {isReviewTask && (
                      <Link
                        href={reflectionHref(selectedStep.day, task.key, "master")}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <BookOpenCheck className="size-3" />
                        {task.completed ? "再次查看复盘工作台" : "进入复盘工作台"}
                      </Link>
                    )}
                    {task.resourceTypes.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {task.resourceTypes.map((type) => {
                          const Icon = AGENT_ICONS[type];
                          return (
                            <span
                              key={`${task.key}-${type}`}
                              className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              <Icon
                                className="size-2.5"
                                style={{ color: AGENT_MAP[type].color }}
                              />
                              {AGENT_MAP[type].name.replace(/家|师|官/g, "")}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {taskIndex + 1}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
