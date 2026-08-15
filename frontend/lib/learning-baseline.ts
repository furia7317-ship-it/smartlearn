export type LearningLevel = "novice" | "basic" | "intermediate" | "advanced" | "custom";
export type LearningBaselineSource = "diagnostic" | "self_report" | "existing_profile" | "explicit_default";
export interface LearningBaseline { source: LearningBaselineSource; level: LearningLevel; confidence: number; summary: string; strengths?: string[]; gaps?: string[]; mastery?: Record<string, unknown>; custom_description?: string; explicit_default_confirmed?: boolean; }

export const MULTI_DAY_MARKERS = ["学习路径", "学习计划", "每天", "天计划", "周计划"] as const;
export function wantsLearningPath(text: string): boolean { return MULTI_DAY_MARKERS.some((marker) => text.includes(marker)); }
export function needsLearningBaseline(text: string): boolean { return wantsLearningPath(text); }
export function isValidLearningBaseline(value: Partial<LearningBaseline> | null | undefined): value is LearningBaseline {
  if (!value || !value.source || !value.level) return false;
  if (value.source === "explicit_default") return value.explicit_default_confirmed === true;
  if (value.source === "self_report" && value.level === "custom") return (value.custom_description ?? "").trim().length >= 4;
  return true;
}
export function baselineFromAssessment(overall: number, mastery: Record<string, unknown> = {}, questionCount = 0): LearningBaseline {
  const level: LearningLevel = overall < .4 ? "novice" : overall < .65 ? "basic" : overall < .8 ? "intermediate" : "advanced";
  const entries = Object.entries(mastery).filter(([, v]) => typeof v === "number");
  return { source: "diagnostic", level, confidence: Math.min(.9, Math.max(.2, questionCount / 8)), summary: "客观摸底结果", strengths: entries.filter(([,v]) => Number(v) >= .65).map(([k])=>k), gaps: entries.filter(([,v]) => Number(v) < .65).map(([k])=>k), mastery };
}
