import assert from "node:assert/strict";
import test from "node:test";

import { finalizeResourcePlanExecution } from "../lib/resource-plan-finalization.ts";
import { resourcePlanTaskOwnerCounts } from "../lib/resource-plan-recovery.ts";

function task(taskId, status, review) {
  return {
    task_id: taskId,
    type: taskId === "quiz" ? "quiz" : "explainer",
    agent: taskId === "quiz" ? "quiz" : "explainer",
    title: taskId === "quiz" ? "栈测验" : "栈讲义",
    knowledge_points: ["栈"],
    source_ids: [],
    status,
    review,
  };
}

function record(status, tasks, resources = [], reviews = {}) {
  return {
    plan: {
      plan_id: `plan-${status}`,
      student_id: "student-1",
      version: 1,
      status,
      request_summary: "学习栈",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks,
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources,
      schedule: [],
      task_progress: {},
      coverage: {},
      integration: {},
      reviews,
    },
  };
}

test("running and approved records fail finalization with a consistency error", () => {
  for (const status of ["running", "approved"]) {
    assert.throws(
      () => finalizeResourcePlanExecution(record(status, []), []),
      new RegExp(`服务端计划仍处于 ${status} 状态`),
    );
  }
});

test("completed record returns reconciled resources and the full-success message", () => {
  const approved = { approved: true, score: 1, issues: [], fixes: [] };
  const finalized = finalizeResourcePlanExecution(
    record(
      "completed",
      [task("lecture", "ready", approved)],
      [{ id: "lecture", task_id: "lecture", type: "explainer", title: "栈讲义" }],
      { lecture: approved },
    ),
    [{ id: "plan-completed:lecture", type: "explainer", title: "栈讲义", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 }],
  );

  assert.equal(finalized.resources[0].status, "ready");
  assert.equal(finalized.message, "全部 1 份资料生成完成，已更新到学习路径和资源中心。");
});

test("failed record keeps reconciliation and emits an explicit terminal message", () => {
  const approved = { approved: true, score: 1, issues: [], fixes: [] };
  const rejected = {
    approved: false,
    score: 0,
    issues: ["缺少解析"],
    fixes: [],
    failure_kind: "quality",
    gate_status: "rejected",
  };
  const finalized = finalizeResourcePlanExecution(
    record(
      "failed",
      [task("lecture", "ready", approved), task("quiz", "failed", rejected)],
      [{ id: "lecture", task_id: "lecture", type: "explainer", title: "栈讲义" }],
      { lecture: approved, quiz: rejected },
    ),
    [
      { id: "plan-failed:lecture", type: "explainer", title: "栈讲义", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
      { id: "plan-failed:quiz", type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    ],
  );

  assert.deepEqual(finalized.resources.map((item) => [item.id, item.status]), [
    ["plan-failed:lecture", "ready"],
    ["plan-failed:quiz", "failed"],
  ]);
  assert.equal(finalized.resources[1].subtitle, "缺少解析");
  assert.match(
    finalized.message,
    /学习路径生成未全部完成：已完成 1\/2 份.*栈测验.*质量审核/,
  );
});

test("finalization rejects empty and internally inconsistent terminal records", () => {
  assert.throws(
    () => finalizeResourcePlanExecution(record("completed", []), []),
    /至少包含一个资料任务/,
  );

  for (const invalidStatus of ["pending", "failed"]) {
    assert.throws(
      () => finalizeResourcePlanExecution(
        record("completed", [task("lecture", invalidStatus, undefined)]),
        [],
      ),
      /completed.*ready|完成计划.*ready/,
    );
  }

  const approved = { approved: true, score: 1, issues: [], fixes: [] };
  assert.throws(
    () => finalizeResourcePlanExecution(
      record("failed", [task("lecture", "ready", approved)], [], { lecture: approved }),
      [],
    ),
    /failed.*failed|失败计划.*failed/,
  );
});

test("finalization rejects task statuses that disagree with recovered review state", () => {
  assert.throws(
    () => finalizeResourcePlanExecution(
      record("completed", [task("lecture", "ready", undefined)]),
      [],
    ),
    /审核|review|恢复.*ready/,
  );

  const approved = { approved: true, score: 1, issues: [], fixes: [] };
  assert.throws(
    () => finalizeResourcePlanExecution(
      record("failed", [task("lecture", "failed", approved)], [], { lecture: approved }),
      [],
    ),
    /审核|review|恢复.*failed/,
  );

  const rejected = { approved: false, score: 0, issues: ["不合格"], fixes: [] };
  assert.throws(
    () => finalizeResourcePlanExecution(
      record(
        "failed",
        [task("lecture", "ready", rejected), task("quiz", "failed", rejected)],
        [],
        { lecture: rejected, quiz: rejected },
      ),
      [],
    ),
    /审核|review|恢复.*ready/,
  );
});

test("finalization preserves an ownerless raw review when another plan owns the same task id", () => {
  const approved = { approved: true, score: 1, issues: [], fixes: [] };
  const current = record(
    "completed",
    [task("lecture", "ready", approved)],
    [],
    { lecture: approved },
  );
  const other = structuredClone(current);
  other.plan.plan_id = "plan-other";
  const taskOwnerCounts = resourcePlanTaskOwnerCounts([current, other]);

  const finalized = finalizeResourcePlanExecution(
    current,
    [
      { id: "lecture", type: "explainer", title: "归属未知审核卡", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
    ],
    { taskOwnerCounts },
  );

  assert.deepEqual(finalized.resources.map((item) => item.id), [
    "lecture",
    "plan-completed:lecture",
  ]);
});
