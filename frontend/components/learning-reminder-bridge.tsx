"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Clock3, X } from "lucide-react";
import { usePathname } from "next/navigation";

import { useLearnerPreferences } from "@/hooks/use-learner-preferences";

const DISMISSED_KEY = "xueshu-learning-reminder-dismissed";
const SNOOZE_KEY = "xueshu-learning-reminder-snooze";

function localDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function reminderIsDue(reminderTime: string, now = new Date()): boolean {
  const [hours, minutes] = reminderTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}

export function LearningReminderBridge() {
  const pathname = usePathname();
  const { preferences, loading } = useLearnerPreferences();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const checkReminder = () => {
      if (loading || !preferences.reminder_enabled) {
        setVisible(false);
        return;
      }
      const now = new Date();
      const dismissed = localStorage.getItem(DISMISSED_KEY) === localDateKey(now);
      const snoozedUntil = Number(sessionStorage.getItem(SNOOZE_KEY) || 0);
      setVisible(!dismissed && Date.now() >= snoozedUntil && reminderIsDue(preferences.reminder_time, now));
    };
    checkReminder();
    const timer = window.setInterval(checkReminder, 30_000);
    return () => window.clearInterval(timer);
  }, [loading, preferences.reminder_enabled, preferences.reminder_time]);

  if (!visible) return null;
  const startHref = pathname?.startsWith("/desktop")
    ? "/desktop/todos"
    : "/path";

  const dismissToday = () => {
    localStorage.setItem(DISMISSED_KEY, localDateKey());
    setVisible(false);
  };

  return (
    <aside className="fixed bottom-5 right-5 z-[90] w-[min(380px,calc(100vw-40px))] rounded-xl border bg-card p-4 shadow-2xl" aria-label="每日学习提醒" role="status">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">到今天的学习时间了</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">按你的设置，今天先完成一小段任务，保持学习节奏。</p>
        </div>
        <button type="button" onClick={dismissToday} aria-label="今天不再提醒" title="今天不再提醒" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(SNOOZE_KEY, String(Date.now() + 30 * 60_000));
            setVisible(false);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent"
        >
          <Clock3 className="size-3.5" />
          30 分钟后提醒
        </button>
        <Link href={startHref} onClick={dismissToday} className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
          开始学习
        </Link>
      </div>
    </aside>
  );
}
