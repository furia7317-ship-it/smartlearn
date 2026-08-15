import { buildDailyTaskPlan, type DailyTaskItem, type DailyTaskPlan } from "./daily-task-plan.ts";
import { addLocalDays, localDateKey } from "./path-schedule-clock.ts";
import type { PathStep } from "./types.ts";

export { addLocalDays, localDateKey } from "./path-schedule-clock.ts";

export type ScheduleStatus = "none" | "pending" | "completed";

export interface LearningScheduleDay {
  date: string;
  stageIndex: number;
  step: PathStep;
  plan: DailyTaskPlan;
  status: Exclude<ScheduleStatus, "none">;
}

export function buildLearningSchedule(
  path: PathStep[],
  completedKeys: string[] = [],
  anchor: Date | string = new Date(),
): LearningScheduleDay[] {
  if (path.length === 0) return [];
  const explicitCurrent = path.findIndex((step) => step.state === "current");
  const currentIndex = explicitCurrent >= 0 ? explicitCurrent : 0;
  const anchorDate = typeof anchor === "string"
    ? new Date(`${anchor}T12:00:00`)
    : anchor;
  return path.map((step, stageIndex) => {
    const plan = buildDailyTaskPlan(step, stageIndex, completedKeys);
    return {
      date: localDateKey(addLocalDays(anchorDate, stageIndex - currentIndex)),
      stageIndex,
      step,
      plan,
      status:
        plan.taskCount > 0 && plan.completedTaskCount === plan.taskCount
          ? "completed"
          : "pending",
    };
  });
}

export function pendingTasksForDate(
  schedule: LearningScheduleDay[],
  date = localDateKey(),
): DailyTaskItem[] {
  return schedule.find((day) => day.date === date)?.plan.tasks.filter((task) => !task.completed) ?? [];
}
