import type { LearningPathConfirmation } from "./learning-path-confirmation.ts";

export type LearningPathRunStage = "confirming" | "planning" | "needs_action" | "blocked" | "planning_error";
export interface LearningPathRunState {
  version: 1;
  request: string;
  /** Conversation that owns the clarification card and streamed public trace. */
  conversationId?: string;
  confirmation?: LearningPathConfirmation;
  stage: LearningPathRunStage;
  traceMessageId?: string;
  /** Server-owned plan identity used to reconnect instead of creating a duplicate plan. */
  planId?: string;
  clarificationSummary?: string;
  attempt?: number;
  error?: { code?: string; message: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown };
  savedAt: number;
}

export function beginPlanning(state: LearningPathRunState, confirmation: LearningPathConfirmation): LearningPathRunState {
  return {
    ...state,
    confirmation,
    stage: "planning",
    attempt: Math.max(1, state.attempt ?? 1),
    error: undefined,
    savedAt: Date.now(),
  };
}
export function failPlanning(state: LearningPathRunState, error: NonNullable<LearningPathRunState["error"]>): LearningPathRunState {
  return { ...state, stage: error.code === "cancelled" ? "blocked" : "needs_action", error, savedAt: Date.now() };
}
export function editPlanning(state: LearningPathRunState): LearningPathRunState {
  return { ...state, stage: "confirming", error: undefined, savedAt: Date.now() };
}
export function canCancelPlanning(state: LearningPathRunState | null): boolean {
  return state?.stage !== "planning";
}
export function restoreLearningPathRun(raw: string | null, now = Date.now()): LearningPathRunState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as LearningPathRunState;
    if (value.version !== 1 || !value.request || !Number.isFinite(value.savedAt) || now - value.savedAt > 30 * 60_000) return null;
    return value.confirmation && value.stage === "planning"
      ? { ...value, stage: "planning", error: undefined }
      : { ...value, stage: value.stage === "blocked" ? "blocked" : value.stage === "needs_action" || value.stage === "planning_error" ? "needs_action" : "confirming", error: value.error };
  } catch { return null; }
}
