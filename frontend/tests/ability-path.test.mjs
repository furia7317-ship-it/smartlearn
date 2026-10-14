import assert from "node:assert/strict";
import test from "node:test";
import { buildAbilityTree, buildAbilityTodayQueue, mergeAbilityEvidence, resolveAbilityResource, abilityStudyHref } from "../lib/ability-path.ts";

const step = (title, extras = {}) => ({ day: title, title, desc: `能够${title}`, state: "todo", types: ["quiz"], minutes: 30,
  steps: [{ title: `验证${title}`, detail: "独立验证", minutes: 30, resource_types: ["quiz"], completion_kind: "quiz_submission", completion_key: `task-${title}`, resources: [{ id: `quiz-${title}`, title, type: "quiz" }] }], ...extras });
const course = (path, extra = {}) => ({ id: "course", title: "课程", path, dailyMinutes: 60, ...extra });
const grade = (score) => ({ kind: "quiz_submission", content: `得分 ${score}`, score, completedAt: "2026-10-02T09:00:00.000Z", passed: score >= 60 });

test("reading, submission, old dates and completed keys never imply ability passed", () => {
  const tree = buildAbilityTree([course([step("A"), step("B")])], ["task-A"], { "task-A": { kind: "resource_read", content: "看完", completedAt: "2026-01-01" } });
  assert.equal(tree.passedCount, 0);
  assert.equal(tree.nodes[0].completedTasks, 1);
  assert.equal(tree.nodes[0].status, "current");
});

test("a failing old client submission with passed=true stays failed", () => {
  const tree = buildAbilityTree([course([step("A")])], ["task-A"], { "task-A": { ...grade(30), score: undefined, passed: true } });
  assert.equal(tree.nodes[0].verification, "failed");
  assert.equal(tree.progress, 0);
});

test("prerequisites produce real vertical splits and all/any joins", () => {
  const path = [step("A"), step("B", { prerequisites: ["A"] }), step("C", { prerequisites: ["A"] }), step("D", { prerequisites: ["B", "C"] }), step("E", { prerequisites: ["B", "C"], prerequisite_mode: "any" })];
  const tree = buildAbilityTree([course(path)], [], { "task-A": grade(80), "task-B": grade(70) });
  assert.equal(tree.nodes[1].y, tree.nodes[2].y);
  assert.notEqual(tree.nodes[1].x, tree.nodes[2].x);
  assert.equal(tree.nodes[3].status, "locked");
  assert.equal(tree.nodes[4].status, "available");
  assert.ok(tree.nodes[3].y > tree.nodes[2].y);
});

test("unknown prerequisites stay visible and locked; inferred order remains advisory", () => {
  const tree = buildAbilityTree([course([step("A"), step("B"), step("C", { prerequisites: ["不存在的基础"] })])]);
  assert.equal(tree.edges[0].recommended, true);
  assert.equal(tree.nodes[1].status, "available");
  assert.equal(tree.nodes[2].status, "locked");
  assert.deepEqual(tree.nodes[2].unresolved, ["不存在的基础"]);
});

test("optional extension and reinforcement do not inflate goal denominator", () => {
  const tree = buildAbilityTree([course([step("A", { progress_weight: 20 }), step("B", { progress_weight: 60 }), step("C", { node_kind: "extension", minutes: 100 }), step("D", { node_kind: "reinforcement" })])], [], { "task-A": grade(90) });
  assert.equal(tree.progress, 25);
  assert.equal(tree.mainCount, 2);
});

test("direct validation can pass before reading; review failure never locks descendants again", () => {
  const previous = grade(90);
  const next = mergeAbilityEvidence(previous, { ...grade(30), completedAt: "2026-10-03T09:00:00.000Z" });
  const tree = buildAbilityTree([course([step("A"), step("B", { prerequisites: ["A"] })])], [], { "task-A": next });
  assert.equal(tree.nodes[0].status, "passed");
  assert.equal(tree.nodes[0].reviewDue, true);
  assert.equal(tree.nodes[1].status, "current");
});

test("today queue caps workload and keeps unfinished work ahead of future nodes", () => {
  const tree = buildAbilityTree([course([step("A", { minutes: 90, steps: [{ ...step("A").steps[0], minutes: 90 }] }), step("B")])]);
  const queue = buildAbilityTodayQueue(tree, 45);
  assert.equal(queue.plannedMinutes, 45);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].continues, true);
  assert.equal(queue.entries[0].node.step.title, "A");
});

test("paused and locked nodes are never silently added to the daily workload", () => {
  const tree = buildAbilityTree([course([step("A")], { paused: true }), course([step("B", { prerequisites: ["A"] })], { id: "second" })]);
  assert.equal(buildAbilityTodayQueue(tree, 60).entries.length, 0);
});

test("missing exact resources never fall back to unrelated material", () => {
  const node = buildAbilityTree([course([step("A")])]).nodes[0];
  assert.equal(resolveAbilityResource(node.tasks[0], [{ id: "other", title: "其他课程", type: "quiz", status: "ready" }]), undefined);
  const url = new URL(abilityStudyHref(node, true), "http://example.test");
  assert.equal(url.searchParams.get("node"), node.id);
  assert.equal(url.searchParams.get("course"), node.courseId);
  assert.equal(url.searchParams.get("verify"), "1");
});

test("cycle cannot silently unlock a node", () => {
  const tree = buildAbilityTree([course([step("A", { prerequisites: ["B"] }), step("B", { prerequisites: ["A"] })])]);
  assert.ok(tree.nodes.every((node) => node.status === "locked"));
  assert.ok(tree.nodes.every((node) => node.unresolved.length));
});

test("a reused old quiz cannot validate multiple unrelated abilities", () => {
  const path = [step("A"), step("B")];
  path[1].steps[0].resources = path[0].steps[0].resources;
  const tree = buildAbilityTree([course(path)], [], { "resource:quiz-A": grade(100), "task-A": grade(100) });
  assert.equal(tree.nodes[0].verification, "passed");
  assert.equal(tree.nodes[1].verification, "pending");
});
