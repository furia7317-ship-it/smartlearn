import assert from "node:assert/strict";
import test from "node:test";
import { buildTrainingContext, currentTrainingPath, exerciseToTrainingTask, pythonLiteral, trainingPathSignature } from "../lib/training-generation.ts";
import { appendTrainingRun, buildTrainingRun, parseTrainingState, serializeTrainingState, updateTrainingDraft, TRAINING_TASKS } from "../lib/training.ts";

const path = [
  { day: "第 1 天", title: "数组", desc: "数组遍历", objective: "理解顺序遍历", types: ["code"], state: "current", knowledge_points: ["索引"], subject_titles: ["数据结构"], steps: [{ title: "找出最大值", detail: "比较每个元素", prompts: ["空数组如何处理"] }] },
  { day: "第 2 天", title: "查找", desc: "二分查找", types: ["code"], state: "todo" },
];
const source = { source: "learning_path", exercise_kind: "completion", path_signature: trainingPathSignature(path), node_index: 0, node_title: "数组", node_day: "第 1 天", course: "数据结构" };
const exercise = {
  id: `code-exercise-${"a".repeat(32)}`, learning_date: "2026-09-06", context_title: "数组", title: "补全查找", prompt: "完成比较逻辑", difficulty: "基础", knowledge_points: ["数组"], constraints: ["保留函数名"],
  starter_code: "def solve(values):\n    # TODO\n    return None", function_name: "solve", examples: [{ input: [[1, 2], true, null], output: false }], test_count: 5, ai_status: "completed", created_at: "2026-09-06T01:00:00Z", training_metadata: source,
};

test("training follows master schedule, falls back to current path, and never invents a path", () => {
  const context = currentTrainingPath({ masterPath: path, path: [path[1]], masterPathScheduleAnchor: "2026-09-05" }, new Date(2026, 8, 6, 12));
  assert.equal(context.path, path);
  assert.equal(context.currentIndex, 1);
  assert.equal(currentTrainingPath({ masterPath: [], path }, new Date(2026, 8, 6)).currentIndex, 0);
  assert.equal(currentTrainingPath({ masterPath: [], path: [] }).currentIndex, -1);
  assert.equal(buildTrainingContext([], -1), null);
});

test("generation includes node goal, knowledge points and assigned tasks, with a stable source", () => {
  const result = buildTrainingContext(path, 0);
  for (const text of ["理解顺序遍历", "数组遍历", "索引", "找出最大值", "空数组如何处理", "数据结构"]) assert.ok(result.context.includes(text));
  assert.equal(result.source.node_index, 0);
  assert.match(buildTrainingContext(path, 1).context, /第 1 天 数组 → 第 2 天 查找/);
  assert.equal(result.source.path_signature, trainingPathSignature(path));
  assert.equal(trainingPathSignature(path.map((node) => ({ ...node, state: "todo" }))), trainingPathSignature(path));
  assert.notEqual(trainingPathSignature([{ ...path[0], objective: "新目标" }]), trainingPathSignature([path[0]]));
});

test("generated tasks preserve kind, source, starter and test count after restoration", () => {
  const task = exerciseToTrainingTask(exercise);
  assert.equal(task.kind, "completion");
  assert.equal(task.source.node_title, "数组");
  assert.equal(task.starterCode, exercise.starter_code);
  assert.equal(task.tests.length, 1);
  assert.equal(task.testCount, 5);
  assert.equal(task.examples[0].input, "solve([1, 2], True, None)");
  assert.equal(task.examples[0].output, "False");
  assert.match(exerciseToTrainingTask({ ...exercise, training_metadata: { ...source, exercise_kind: "debugging" } }).steps[1].title, /复现/);
  assert.throws(() => exerciseToTrainingTask({ ...exercise, training_metadata: {} }));
  assert.throws(() => exerciseToTrainingTask({ ...exercise, function_name: "solve(); danger" }));
});

test("JSON test values become Python literals without treating embedded strings as code", () => {
  assert.equal(pythonLiteral({ text: "'); print('bad') #", flag: true }), '{"text": "\'); print(\'bad\') #", "flag": True}');
  assert.throws(() => pythonLiteral(Infinity));
  assert.throws(() => pythonLiteral(undefined));
});

test("generated-task drafts and evidence survive reload alongside old preset drafts", () => {
  const date = "2026-09-06T01:00:00Z";
  let state = updateTrainingDraft({}, "circular-queue", "old draft", date);
  state = updateTrainingDraft(state, exercise.id, "new draft", date);
  state = appendTrainingRun(state, { id: "run", taskId: exercise.id, code: "new draft", createdAt: date, kind: "check", passed: true, stdout: "5/5", error: null, durationMs: 20 });
  const restored = parseTrainingState(JSON.stringify(state));
  assert.equal(restored["circular-queue"].code, "old draft");
  assert.equal(restored[exercise.id].code, "new draft");
  assert.equal(restored[exercise.id].runs[0].passed, true);
  assert.equal(updateTrainingDraft(restored, "code-exercise-__proto__", "bad", date), restored);
});

test("many generated tasks cannot silently save an unreadable oversized snapshot", () => {
  assert.equal(serializeTrainingState({}), "{}");
  assert.throws(() => serializeTrainingState({ huge: "x".repeat(2_000_001) }), /存储上限/);
});

test("running a generated function actually calls its selected public example without changing the draft", () => {
  const task = exerciseToTrainingTask(exercise);
  const code = "def solve(values, enabled, empty):\n    return False\n";
  const run = buildTrainingRun(task, code);
  assert.ok(run.startsWith(code));
  assert.match(run, /print\("示例 1 返回值：", \(solve\(\[1, 2\], True, None\)\)\)/);
  assert.equal(buildTrainingRun(TRAINING_TASKS[0], code), code);
  assert.throws(() => buildTrainingRun(task, code, 5), /公开示例/);
});
