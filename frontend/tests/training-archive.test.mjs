import test from "node:test";
import assert from "node:assert/strict";
import { mergeTrainingState, updateTrainingDraft, appendTrainingRun } from "../lib/training.ts";

test("sync keeps the newer draft and merges distinct runs from both devices", () => {
  const older = "2026-09-07T10:00:00Z", newer = "2026-09-07T11:00:00Z";
  const run = { id: "r1", taskId: "circular-queue", code: "old", kind: "run", stdout: "", error: null, durationMs: 12, passed: false, createdAt: older };
  const local = updateTrainingDraft(appendTrainingRun({}, run), "circular-queue", "new draft", newer, "java");
  const remote = appendTrainingRun(updateTrainingDraft({}, "bracket-matching", "other", older), { ...run, id: "r2" });
  const merged = mergeTrainingState(local, remote);
  assert.equal(merged["circular-queue"].code, "new draft");
  assert.equal(merged["circular-queue"].language, "java");
  assert.equal(merged["circular-queue"].runs.length, 2);
  assert.equal(merged["bracket-matching"].code, "other");
  assert.deepEqual(mergeTrainingState(merged, remote), merged);
});
