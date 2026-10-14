import assert from "node:assert/strict";
import test from "node:test";
import { CODE_LANGUAGES } from "../lib/code-languages.ts";
import { updateTrainingDraft, parseTrainingState, appendTrainingRun, getTrainingStatus } from "../lib/training.ts";

test("switching languages preserves separate code and stdin across reloads", () => {
  const now = "2026-09-07T01:00:00.000Z";
  let state = updateTrainingDraft({}, "binary-search", "python code", now);
  state = updateTrainingDraft(state, "binary-search", "java code", now, "java", "17 25");
  state = updateTrainingDraft(state, "binary-search", "C++ code", now, "cpp", "42");
  const restored = parseTrainingState(JSON.stringify(state))["binary-search"];
  assert.equal(restored.language, "cpp");
  assert.equal(restored.drafts.python.code, "python code");
  assert.deepEqual(restored.drafts.java, { code: "java code", stdin: "17 25" });
  assert.deepEqual(restored.drafts.cpp, { code: "C++ code", stdin: "42" });
});

test("run records retain language and diagnostics without falsely passing a task", () => {
  const now = "2026-09-07T01:00:00.000Z";
  let state = updateTrainingDraft({}, "binary-search", "C code", now, "c", "17");
  state = appendTrainingRun(state, { id: "run", taskId: "binary-search", kind: "run", code: "C code", language: "c", stdin: "17", createdAt: now, stdout: "42", stderr: "warning", compileOutput: "compiler warning", error: null, durationMs: 30, passed: true });
  const restored = parseTrainingState(JSON.stringify(state))["binary-search"];
  assert.equal(restored.runs[0].language, "c");
  assert.equal(restored.runs[0].compileOutput, "compiler warning");
  assert.equal(restored.drafts.c.stdin, "17");
  assert.equal(getTrainingStatus(restored), "进行中");
  assert.equal(CODE_LANGUAGES.java.filename, "Main.java");
  assert.equal(CODE_LANGUAGES.cpp.extension, "cpp");
});
