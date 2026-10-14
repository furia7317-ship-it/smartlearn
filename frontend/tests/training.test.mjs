import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAINING_TASKS,
  appendTrainingRun,
  buildTrainingCheck,
  getTrainingTask,
  getTrainingStatus,
  parseTrainingState,
  trainingStorageKey,
  updateTrainingDraft,
} from "../lib/training.ts";

const firstDate = "2026-09-06T01:00:00.000Z";
const laterDate = "2026-09-06T01:01:00.000Z";
const taskId = "circular-queue";
const makeRun = (overrides = {}) => ({
  id: "run-1",
  taskId,
  createdAt: laterDate,
  kind: "check",
  code: "print(1)",
  stdout: "平台自测通过：4/4\n",
  error: null,
  durationMs: 12.5,
  passed: true,
  ...overrides,
});
const makeProgress = (overrides = {}) => ({
  code: "print('draft')",
  startedAt: firstDate,
  updatedAt: laterDate,
  runs: [],
  ...overrides,
});

test("training storage keeps different accounts and unusual identifiers distinct", () => {
  const ids = ["", "guest", "student-a", "student-b", " student-a ", "__proto__", "a/b", "a%2Fb", 'a"b', "学生", "\ud800", "\ufffd"];
  const keys = ids.map(trainingStorageKey);
  assert.equal(new Set(keys).size, ids.length);
  assert.ok(keys.every((key) => key.startsWith("sl_training_v1:")));
  assert.equal(trainingStorageKey("学生"), trainingStorageKey("学生"));
});

test("the catalogue has unique stable ids and explicit public self-checks", () => {
  assert.deepEqual(TRAINING_TASKS.map((task) => task.id), ["circular-queue", "bracket-matching", "binary-search"]);
  for (const task of TRAINING_TASKS) {
    assert.equal(getTrainingTask(task.id), task);
    assert.ok(task.tests.length >= 3 && task.tests.length <= 4);
    assert.ok(task.steps.length >= 3);
    assert.ok(task.requirements.length >= 3);
    assert.ok(task.examples.length >= 2);
    assert.ok(task.starterCode.includes("def "));
    assert.equal(new Set(task.tests.map((check) => check.label)).size, task.tests.length);
  }
  for (const id of [null, "", "__proto__", "constructor", "missing"]) assert.equal(getTrainingTask(id), undefined);
});

test("invalid, oversized, and non-object storage produces an empty state", () => {
  for (const raw of [null, "", "broken{", "null", "42", "[]", '"text"', " ".repeat(2_000_001)]) {
    assert.deepEqual(parseTrainingState(raw), {});
  }
});

test("storage only restores known tasks and never copies prototype keys", () => {
  const raw = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"unknown":${JSON.stringify(makeProgress())},"${taskId}":${JSON.stringify(makeProgress())}}`;
  const parsed = parseTrainingState(raw);
  assert.deepEqual(Object.keys(parsed), [taskId]);
  assert.equal(Object.hasOwn(parsed, "__proto__"), false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(parsed[taskId], makeProgress());
});

test("invalid progress is discarded without inventing dates, drafts, or history", () => {
  const badProgress = [
    makeProgress({ code: null }),
    makeProgress({ code: "x".repeat(10_001) }),
    makeProgress({ startedAt: "not a date" }),
    makeProgress({ updatedAt: 123 }),
    makeProgress({ runs: {} }),
  ];
  for (const progress of badProgress) {
    assert.deepEqual(parseTrainingState(JSON.stringify({ [taskId]: progress })), {});
  }
});

test("run parsing rejects malformed entries and keeps task ownership intact", () => {
  const malformed = [
    null,
    makeRun({ taskId: "binary-search" }),
    makeRun({ id: "" }),
    makeRun({ createdAt: "yesterday" }),
    makeRun({ kind: "grade" }),
    makeRun({ code: "x".repeat(10_001) }),
    makeRun({ stdout: 1 }),
    makeRun({ error: false }),
    makeRun({ durationMs: -1 }),
    makeRun({ passed: "true" }),
    makeRun({ passed: undefined }),
  ];
  const parsed = parseTrainingState(JSON.stringify({ [taskId]: makeProgress({ runs: [...malformed, makeRun()] }) }));
  assert.deepEqual(parsed[taskId].runs, [makeRun()]);
});

test("normal runs and failed checks cannot become passed self-checks", () => {
  const state = parseTrainingState(JSON.stringify({
    [taskId]: makeProgress({ runs: [
      makeRun({ id: "normal", kind: "run", passed: true }),
      makeRun({ id: "failed", error: "AssertionError", passed: true }),
      makeRun({ id: "not-passed", passed: false }),
      makeRun({ id: "passed" }),
    ] }),
  }));
  assert.deepEqual(state[taskId].runs.map((run) => [run.id, run.passed]), [
    ["normal", false], ["failed", false], ["not-passed", false], ["passed", true],
  ]);
});

test("task status distinguishes new tasks, edited drafts, and the latest matching self-check", () => {
  assert.equal(getTrainingStatus(), "未开始");
  assert.equal(getTrainingStatus(makeProgress()), "进行中");
  const originalCode = "print('original')";
  const passedRun = makeRun({ id: "passed", code: originalCode, createdAt: firstDate });
  const passed = makeProgress({ code: originalCode, runs: [passedRun] });
  assert.equal(getTrainingStatus(passed), "自测通过");
  assert.equal(getTrainingStatus({ ...passed, code: "print('edited')" }), "进行中");
  const failedRun = makeRun({ id: "failed", code: originalCode, passed: false, error: "AssertionError" });
  assert.equal(getTrainingStatus({ ...passed, runs: [failedRun, passedRun] }), "进行中");
  const newerNormalRun = makeRun({ id: "ordinary", kind: "run", code: originalCode });
  assert.equal(getTrainingStatus({ ...passed, runs: [newerNormalRun] }), "进行中");
  assert.equal(getTrainingStatus({ ...passed, runs: [newerNormalRun, passedRun] }), "自测通过");
  assert.equal(getTrainingStatus({ ...passed, runs: [makeRun({ code: "different code", passed: false }), passedRun] }), "自测通过");
});

test("restored history is newest first, deduplicated, and bounded", () => {
  const runs = Array.from({ length: 30 }, (_, index) => makeRun({
    id: `run-${index}`,
    createdAt: new Date(Date.parse(firstDate) + index * 1_000).toISOString(),
  }));
  const state = parseTrainingState(JSON.stringify({ [taskId]: makeProgress({ runs: [...runs, runs[29]] }) }));
  assert.equal(state[taskId].runs.length, 20);
  assert.equal(state[taskId].runs[0].id, "run-29");
  assert.equal(state[taskId].runs[19].id, "run-10");
});

test("restored output and error text have finite storage limits", () => {
  const state = parseTrainingState(JSON.stringify({ [taskId]: makeProgress({ runs: [makeRun({ stdout: "o".repeat(20_000), error: "e".repeat(3_000) })] }) }));
  assert.equal(state[taskId].runs[0].stdout.length, 16_000);
  assert.equal(state[taskId].runs[0].error.length, 2_000);
  assert.equal(state[taskId].runs[0].passed, false);
});

test("editing a draft retains start time and evidence without mutating the old state", () => {
  const started = updateTrainingDraft({}, taskId, "first", firstDate);
  const withRun = appendTrainingRun(started, makeRun());
  const edited = updateTrainingDraft(withRun, taskId, "new draft", "2026-09-06T01:02:00.000Z");
  assert.equal(edited[taskId].startedAt, firstDate);
  assert.equal(edited[taskId].code, "new draft");
  assert.equal(edited[taskId].runs.length, 1);
  assert.equal(withRun[taskId].code, "first");
  assert.equal(started[taskId].runs.length, 0);
  for (const [id, code, date] of [["__proto__", "x", firstDate], [taskId, "x".repeat(10_001), firstDate], [taskId, "x", "bad"]]) {
    assert.equal(updateTrainingDraft(edited, id, code, date), edited);
  }
});

test("an execution finishing after more typing preserves the latest draft", () => {
  const edited = updateTrainingDraft({}, taskId, "unsent newer draft", "2026-09-06T01:02:00.000Z");
  const result = appendTrainingRun(edited, makeRun({ code: "previous submitted code" }));
  assert.equal(result[taskId].code, "unsent newer draft");
  assert.equal(result[taskId].updatedAt, edited[taskId].updatedAt);
  assert.equal(result[taskId].runs[0].code, "previous submitted code");
  assert.equal(edited[taskId].runs.length, 0);
});

test("new evidence can initialize a task and is capped on each append", () => {
  let state = {};
  for (let index = 0; index < 25; index++) {
    state = appendTrainingRun(state, makeRun({
      id: `run-${index}`,
      code: `print(${index})`,
      createdAt: new Date(Date.parse(firstDate) + index * 1_000).toISOString(),
    }));
  }
  assert.equal(state[taskId].code, "print(0)");
  assert.equal(state[taskId].startedAt, firstDate);
  assert.equal(state[taskId].runs.length, 20);
  assert.equal(state[taskId].runs[0].id, "run-24");
  assert.equal(appendTrainingRun(state, makeRun({ taskId: "constructor" })), state);
  assert.equal(appendTrainingRun(state, makeRun({ durationMs: Infinity })), state);
});

test("self-check harness preserves code and includes every named assertion before success", () => {
  for (const task of TRAINING_TASKS) {
    const code = "# student's implementation\nvalue = 1\n";
    const harness = buildTrainingCheck(task, code);
    assert.ok(harness.startsWith(code));
    assert.equal(harness.split("\n").filter((line) => line.startsWith("assert ")).length, task.tests.length);
    for (const check of task.tests) {
      assert.ok(harness.includes(check.expression));
      assert.ok(harness.includes(check.expected));
      assert.ok(harness.includes(check.label));
    }
    assert.ok(harness.endsWith(`print("平台自测通过：${task.tests.length}/${task.tests.length}")\n`));
    assert.ok(buildTrainingCheck(task, task.starterCode).length < 10_000);
  }
});
