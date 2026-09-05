"use client";

import { useCallback, useEffect, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  GitBranch,
  Plus,
  PlayCircle,
  Route,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { AGENT_ICONS } from "@/components/agent-bits";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PathTree } from "@/components/path-tree";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { WebSubjectPathManager } from "@/components/web/web-subject-path-manager";
import { AGENT_MAP } from "@/lib/agents";
import {
  assessmentToContext,
  deleteGoal,
  listAssessments,
  listGoals,
  saveGoal,
  type AssessmentRecord,
  type GoalRecord,
} from "@/lib/library";
import { getPathProgress } from "@/lib/session-insights";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import type { PathStep } from "@/lib/types";
import { cn } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

function StepCard({
  step,
  index,
  total,
  done,
}: {
  step: PathStep;
  index: number;
  total: number;
  done: Set<string>;
}) {
  const current = step.state === "current";
  return (
    <div className="relative flex gap-4 pb-5 last:pb-0">
      <div className="flex w-14 shrink-0 flex-col items-center">
        <span
          className={cn(
            "w-full rounded-md py-1 text-center font-mono text-xs font-semibold tabular-nums",
            current ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
          )}
        >
          {step.day}
        </span>
        {index < total - 1 && <span className="mt-1.5 w-px flex-1 bg-border" />}
      </div>

      <div className={cn("flex-1 rounded-xl border bg-card p-4", current && "border-primary/40")}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">
            {current ? "今天 · " : ""}
            {step.title}
          </h3>
          {current && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-danger">
              <span className="size-1.5 rounded-full bg-danger" />
              今天
            </span>
          )}
          {step.minutes && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {step.minutes} 分钟
            </span>
          )}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            阶段 {index + 1}/{total}
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
        {step.steps && step.steps.length > 0 && (
          <ol className="mt-3 space-y-2 rounded-lg border bg-surface-2/40 p-3">
            {step.steps.map((task, taskIndex) => (
              <li key={`${task.title}-${taskIndex}`} className="flex gap-2 text-[12px] leading-relaxed">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                  {taskIndex + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{task.title}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {task.minutes} 分钟
                    </span>
                  </div>
                  <p className="text-muted-foreground">{task.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {step.types.map((t, ti) => {
            const Icon = AGENT_ICONS[t];
            const isDone = done.has(`${index}:${t}`);
            return (
              <span
                key={`${t}-${ti}`}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                  isDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                )}
              >
                {isDone ? (
                  <Check className="size-3" />
                ) : (
                  <Icon className="size-3" style={{ color: AGENT_MAP[t].color }} />
                )}
                {AGENT_MAP[t].name.replace(/官|师|教练|导演/g, "")}
              </span>
            );
          })}
          <Link
            href="/resources"
            className="ml-auto flex items-center gap-0.5 text-[11px] text-primary hover:underline"
          >
            挂载资源
            <ArrowUpRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── 学习目标区：当前目标 + 新增目标 ── */

function GoalsSection({ mode }: { mode: OrchestratorMode }) {
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
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5">
        <Target className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">学习目标</h2>
        <span className="text-[11px] text-muted-foreground">{goals.length} 个目标</span>
        <Button
          size="sm"
          variant={open ? "ghost" : "outline"}
          className="ml-auto h-7 gap-1"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {open ? "取消" : "新增目标"}
        </Button>
      </div>

      {/* 新增目标表单 */}
      {open && (
        <div className="mt-3 space-y-3 rounded-lg border bg-surface-2/40 p-3.5">
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">学习目标</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：两周内掌握动态规划，期中拿到 85+"
              className={cn(inputCls, "mt-1")}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <label className="text-[12px] font-medium text-muted-foreground">当前状态</label>
              {assessments.length > 0 && (
                <select
                  onChange={(e) => {
                    if (e.target.value) importAssessment(e.target.value);
                    e.target.value = "";
                  }}
                  className="ml-auto h-6 rounded-md border bg-transparent px-1.5 text-[11px] outline-none"
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
              <label className="text-[12px] font-medium text-muted-foreground">开始日期（选填）</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={cn(inputCls, "mt-1")}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">不填默认今天</p>
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">结束日期</label>
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

      {/* 当前目标列表 */}
      {goals.length > 0 ? (
        <div className="mt-3 space-y-2">
          {goals.map((g) => (
            <div key={g.id} className="group rounded-lg border bg-surface-2/40 p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13px] font-semibold">{g.title}</h3>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px]",
                        g.status === "completed"
                          ? "bg-success/15 text-success"
                          : "bg-primary/10 text-primary"
                      )}
                    >
                      {g.status === "completed" ? "已完成" : "进行中"}
                    </span>
                  </div>
                  {g.description && (
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                      {g.description}
                    </p>
                  )}
                  {(g.start_date || g.target_date) && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <CalendarDays className="size-3" />
                      {g.start_date || "今天"} → {g.target_date || "未设结束日期"}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => remove(g.id)}
                  aria-label="删除目标"
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !open && (
          <p className="mt-3 rounded-lg border border-dashed px-3 py-4 text-center text-[12px] text-muted-foreground">
            还没有学习目标。点「新增目标」设定一个，可导入摸底数据或自然语言描述当前状态。
          </p>
        )
      )}
    </section>
  );
}

export default function PathPage() {
  const { hydrated, mode, masterPath, subjectPaths, resources, tags, planReason, adjustments, completedMaterials, watchedVideos, toggleMaterial } =
    useOrchestratorContext((state) => ({
      hydrated: state.hydrated,
      mode: state.mode,
      masterPath: state.masterPath,
      subjectPaths: state.subjectPaths,
      resources: state.resources,
      tags: state.tags,
      planReason: state.planReason,
      adjustments: state.adjustments,
      completedMaterials: state.completedMaterials,
      watchedVideos: state.watchedVideos,
      toggleMaterial: state.toggleMaterial,
    }));
  const path = masterPath;
  const progress = getPathProgress(path);
  const readyResources = resources.filter((resource) => resource.status === "ready").length;
  const doneSet = new Set(completedMaterials);

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader title="总学习路径" desc="统筹所有已启用科目的每日学习安排；未启用科目不会占用计划时间">
          {path.length > 0 && (
            <>
              <span className="font-mono text-xs font-semibold tabular-nums text-danger">
                阶段 {progress.currentPosition}/{progress.total}
              </span>
              <Link
                href="/path/study"
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                进入学习
                <ArrowUpRight className="size-3.5" />
              </Link>
            </>
          )}
        </PageHeader>

        {/* 学习目标：当前目标 + 新增目标（不依赖路径是否存在） */}
        <GoalsSection mode={mode} />

        {!hydrated ? (
          <div className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
            正在恢复学习路径…
          </div>
        ) : path.length === 0 ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <EmptyState
              icon={Route}
              title={subjectPaths.length > 0 ? "总学习路径尚未启用" : "还没有科目学习路径"}
              desc={subjectPaths.length > 0
                ? "在右侧为科目设置启用日期；启用后，系统会把各科目的任务统一编排到总学习路径。"
                : "先生成一条独立科目路径，再决定什么时候交给总学习路径统筹。"}
            />
            <WebSubjectPathManager />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8">
              <div className="rounded-xl border bg-card p-4">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Link href="/path/study" className="text-sm font-semibold hover:text-primary">
                    总学习路径
                  </Link>
                  <span className="text-[11px] text-muted-foreground">
                    {path.length} 个阶段 · {readyResources} 项过审资源已挂载
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${progress.ratio * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {Math.round(progress.ratio * 100)}%
                    </span>
                  </div>
                </div>
                {path.map((s, i) => (
                  <StepCard key={`${s.day}-${s.title}`} step={s} index={i} total={path.length} done={doneSet} />
                ))}
              </div>
            </div>

            <div className="min-w-0 space-y-4 lg:col-span-4">
              <WebSubjectPathManager />
              <section className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-1.5">
                  <GitBranch className="size-3.5 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">路径生成依据</h2>
                </div>
                <div className="mt-3 space-y-3 text-[12px] leading-relaxed text-muted-foreground">
                  {planReason && <p>{planReason}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <span key={tag} className="rounded-md bg-muted px-2 py-1 text-[11px]">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p>{readyResources} 项过审资源已按阶段挂载，继续测验后可再调整路径。</p>
                  {adjustments.length > 0 && (
                    <div className="divide-y rounded-lg border px-3">
                      {adjustments.slice(0, 3).map((adjustment) => (
                        <div key={adjustment.id} className="py-2.5">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className="font-medium text-primary">测评反馈</span>
                            <span className="ml-auto font-mono">{adjustment.score} 分</span>
                          </div>
                          <p className="mt-1 text-[12px] text-foreground/85">{adjustment.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* 学习资料树状图：完成资料点对号 → 节点变绿 */}
              <PathTree
                path={path}
                completed={completedMaterials}
                onToggle={toggleMaterial}
                title="总学习路径"
              />
              {watchedVideos.length > 0 && (
                <section className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-1.5">
                    <PlayCircle className="size-3.5 text-primary" />
                    <h2 className="text-sm font-semibold">视频学习记录</h2>
                    <span className="text-[11px] text-muted-foreground">
                      {watchedVideos.length} 个视频
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {watchedVideos.slice(0, 5).map((video) => (
                      <div key={video.bvid} className="rounded-lg border bg-surface-2/40 p-3">
                        <div className="flex items-start gap-2">
                          <PlayCircle className="mt-0.5 size-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-semibold">{video.title}</div>
                            {video.learning_summary && (
                              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                                {video.learning_summary}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                              <Link href="/video-learning" className="text-primary hover:underline">
                                回到视频学习
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
