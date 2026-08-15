import type { PathStep } from "./types.ts";

export function localDateKey(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function addLocalDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + amount);
  return next;
}

export function pathScheduleSignature(path: PathStep[]): string {
  return JSON.stringify(path.map((step) => ({
    day: step.day,
    title: step.title,
    desc: step.desc,
    tasks: (step.steps ?? []).map((task) => task.title),
  })));
}

function localDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = Date.UTC(year, month - 1, day) / 86_400_000;
  return Number.isFinite(result) ? result : null;
}

export function pathScheduleCurrentIndex(
  path: PathStep[],
  anchorDate?: string,
  today = new Date(),
): number {
  if (path.length === 0) return -1;
  const explicitCurrent = path.findIndex((step) => step.state === "current");
  const baseIndex = explicitCurrent >= 0 ? explicitCurrent : 0;
  const anchorDay = anchorDate ? localDayNumber(anchorDate) : null;
  const todayDay = localDayNumber(localDateKey(today));
  const elapsed = anchorDay !== null && todayDay !== null
    ? Math.max(0, todayDay - anchorDay)
    : 0;
  return Math.min(path.length - 1, baseIndex + elapsed);
}

export function localDateFromTimestamp(timestamp?: number): string {
  const date = typeof timestamp === "number" ? new Date(timestamp) : new Date();
  return Number.isFinite(date.getTime()) ? localDateKey(date) : localDateKey();
}
