"use client";

import {
  BellRing,
  BookOpenCheck,
  Check,
  Clock3,
  Gauge,
  LoaderCircle,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";

import { useLearnerPreferences } from "@/hooks/use-learner-preferences";
import { MATERIAL_TYPES } from "@/lib/material-types";
import { cn } from "@/lib/utils";

const TEACHING_MODES = [
  { id: "direct", label: "直接讲解", detail: "先给结论，再解释关键步骤" },
  { id: "socratic", label: "启发式提问", detail: "通过问题引导你自己推导" },
  { id: "practice", label: "边讲边练", detail: "短讲解后立即安排练习" },
] as const;

const ANSWER_DEPTHS = [
  { id: "concise", label: "简洁" },
  { id: "balanced", label: "标准" },
  { id: "deep", label: "深入" },
] as const;

const DIFFICULTIES = [
  { id: "foundation", label: "基础" },
  { id: "balanced", label: "适中" },
  { id: "challenge", label: "挑战" },
] as const;

export function LearningPreferencesSettings() {
  const { preferences, loading, saving, error, updatePreferences } = useLearnerPreferences();
  const disabled = loading || saving;

  const toggleMaterial = (type: string) => {
    const selected = preferences.material_types.includes(type)
      ? preferences.material_types.filter((item) => item !== type)
      : [...preferences.material_types, type];
    if (selected.length === 0) return;
    void updatePreferences({ material_types: selected });
  };

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start gap-3">
        <Sparkles className="mt-0.5 size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">AI 教学与学习偏好</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">这些默认值会直接用于智能教师回答和学习路径规划，并保存在 SQLite。</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          {loading || saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5 text-success" />}
          {loading ? "读取中" : saving ? "保存中" : "设置已生效"}
        </span>
      </div>

      {error && <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">{error}</p>}

      <div className="mt-5 space-y-6">
        <fieldset disabled={disabled}>
          <legend className="flex items-center gap-1.5 text-xs font-semibold">
            <MessageCircleQuestion className="size-3.5 text-primary" />
            教学方式
          </legend>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {TEACHING_MODES.map((item) => {
              const active = preferences.teaching_mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void updatePreferences({ teaching_mode: item.id })}
                  className={cn(
                    "rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60",
                    active ? "border-primary bg-primary/[0.08]" : "bg-surface-2/30 hover:border-primary/35",
                  )}
                >
                  <strong className="block text-xs">{item.label}</strong>
                  <span className="mt-1 block text-xs text-muted-foreground">{item.detail}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset disabled={disabled}>
            <legend className="flex items-center gap-1.5 text-xs font-semibold">
              <BookOpenCheck className="size-3.5 text-primary" />
              回答详细度
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {ANSWER_DEPTHS.map((item) => (
                <button key={item.id} type="button" aria-pressed={preferences.answer_depth === item.id} onClick={() => void updatePreferences({ answer_depth: item.id })} className={cn("h-10 rounded-lg border text-xs font-medium disabled:opacity-60", preferences.answer_depth === item.id ? "border-primary bg-primary/[0.08]" : "bg-surface-2/30 hover:border-primary/35")}>{item.label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={disabled}>
            <legend className="flex items-center gap-1.5 text-xs font-semibold">
              <Gauge className="size-3.5 text-primary" />
              默认难度
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DIFFICULTIES.map((item) => (
                <button key={item.id} type="button" aria-pressed={preferences.difficulty === item.id} onClick={() => void updatePreferences({ difficulty: item.id })} className={cn("h-10 rounded-lg border text-xs font-medium disabled:opacity-60", preferences.difficulty === item.id ? "border-primary bg-primary/[0.08]" : "bg-surface-2/30 hover:border-primary/35")}>{item.label}</button>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset disabled={disabled}>
          <legend className="flex items-center gap-1.5 text-xs font-semibold">
            <Clock3 className="size-3.5 text-primary" />
            每日学习时长
          </legend>
          <p className="mt-1 text-xs text-muted-foreground">生成学习路径时会默认采用这个时长，当前请求明确指定时除外。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {([20, 40, 60, 90] as const).map((minutes) => (
              <button key={minutes} type="button" aria-pressed={preferences.daily_minutes === minutes} onClick={() => void updatePreferences({ daily_minutes: minutes })} className={cn("h-10 min-w-24 rounded-lg border px-3 text-xs font-medium disabled:opacity-60", preferences.daily_minutes === minutes ? "border-primary bg-primary/[0.08]" : "bg-surface-2/30 hover:border-primary/35")}>{minutes} 分钟</button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={disabled}>
          <legend className="flex items-center gap-1.5 text-xs font-semibold">
            <BookOpenCheck className="size-3.5 text-primary" />
            偏好资料类型
          </legend>
          <p className="mt-1 text-xs text-muted-foreground">至少保留一种；规划学习路径时会直接使用这些默认类型。</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MATERIAL_TYPES.map((item) => {
              const active = preferences.material_types.includes(item.id);
              return (
                <button key={item.id} type="button" aria-pressed={active} onClick={() => toggleMaterial(item.id)} className={cn("rounded-lg border px-3 py-2.5 text-left disabled:opacity-60", active ? "border-primary bg-primary/[0.08]" : "bg-surface-2/30 hover:border-primary/35")}>
                  <span className="flex items-center justify-between gap-2">
                    <strong className="text-xs">{item.label}</strong>
                    {active && <Check className="size-3.5 text-primary" />}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.desc}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="rounded-xl border bg-surface-2/25 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <BellRing className="size-4 text-primary" />
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-semibold">每日学习提醒</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">到点后在应用内提醒；关闭软件时不会在后台打扰。</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={preferences.reminder_enabled}
              disabled={disabled}
              onClick={() => void updatePreferences({ reminder_enabled: !preferences.reminder_enabled })}
              className={cn("relative h-7 w-12 rounded-full transition-colors disabled:opacity-60", preferences.reminder_enabled ? "bg-primary" : "bg-muted")}
            >
              <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow-sm transition-transform", preferences.reminder_enabled ? "translate-x-6" : "translate-x-1")} />
              <span className="sr-only">{preferences.reminder_enabled ? "关闭学习提醒" : "开启学习提醒"}</span>
            </button>
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              提醒时间
              <input
                type="time"
                value={preferences.reminder_time}
                disabled={disabled || !preferences.reminder_enabled}
                onInput={(event) => void updatePreferences({ reminder_time: event.currentTarget.value })}
                className="h-10 rounded-lg border bg-card px-3 text-sm disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
