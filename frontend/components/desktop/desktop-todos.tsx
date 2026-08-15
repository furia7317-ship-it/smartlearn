"use client";

import { CalendarDays, CheckCircle2, Circle, ClipboardList } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link } from "@/components/shell-link";
import { buildLearningSchedule, localDateKey, pendingTasksForDate } from "@/lib/learning-schedule";

export default function DesktopTodos() {
  const { path, completedMaterials, hydrated } = useOrchestratorContext();
  const today = localDateKey();
  const schedule = buildLearningSchedule(path, completedMaterials);
  const tasks = pendingTasksForDate(schedule, today);
  const day = schedule.find((item) => item.date === today);

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] space-y-5 px-8 py-7">
        <header className="flex items-end justify-between gap-4"><div><h1 className="font-display text-2xl font-semibold">今日待办</h1><p className="mt-1 text-sm text-muted-foreground">只显示今天尚未完成的学习任务，完成状态由阅读后的测验、交卷和学习产出自动判定</p></div><Link href="/calendar" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"><CalendarDays className="size-4" />查看日历</Link></header>
        <section className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2"><ClipboardList className="size-4 text-primary" /><h2 className="text-sm font-semibold">{today}</h2>{day && <span className="text-xs text-muted-foreground">{day.step.day} · {day.step.title}</span>}<span className="ml-auto font-mono text-xs text-muted-foreground">{tasks.length} 项未完成</span></div>
          {!hydrated ? <p className="mt-5 text-sm text-muted-foreground">正在恢复待办…</p> : tasks.length > 0 ? <div className="mt-4 space-y-3">{tasks.map((task, index) => <article key={task.key} className="rounded-xl border bg-surface-2/30 p-4"><div className="flex items-start gap-3"><Circle className="mt-0.5 size-4 shrink-0 text-danger" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">{task.action}</span><h3 className="text-sm font-semibold">{task.title}</h3><span className="font-mono text-xs text-muted-foreground">{task.minutes} 分钟</span></div><p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{task.detail}</p><p className="mt-2 text-xs text-danger">完成标准：{task.standard}</p></div><span className="font-mono text-xs text-muted-foreground">{index + 1}</span></div></article>)}<Link href="/studio" className="mt-2 flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">去完成今天的任务</Link></div> : <div className="mt-5 rounded-xl border border-success/30 bg-success/[0.07] px-4 py-10 text-center"><CheckCircle2 className="mx-auto size-7 text-success" /><h3 className="mt-2 text-sm font-semibold">今天没有未完成任务</h3><p className="mt-1 text-xs text-muted-foreground">新路径任务出现后会自动进入这里，无需手工勾选。</p></div>}
        </section>
      </div>
    </div>
  );
}
