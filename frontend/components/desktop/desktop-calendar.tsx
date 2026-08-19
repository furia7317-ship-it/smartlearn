"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ListChecks } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link } from "@/components/shell-link";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import { addLocalDays, buildLearningSchedule, localDateKey } from "@/lib/learning-schedule";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function monthCells(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const start = addLocalDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addLocalDays(start, index));
}

export default function DesktopCalendar() {
  const { path, pathScheduleAnchor, completedMaterials, hydrated } = useOrchestratorContext();
  const [anchor] = useState(() => new Date());
  const [monthKey, setMonthKey] = useDesktopModuleStringState<string>(
    "home",
    "calendar.month",
    localDateKey(anchor).slice(0, 7)
  );
  const [selected, setSelected] = useDesktopModuleStringState<string>(
    "home",
    "calendar.selected",
    localDateKey(anchor)
  );
  const [monthYear, monthNumber] = monthKey.split("-").map(Number);
  const month = Number.isInteger(monthYear) && monthNumber >= 1 && monthNumber <= 12
    ? new Date(monthYear, monthNumber - 1, 1, 12)
    : new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
  const schedule = useMemo(
    () => buildLearningSchedule(path, completedMaterials, pathScheduleAnchor || anchor),
    [anchor, completedMaterials, path, pathScheduleAnchor],
  );
  const byDate = new Map(schedule.map((day) => [day.date, day]));
  const selectedDay = byDate.get(selected);
  const cells = monthCells(month);

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-5 px-8 py-7">
        <header className="flex items-end justify-between gap-4">
          <div><h1 className="font-display text-2xl font-semibold">学习日程</h1><p className="mt-1 text-sm text-muted-foreground">按真实任务完成情况着色，点击日期查看当天任务</p></div>
          <Link href="/todos" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent"><ListChecks className="size-4" />今日待办</Link>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setMonthKey(localDateKey(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12)).slice(0, 7))} aria-label="上个月" className="grid size-8 place-items-center rounded-lg border hover:bg-accent"><ChevronLeft className="size-4" /></button>
              <h2 className="font-display text-lg font-semibold">{month.getFullYear()} 年 {month.getMonth() + 1} 月</h2>
              <button type="button" onClick={() => setMonthKey(localDateKey(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12)).slice(0, 7))} aria-label="下个月" className="grid size-8 place-items-center rounded-lg border hover:bg-accent"><ChevronRight className="size-4" /></button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((day) => <div key={day} className="py-2 text-center text-xs text-muted-foreground">{day}</div>)}
              {cells.map((date) => {
                const key = localDateKey(date);
                const scheduled = byDate.get(key);
                const active = selected === key;
                const currentMonth = date.getMonth() === month.getMonth();
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={`${key} ${scheduled ? `${scheduled.step.day} ${scheduled.step.title} ${scheduled.status === "completed" ? "已完成" : "未完成"}` : "无任务"}`}
                    onClick={() => setSelected(key)}
                    className={cn("min-h-20 rounded-xl border p-2 text-left transition", !currentMonth && "opacity-35", scheduled?.status === "pending" && "border-danger/45 bg-danger/[0.07] text-danger", scheduled?.status === "completed" && "border-success/45 bg-success/[0.09] text-success", !scheduled && "text-foreground hover:bg-accent", active && "ring-2 ring-primary/45")}
                  >
                    <span className="font-mono text-xs font-semibold">{date.getDate()}</span>
                    {scheduled && <><span className="mt-2 block truncate text-[11px] font-medium">{scheduled.step.day} · {scheduled.step.title}</span><span className="mt-1 block text-[10px]">{scheduled.plan.progressLabel} 完成</span></>}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-xs"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-danger" />有任务未完成</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-success" />有任务已完成</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-foreground" />没有任务</span></div>
          </section>

          <aside className="self-start rounded-2xl border bg-card p-5 lg:sticky lg:top-5">
            <div className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" /><h2 className="text-sm font-semibold">{selected} 的任务</h2></div>
            {!hydrated ? <p className="mt-4 text-sm text-muted-foreground">正在恢复日程…</p> : selectedDay ? <div className="mt-4 space-y-2">{selectedDay.plan.tasks.map((task) => <article key={task.key} className={cn("rounded-xl border p-3", task.completed && "border-success/30 bg-success/[0.07]")}><div className="flex items-center gap-2"><span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">{task.action}</span><strong className="min-w-0 flex-1 text-xs">{task.title}</strong><span className="font-mono text-[10px] text-muted-foreground">{task.minutes} 分钟</span></div><p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{task.detail}</p><span className={cn("mt-2 inline-block text-[10px]", task.completed ? "text-success" : "text-danger")}>{task.completed ? "已按真实学习记录完成" : "尚未完成"}</span></article>)}<Link href="/studio" className="mt-3 flex h-9 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground">进入智能教师完成任务</Link></div> : <p className="mt-4 rounded-xl border border-dashed px-3 py-10 text-center text-sm text-foreground">当天没有学习任务</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}
