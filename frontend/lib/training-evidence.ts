import type { ProfileDim } from "./types";

export interface TrainingEvidence {
  id: string; taskId: string; title: string; course: string; knowledgePoints: string[];
  score: number; passedTests: number; totalTests: number; createdAt: string; stage: string;
}
export const TRAINING_EVIDENCE_CHANGED = "training-evidence-changed";

export function normalizeTrainingEvidence(input: unknown): TrainingEvidence[] {
  if (!Array.isArray(input)) return [];
  const unique = new Map<string, TrainingEvidence>();
  for (const item of input) {
    if (!item || typeof item.id !== "string" || typeof item.taskId !== "string" || typeof item.title !== "string" || typeof item.course !== "string"
      || !Array.isArray(item.knowledgePoints) || !item.knowledgePoints.every((point: unknown) => typeof point === "string")
      || !Number.isFinite(item.score) || item.score < 0 || item.score > 100
      || !Number.isInteger(item.totalTests) || item.totalTests <= 0 || !Number.isInteger(item.passedTests) || item.passedTests < 0 || item.passedTests > item.totalTests
      || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt))) continue;
    unique.set(item.id, { ...item, stage: typeof item.stage === "string" ? item.stage : "" });
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Derive from the stored base each time: reloading never applies the same attempt twice. */
export function applyTrainingProfile(profile: ProfileDim[], evidence: TrainingEvidence[]): ProfileDim[] {
  const latest = new Map<string, TrainingEvidence>();
  for (const item of normalizeTrainingEvidence(evidence)) latest.set(item.taskId, item);
  if (!latest.size) return profile;
  const score = [...latest.values()].reduce((sum, item) => sum + item.score, 0) / latest.size;
  return profile.map((dimension) => {
    if (dimension.key !== "knowledge_level") return dimension;
    const value = Math.round(dimension.value * .65 + score * .35);
    return { ...dimension, value, delta: dimension.delta + value - dimension.value };
  });
}
