"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { OrchestratorMode } from "@/hooks/use-orchestrator";
import {
  deleteGoal,
  listGoals,
  saveGoal,
  type GoalRecord,
} from "@/lib/library";
import { cn } from "@/lib/utils";

const HORIZONS = [
  { id: "long", label: "长期目标", hint: "半年及以上" },
  { id: "mid", label: "中期目标", hint: "一个月至半年" },
  { id: "short", label: "短期目标", hint: "一个月以内" },
] as const;

type GoalHorizon = NonNullable<GoalRecord["horizon"]>;

function localDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function suggestedTargetDate(horizon: GoalHorizon, start = localDateKey()): string {
  const date = new Date(`${start}T12:00:00`);
  date.setDate(date.getDate() + (horizon === "short" ? 14 : horizon === "mid" ? 90 : 365));
  return localDateKey(date);
}

export function LearningGoalsSettings({ mode }: { mode: OrchestratorMode }) {
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [horizon, setHorizon] = useState<GoalHorizon>("short");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const refresh = useCallback(() => {
    if (mode === "checking") return;
    listGoals(mode).then(setGoals).catch(() => setGoals([]));
  }, [mode]);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const openForm = () => {
    const today = localDateKey();
    setStart(today);
    setEnd(suggestedTargetDate(horizon, today));
    setOpen(true);
  };

  const submit = async () => {
    if (!title.trim() || saving || mode !== "live") return;
    setSaving(true);
    try {
      await saveGoal(mode, {
        title: title.trim(),
        description: description.trim(),
        start_date: start || localDateKey(),
        target_date: end || null,
        horizon,
      });
      setTitle("");
      setDescription("");
      setStart("");
      setEnd("");
      setHorizon("short");
      setOpen(false);
      setExpanded(true);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string | number) => {
    setGoals((current) => current.filter((goal) => goal.id !== id));
    await deleteGoal(mode, id);
  };

  const disabledReason = mode !== "live"
    ? "连接本地学习服务后才能保存目标。"
    : !title.trim()
      ? "填写目标内容后即可保存。"
      : "";

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Target className="mt-0.5 size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">学习目标</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            目标按周期保存，并供学习路径和智能教师持续使用。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "收起目标" : "查看目标"}
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1.5" onClick={openForm}>
          <Plus className="size-3.5" />
          新增目标
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {HORIZONS.map((group) => {
          const count = goals.filter((goal) => (goal.horizon || "short") === group.id).length;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-lg border bg-surface-2/30 p-3 text-left transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex items-center justify-between gap-2">
                <strong className="text-xs">{group.label}</strong>
                <span className="font-mono text-sm font-semibold text-primary">{count}</span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{group.hint}</span>
            </button>
          );
        })}
      </div>

      {expanded && (
        goals.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {HORIZONS.map((group) => {
              const items = goals.filter((goal) => (goal.horizon || "short") === group.id);
              return (
                <div key={group.id}>
                  <div className="flex items-center justify-between">
                    <strong className="text-xs">{group.label}</strong>
                    <span className="text-xs text-muted-foreground">{items.length} 项</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {items.length > 0 ? items.map((goal) => (
                      <article key={goal.id} className="group rounded-lg border bg-surface-2/20 p-3">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xs font-semibold leading-relaxed">{goal.title}</h3>
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarDays className="size-3" />
                              {goal.start_date || "今天"} → {goal.target_date || "持续推进"}
                            </p>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(goal.progress * 100)}%` }} />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void remove(goal.id)}
                            aria-label={`删除目标：${goal.title}`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-70 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </article>
                    )) : (
                      <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">暂无</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed px-4 py-4 text-center text-xs text-muted-foreground">
            还没有学习目标。新增一个目标后，智能教师会据此安排后续学习。
          </p>
        )
      )}

      {open && (
        <div
          className="fixed inset-0 z-[80] flex justify-end bg-black/35 backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-goal-title"
            className="thin-scroll h-full w-full max-w-[540px] overflow-y-auto border-l bg-background shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex items-start gap-3 border-b bg-background/95 px-6 py-5 backdrop-blur">
              <Target className="mt-1 size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 id="new-goal-title" className="text-base font-semibold">新增学习目标</h2>
                <p className="mt-1 text-xs text-muted-foreground">填写目标内容，日期已经按目标周期为你预设。</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭新增目标"
                className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            <form
              className="space-y-5 p-6"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className="block text-xs font-medium text-muted-foreground">
                目标内容
                <input
                  autoFocus
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="如：本学期独立完成一个数据结构课程项目"
                  className="mt-1.5 h-11 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>

              <fieldset>
                <legend className="text-xs font-medium text-muted-foreground">目标周期</legend>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  {HORIZONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setHorizon(item.id);
                        setEnd(suggestedTargetDate(item.id, start || localDateKey()));
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        horizon === item.id ? "border-primary bg-primary/10" : "bg-card hover:border-primary/40",
                      )}
                    >
                      <strong className="block text-xs">{item.label}</strong>
                      <span className="text-xs text-muted-foreground">{item.hint}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-muted-foreground">
                  开始日期
                  <input
                    type="date"
                    value={start}
                    onChange={(event) => {
                      setStart(event.target.value);
                      setEnd(suggestedTargetDate(horizon, event.target.value || localDateKey()));
                    }}
                    className="mt-1.5 h-11 w-full rounded-lg border bg-card px-3 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  目标日期
                  <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1.5 h-11 w-full rounded-lg border bg-card px-3 text-sm" />
                </label>
              </div>

              <label className="block text-xs font-medium text-muted-foreground">
                补充说明 <span className="font-normal">（选填）</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  placeholder="当前基础、衡量标准或希望重点突破的内容"
                  className="mt-1.5 w-full resize-y rounded-lg border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>

              <div className="border-t pt-4">
                <Button type="submit" disabled={Boolean(disabledReason) || saving} className="h-11 w-full gap-1.5">
                  <Check className="size-4" />
                  {saving ? "保存中…" : "保存并写入学习记忆"}
                </Button>
                {disabledReason && <p className="mt-2 text-center text-xs text-muted-foreground">{disabledReason}</p>}
              </div>
            </form>
          </aside>
        </div>
      )}
    </section>
  );
}
