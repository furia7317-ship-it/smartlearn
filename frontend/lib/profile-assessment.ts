import type { MasteryLevel } from "./material-types";

const MASTERY_TARGETS: Record<MasteryLevel, number> = {
  基础: 42,
  进阶: 64,
  完全掌握: 86,
};

const GENERATED_PREFIXES = [
  "摸底·",
  "掌握度·",
  "薄弱·",
  "鎽稿簳",
  "鎺屾彙",
  "钖勫急",
];

export function masteryTarget(level: MasteryLevel): number {
  return MASTERY_TARGETS[level];
}
export function mergeAssessmentTags(
  previous: string[],
  input: { subject: string; level: MasteryLevel; gaps?: string[] }
): string[] {
  const preserved = previous.filter(
    (tag) => !GENERATED_PREFIXES.some((prefix) => tag.startsWith(prefix))
  );
  return Array.from(
    new Set([
      ...preserved,
      `摸底·${input.subject}`,
      `掌握度·${input.level}`,
      ...(input.gaps ?? []).slice(0, 1).map((gap) => `薄弱·${gap}`),
    ])
  );
}
