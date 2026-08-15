import assert from "node:assert/strict";
import test from "node:test";
import { beginPlanning, canCancelPlanning, editPlanning, failPlanning, restoreLearningPathRun } from "../lib/learning-path-run-state.ts";

const confirmation = { baseline: { source: "explicit_default", level: "basic", confidence: 1, summary: "x", explicit_default_confirmed: true }, preferences: { goal: "starter", days: 14, daily_minutes: 60, material_types: ["explainer"] } };

test("learning path run transitions failure edit retry and success-ready state", () => {
  const initial = { version: 1, request: "数据结构", stage: "confirming", savedAt: 1 };
  const planning = beginPlanning(initial, confirmation);
  assert.equal(planning.stage, "planning");
  assert.equal(canCancelPlanning(planning), false);
  const failed = failPlanning(planning, { code: "kb_miss", message: "miss", actions: ["open_kb"] });
  assert.equal(failed.stage, "needs_action");
  const edited = editPlanning(failed);
  assert.equal(edited.stage, "confirming");
  assert.equal(edited.error, undefined);
  assert.equal(beginPlanning(edited, confirmation).stage, "planning");
});

test("learning path persistence restores confirmation, request-only, and rejects stale or corrupt data", () => {
  const now = 10_000;
  const restored = restoreLearningPathRun(JSON.stringify({ version: 1, request: "数据结构", confirmation, stage: "planning_error", error: { message: "old" }, savedAt: now - 1 }), now);
  assert.equal(restored?.stage, "needs_action");
  assert.deepEqual(restored?.confirmation, confirmation);
  assert.equal(restoreLearningPathRun(JSON.stringify({ version: 1, request: "x", savedAt: now - 1_800_001 }), now), null);
  assert.equal(restoreLearningPathRun("bad", now), null);
});

test("an in-flight confirmed plan restores directly into automatic planning", () => {
  const now = 10_000;
  const restored = restoreLearningPathRun(JSON.stringify({
    version: 1,
    request: "数据结构",
    confirmation,
    stage: "planning",
    attempt: 3,
    traceMessageId: "trace-1",
    planId: "plan-1",
    savedAt: now - 1,
  }), now);
  assert.equal(restored?.stage, "planning");
  assert.equal(restored?.attempt, 3);
  assert.equal(restored?.traceMessageId, "trace-1");
  assert.equal(restored?.planId, "plan-1");
});

test("planning state blocks cancellation until the request reaches a recoverable state", () => {
  const state = beginPlanning({ version: 1, request: "数据结构", stage: "confirming", savedAt: 1 }, confirmation);
  assert.equal(canCancelPlanning(state), false);
  assert.equal(canCancelPlanning(failPlanning(state, { message: "失败" })), true);
});
