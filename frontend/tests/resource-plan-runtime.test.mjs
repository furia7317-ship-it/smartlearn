import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptResourcePlanSnapshot,
  completeActiveResourcePlanRun,
  finalizeResourcePlanAfterStream,
  isCompletedResourcePlanRecord,
  isPlanRunActive,
  recoverAcceptedResourcePlanSnapshot,
  runPlansSequentially,
} from "../lib/resource-plan-runtime.ts";
import { resourcePlanTaskOwnerCounts } from "../lib/resource-plan-recovery.ts";

function failedRecord() {
  const review = { approved: false, score: 0, issues: ["生成失败"], fixes: [] };
  return {
    plan: {
      plan_id: "plan-failed",
      student_id: "student-1",
      version: 1,
      status: "failed",
      request_summary: "学习栈",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks: [
        { task_id: "quiz", type: "quiz", agent: "quiz", title: "栈测验", knowledge_points: ["栈"], source_ids: [], status: "failed", review },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [],
      schedule: [],
      task_progress: {},
      coverage: {},
      integration: {},
      reviews: { quiz: review },
    },
  };
}

function completedRecord(planId) {
  const record = failedRecord();
  const review = { approved: true, score: 1, issues: [], fixes: [] };
  record.plan.plan_id = planId;
  record.plan.status = "completed";
  record.plan.tasks[0].status = "ready";
  record.plan.tasks[0].review = review;
  record.execution.reviews.quiz = review;
  return record;
}

test("approved records resume sequentially without overlapping or skipping a plan", async () => {
  const records = [
    { plan: { plan_id: "plan-a" } },
    { plan: { plan_id: "plan-b" } },
  ];
  const events = [];
  let active = 0;

  await runPlansSequentially(records, async (record) => {
    assert.equal(active, 0, `${record.plan.plan_id} overlapped another plan`);
    active += 1;
    events.push(`start:${record.plan.plan_id}`);
    await Promise.resolve();
    events.push(`end:${record.plan.plan_id}`);
    active -= 1;
  });

  assert.deepEqual(events, ["start:plan-a", "end:plan-a", "start:plan-b", "end:plan-b"]);
});

test("an SSE error still finalizes a failed server record with a terminal message", () => {
  const finalized = finalizeResourcePlanAfterStream(
    failedRecord(),
    [
      { id: "plan-failed:quiz", type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    ],
    "SSE connection lost",
  );

  assert.equal(finalized.resources[0].status, "failed");
  assert.match(finalized.message, /学习路径生成未全部完成.*栈测验.*生成或审核异常/);
});

test("two active plan runs both read, coordinate, and notify without invalidating each other", async () => {
  const controllers = new Map([
    ["plan-a", new AbortController()],
    ["plan-b", new AbortController()],
  ]);
  const events = [];

  const results = await Promise.all(
    ["plan-a", "plan-b"].map((planId) => {
      const controller = controllers.get(planId);
      return completeActiveResourcePlanRun({
        isActive: () => isPlanRunActive(controllers, planId, controller),
        read: async () => {
          events.push(`read:${planId}`);
          await Promise.resolve();
          return completedRecord(planId);
        },
        previous: () => [
          { id: `${planId}:quiz`, type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
        ],
        streamError: "",
        recordSnapshot: () => events.push(`snapshot:${planId}`),
        applyFinalized: (_record, finalized) => {
          assert.equal(finalized.resources[0].status, "ready");
          events.push(`coordinate:${planId}`);
        },
        notify: () => events.push(`notify:${planId}`),
      });
    }),
  );

  assert.ok(results.every(Boolean));
  for (const planId of ["plan-a", "plan-b"]) {
    assert.ok(events.indexOf(`read:${planId}`) < events.indexOf(`snapshot:${planId}`));
    assert.ok(events.indexOf(`snapshot:${planId}`) < events.indexOf(`coordinate:${planId}`));
    assert.ok(events.indexOf(`coordinate:${planId}`) < events.indexOf(`notify:${planId}`));
  }
});

test("a running snapshot is recorded before an SSE interruption is raised", async () => {
  const record = failedRecord();
  record.plan.status = "running";
  record.plan.tasks[0].status = "running";
  const snapshots = [];

  await assert.rejects(
    () => completeActiveResourcePlanRun({
      isActive: () => true,
      read: async () => record,
      previous: () => [],
      streamError: "SSE connection lost",
      recordSnapshot: (refreshed) => snapshots.push(refreshed.plan.status),
      applyFinalized: () => assert.fail("running plan must not be coordinated"),
      notify: () => assert.fail("running plan must not emit completion copy"),
    }),
    /SSE connection lost/,
  );
  assert.deepEqual(snapshots, ["running"]);
});

test("a completed final GET remains authoritative when the final SSE done event was missed", async () => {
  const completion = await completeActiveResourcePlanRun({
    isActive: () => true,
    read: async () => completedRecord("plan-missed-done"),
    previous: () => [],
    streamError: "SSE connection closed before done",
    recordSnapshot: () => true,
    applyFinalized: () => undefined,
    notify: () => undefined,
  });

  assert.ok(completion);
  assert.equal(completion.record.plan.status, "completed");
  assert.equal(isCompletedResourcePlanRecord(completion.record), true);
});

test("a plan that becomes inactive during its final read produces no stale side effects", async () => {
  let active = true;
  let resolveRead;
  const events = [];
  const readPromise = new Promise((resolve) => {
    resolveRead = resolve;
  });

  const completion = completeActiveResourcePlanRun({
    isActive: () => active,
    read: async () => {
      events.push("read");
      return readPromise;
    },
    previous: () => [],
    streamError: "",
    recordSnapshot: () => events.push("snapshot"),
    applyFinalized: () => events.push("coordinate"),
    notify: () => events.push("notify"),
  });

  active = false;
  resolveRead(completedRecord("plan-stale"));

  assert.equal(await completion, null);
  assert.deepEqual(events, ["read"]);
});

test("snapshot acceptance rejects older versions and same-version terminal regressions", () => {
  const completed = completedRecord("plan-monotonic");
  completed.plan.version = 2;

  const delayedRunning = structuredClone(completed);
  delayedRunning.plan.status = "running";
  delayedRunning.plan.tasks[0].status = "running";
  assert.equal(acceptResourcePlanSnapshot(completed, delayedRunning), null);

  const older = structuredClone(completed);
  older.plan.version = 1;
  assert.equal(acceptResourcePlanSnapshot(completed, older), null);
});

test("failed retry snapshots need explicit acceptance and can restore local running state", () => {
  const failed = failedRecord();
  const retryRunning = structuredClone(failed);
  retryRunning.plan.status = "running";
  retryRunning.plan.tasks[0].status = "running";
  retryRunning.plan.tasks[0].review = undefined;
  retryRunning.execution.reviews = {};

  assert.equal(acceptResourcePlanSnapshot(failed, retryRunning), null);
  assert.equal(
    acceptResourcePlanSnapshot(failed, retryRunning, { allowFailedRetry: true }),
    retryRunning,
  );

  const accepted = recoverAcceptedResourcePlanSnapshot(
    failed,
    retryRunning,
    [],
    {},
    { allowFailedRetry: true },
  );
  assert.equal(accepted?.record.plan.status, "running");
  assert.equal(accepted?.recovered.resources[0].id, "plan-failed:quiz");
});

test("higher-version failed replans can start a new nonterminal lifecycle", () => {
  const failed = failedRecord();

  for (const status of ["approved", "awaiting_confirmation"]) {
    const replanned = structuredClone(failed);
    replanned.plan.version = 2;
    replanned.plan.status = status;
    replanned.plan.tasks[0].status = "pending";
    replanned.plan.tasks[0].review = undefined;
    replanned.execution.reviews = {};

    assert.equal(acceptResourcePlanSnapshot(failed, replanned), replanned);
  }

  const sameVersionApproved = structuredClone(failed);
  sameVersionApproved.plan.status = "approved";
  assert.equal(acceptResourcePlanSnapshot(failed, sameVersionApproved), null);
});

test("completed and cancelled snapshots never regress even when failed retry is allowed", () => {
  for (const status of ["completed", "cancelled"]) {
    const terminal = completedRecord(`plan-${status}`);
    terminal.plan.status = status;
    const delayedRunning = structuredClone(terminal);
    delayedRunning.plan.version += 1;
    delayedRunning.plan.status = "running";
    delayedRunning.plan.tasks[0].status = "running";

    assert.equal(
      acceptResourcePlanSnapshot(terminal, delayedRunning, { allowFailedRetry: true }),
      null,
    );
  }
});

test("a delayed running snapshot after completion is rejected without recovering pending state", () => {
  const completed = completedRecord("plan-monotonic");
  const delayedRunning = structuredClone(completed);
  delayedRunning.plan.status = "running";
  delayedRunning.plan.tasks[0].status = "pending";
  delayedRunning.plan.tasks[0].review = undefined;
  delayedRunning.execution.reviews = {};
  const previous = [
    { id: "quiz", type: "quiz", title: "旧占位", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
  ];

  const accepted = recoverAcceptedResourcePlanSnapshot(
    completed,
    delayedRunning,
    previous,
  );

  assert.equal(accepted, null);
  assert.deepEqual(previous.map((item) => [item.id, item.status]), [["quiz", "pending"]]);
});

test("execute-style finalization passes owner counts and preserves an ambiguous raw review", async () => {
  const current = completedRecord("plan-execute");
  const other = completedRecord("plan-other");
  const taskOwnerCounts = resourcePlanTaskOwnerCounts([current, other]);

  const completion = await completeActiveResourcePlanRun({
    isActive: () => true,
    read: async () => current,
    previous: () => [
      { id: "quiz", type: "quiz", title: "归属未知审核卡", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
    ],
    recoveryContext: () => ({ taskOwnerCounts }),
    streamError: "",
    recordSnapshot: () => true,
    applyFinalized: (_record, finalized) => {
      assert.deepEqual(finalized.resources.map((item) => item.id), [
        "quiz",
        "plan-execute:quiz",
      ]);
    },
    notify: () => undefined,
  });

  assert.ok(completion);
});

test("cancel-style accepted recovery preserves an ambiguous raw review", () => {
  const current = failedRecord();
  current.plan.plan_id = "plan-cancel";
  current.plan.status = "running";
  current.plan.tasks[0].status = "running";
  const cancelled = structuredClone(current);
  cancelled.plan.status = "cancelled";
  cancelled.plan.tasks[0].status = "failed";
  const other = completedRecord("plan-other");
  const taskOwnerCounts = resourcePlanTaskOwnerCounts([cancelled, other]);

  const accepted = recoverAcceptedResourcePlanSnapshot(
    current,
    cancelled,
    [
      { id: "quiz", type: "quiz", title: "归属未知审核卡", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
    ],
    { taskOwnerCounts },
  );

  assert.deepEqual(accepted?.recovered.resources.map((item) => item.id), [
    "quiz",
    "plan-cancel:quiz",
  ]);
});
