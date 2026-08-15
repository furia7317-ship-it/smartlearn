import assert from "node:assert/strict";
import test from "node:test";

import {
  recoverResourcePlanRecord,
  scheduleSnapshotToPath,
} from "../lib/resource-plan-recovery.ts";

function collisionRecord(planId, title, taskId = "shared") {
  const review = { approved: true, score: 1, issues: [], fixes: [] };
  return {
    plan: {
      plan_id: planId,
      student_id: "student-1",
      version: 1,
      status: "completed",
      request_summary: title,
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks: [
        { task_id: taskId, type: "explainer", agent: "explainer", title, knowledge_points: ["栈"], source_ids: [], status: "ready", review },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [{ id: taskId, task_id: taskId, type: "explainer", title }],
      schedule: [
        {
          day: "D1",
          title,
          objective: title,
          minutes: 30,
          steps: [
            {
              title,
              detail: "打开讲义",
              minutes: 30,
              resource_types: ["explainer"],
              resources: [{ id: taskId, type: "explainer", title }],
            },
          ],
        },
      ],
      task_progress: {},
      coverage: {},
      integration: {},
      reviews: { [taskId]: review },
    },
  };
}

function preExecutionRecord(status = "awaiting_confirmation") {
  const record = collisionRecord("plan-pre", "待确认资料", "lecture");
  record.plan.status = status;
  record.plan.tasks = [
    { ...record.plan.tasks[0], status: "pending", review: undefined },
    {
      ...record.plan.tasks[0],
      task_id: "quiz",
      type: "quiz",
      agent: "quiz",
      title: "待确认测验",
      status: "pending",
      review: undefined,
    },
  ];
  record.execution = {
    resources: [],
    schedule: [],
    task_progress: {},
    coverage: {},
    integration: {},
    reviews: {},
  };
  return record;
}

for (const status of ["draft", "awaiting_confirmation"]) {
  test(`${status} recovery creates no resources and keeps generation pending`, () => {
    const recovered = recoverResourcePlanRecord(preExecutionRecord(status), []);

    assert.deepEqual(recovered.resources, []);
    assert.equal(
      recovered.execution.phases.find((phase) => phase.id === "generation")?.status,
      "pending",
    );
  });
}

test("pre-execution recovery removes explicitly owned pending and review placeholders", () => {
  const recovered = recoverResourcePlanRecord(preExecutionRecord(), [
    { id: "plan-pre:lecture", type: "explainer", title: "待生成讲义", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    { id: "plan-pre:quiz", type: "quiz", title: "待审核测验", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
    { id: "legacy-owned", type: "quiz", title: "旧占位", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0, data: { plan_id: "plan-pre" } },
    { id: "plan-other:lecture", type: "explainer", title: "其他计划占位", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
  ]);

  assert.deepEqual(recovered.resources.map((item) => item.id), ["plan-other:lecture"]);
});

test("pre-execution recovery removes stale placeholders for tasks removed by replan", () => {
  const recovered = recoverResourcePlanRecord(preExecutionRecord(), [
    { id: "plan-pre:removed-pending", type: "explainer", title: "已删除讲义占位", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    { id: "plan-pre:removed-review", type: "quiz", title: "已删除测验占位", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
    { id: "plan-pre:removed-ready", type: "explainer", title: "历史成品", subtitle: "已交付", meta: [], status: "ready", version: 2, sources: 0 },
    { id: "plan-foreign:removed-pending", type: "explainer", title: "其他计划占位", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    { id: "unrelated-review", type: "quiz", title: "归属未知", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
  ]);

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-pre:removed-ready", "ready"],
    ["plan-foreign:removed-pending", "pending"],
    ["unrelated-review", "review"],
  ]);
});

test("pre-execution recovery preserves historical products and unrelated cards", () => {
  const recovered = recoverResourcePlanRecord(preExecutionRecord(), [
    { id: "plan-pre:lecture", type: "explainer", title: "历史讲义", subtitle: "已交付", meta: [], status: "ready", version: 2, sources: 0 },
    { id: "old-failure", type: "quiz", title: "历史失败", subtitle: "保留原因", meta: [], status: "failed", version: 2, sources: 0, data: { plan_id: "plan-pre" } },
    { id: "old-rejected", type: "quiz", title: "历史返工", subtitle: "保留意见", meta: [], status: "rejected", version: 2, sources: 0, data: { plan_id: "plan-pre" } },
    { id: "unrelated-review", type: "quiz", title: "归属未知", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
  ]);

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-pre:lecture", "ready"],
    ["old-failure", "failed"],
    ["old-rejected", "rejected"],
    ["unrelated-review", "review"],
  ]);
});

test("approved recovery still creates execution placeholders", () => {
  const record = preExecutionRecord("approved");
  const recovered = recoverResourcePlanRecord(record, []);

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-pre:lecture", "pending"],
    ["plan-pre:quiz", "pending"],
  ]);
});

test("plans with the same task id keep separate resources and exact path links", () => {
  const first = recoverResourcePlanRecord(collisionRecord("plan-a", "计划 A 讲义"), []);
  const second = recoverResourcePlanRecord(
    collisionRecord("plan-b", "计划 B 讲义"),
    first.resources,
  );

  assert.deepEqual(second.resources.map((item) => [item.id, item.title]), [
    ["plan-a:shared", "计划 A 讲义"],
    ["plan-b:shared", "计划 B 讲义"],
  ]);
  assert.equal(first.path[0].steps?.[0].resources?.[0].id, "plan-a:shared");
  assert.equal(second.path[0].steps?.[0].resources?.[0].id, "plan-b:shared");
  assert.equal(second.resources[1].data?.task_id, "shared");
});

test("schedule snapshots preserve legacy ids unless a plan id is supplied", () => {
  const schedule = collisionRecord("plan-a", "计划 A 讲义").execution.schedule;

  assert.equal(scheduleSnapshotToPath(schedule)[0].steps?.[0].resources?.[0].id, "shared");
  assert.equal(
    scheduleSnapshotToPath(schedule, "plan-a")[0].steps?.[0].resources?.[0].id,
    "plan-a:shared",
  );
});

test("failed schedule steps with no resources retain an explicit composite target", () => {
  const path = scheduleSnapshotToPath([
    {
      day: "D1",
      title: "动态规划基础",
      steps: [
        {
          id: "dp-concept-lecture",
          title: "动态规划概念讲义",
          type: "resource",
          resource_types: ["explainer"],
          resources: [],
          status: "failed",
        },
      ],
    },
  ], "plan-dp");

  assert.deepEqual(path[0].steps?.[0].resources, [
    {
      id: "plan-dp:dp-concept-lecture",
      type: "explainer",
      title: "动态规划概念讲义",
    },
  ]);
});

test("schedule steps prefer existing resources without adding a duplicate target", () => {
  const path = scheduleSnapshotToPath([
    {
      day: "D1",
      title: "动态规划基础",
      steps: [
        {
          id: "dp-concept-lecture",
          title: "动态规划概念讲义",
          resource_types: ["explainer"],
          resources: [
            { id: "dp-concept-lecture", type: "explainer", title: "已生成讲义" },
          ],
        },
      ],
    },
  ], "plan-dp");

  assert.deepEqual(path[0].steps?.[0].resources, [
    {
      id: "plan-dp:dp-concept-lecture",
      type: "explainer",
      title: "已生成讲义",
    },
  ]);
});

test("legacy schedules without a plan id do not invent an explicit target", () => {
  const path = scheduleSnapshotToPath([
    {
      day: "D1",
      title: "动态规划基础",
      steps: [
        {
          id: "dp-concept-lecture",
          title: "动态规划概念讲义",
          resource_types: ["explainer"],
          resources: [],
          status: "failed",
        },
      ],
    },
  ]);

  assert.deepEqual(path[0].steps?.[0].resources, []);
});

test("terminal recovery migrates a provably owned legacy raw task card", () => {
  const recovered = recoverResourcePlanRecord(
    collisionRecord("plan-legacy", "旧测验", "quiz"),
    [
      {
        id: "quiz",
        type: "explainer",
        title: "旧测验",
        subtitle: "等待生成",
        meta: [],
        status: "pending",
        version: 1,
        sources: 0,
        data: { task_id: "quiz" },
      },
    ],
  );

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-legacy:quiz", "ready"],
  ]);
});

for (const legacyStatus of ["pending", "review"]) {
  test(`terminal recovery migrates a legacy raw ${legacyStatus} placeholder without data`, () => {
    const recovered = recoverResourcePlanRecord(
      collisionRecord(`plan-${legacyStatus}`, `${legacyStatus} 测验`, "quiz"),
      [
        {
          id: "quiz",
          type: "explainer",
          title: `${legacyStatus} 测验`,
          subtitle: "旧占位卡",
          meta: [],
          status: legacyStatus,
          version: 1,
          sources: 0,
        },
      ],
    );

    assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
      [`plan-${legacyStatus}:quiz`, "ready"],
    ]);
  });
}

test("terminal recovery preserves an unrelated raw resource with a colliding id", () => {
  const recovered = recoverResourcePlanRecord(
    collisionRecord("plan-safe", "计划测验", "quiz"),
    [
      {
        id: "quiz",
        type: "quiz",
        title: "独立测验",
        subtitle: "用户独立创建",
        meta: [],
        status: "ready",
        version: 1,
        sources: 0,
      },
    ],
  );

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.title]), [
    ["quiz", "独立测验"],
    ["plan-safe:quiz", "计划测验"],
  ]);
});

test("terminal recovery preserves a ready raw resource that only has a matching task id", () => {
  const recovered = recoverResourcePlanRecord(
    collisionRecord("plan-ready-safe", "计划测验", "quiz"),
    [
      {
        id: "quiz",
        type: "quiz",
        title: "独立成品测验",
        subtitle: "已完成",
        meta: [],
        status: "ready",
        version: 1,
        sources: 0,
        data: { task_id: "quiz", questions: [] },
      },
    ],
  );

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.title]), [
    ["quiz", "独立成品测验"],
    ["plan-ready-safe:quiz", "计划测验"],
  ]);
});

test("terminal recovery migrates a ready raw resource with an exact plan id", () => {
  const recovered = recoverResourcePlanRecord(
    collisionRecord("plan-ready-owned", "计划测验", "quiz"),
    [
      {
        id: "quiz",
        type: "quiz",
        title: "旧计划测验",
        subtitle: "已完成",
        meta: [],
        status: "ready",
        version: 1,
        sources: 0,
        data: { task_id: "quiz", plan_id: "plan-ready-owned", questions: [] },
      },
    ],
  );

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-ready-owned:quiz", "ready"],
  ]);
});

test("terminal recovery preserves a foreign-plan review placeholder", () => {
  const recovered = recoverResourcePlanRecord(
    collisionRecord("plan-current", "当前计划测验", "quiz"),
    [
      {
        id: "quiz",
        type: "quiz",
        title: "其他计划审核卡",
        subtitle: "等待审核",
        meta: [],
        status: "review",
        version: 1,
        sources: 0,
        data: { task_id: "quiz", plan_id: "plan-foreign" },
      },
    ],
  );

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.title]), [
    ["quiz", "其他计划审核卡"],
    ["plan-current:quiz", "当前计划测验"],
  ]);
});

test("two known plans sharing one task id do not destructively claim an ownerless raw card", () => {
  const firstRecord = collisionRecord("plan-owner-a", "计划 A 测验", "quiz");
  const secondRecord = collisionRecord("plan-owner-b", "计划 B 测验", "quiz");
  const context = { taskOwnerCounts: new Map([["quiz", 2]]) };
  const previous = [
    {
      id: "quiz",
      type: "quiz",
      title: "归属未知审核卡",
      subtitle: "等待审核",
      meta: [],
      status: "review",
      version: 1,
      sources: 0,
    },
  ];

  const first = recoverResourcePlanRecord(firstRecord, previous, context);
  const second = recoverResourcePlanRecord(secondRecord, first.resources, context);

  assert.deepEqual(second.resources.map((item) => item.id), [
    "quiz",
    "plan-owner-a:quiz",
    "plan-owner-b:quiz",
  ]);
});

test("persisted execution restores resources, reviews, phases, and exact schedule links", () => {
  const record = {
    plan: {
      plan_id: "plan-1",
      student_id: "student-1",
      version: 1,
      status: "failed",
      request_summary: "学习栈",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks: [
        { task_id: "lecture-1", type: "explainer", agent: "explainer", title: "栈讲义", knowledge_points: ["栈"], source_ids: [], status: "ready" },
        { task_id: "quiz-1", type: "quiz", agent: "quiz", title: "栈测验", knowledge_points: ["LIFO"], source_ids: [], status: "failed" },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [
        { id: "lecture-1", task_id: "lecture-1", type: "explainer", title: "栈讲义", overview: "理解 LIFO" },
        { id: "quiz-1", task_id: "quiz-1", type: "quiz", title: "栈测验", questions: [{ stem: "题目" }] },
      ],
      schedule: [
        {
          day: "D1",
          title: "栈",
          objective: "理解后进先出",
          minutes: 30,
          steps: [
            {
              title: "学习栈",
              detail: "打开讲义",
              minutes: 30,
              resource_types: ["explainer"],
              resources: [{ id: "lecture-1", type: "explainer", title: "栈讲义" }],
            },
          ],
        },
      ],
      task_progress: {},
      coverage: { complete: false },
      integration: {},
      reviews: {
        "lecture-1": { approved: true, score: 1, issues: [], retry_count: 0 },
        "quiz-1": { approved: false, score: 0.5, issues: ["缺少解析"], retry_count: 1 },
      },
      repair_task_ids: [],
      retry_round: 0,
      trace_run_id: "run-1",
    },
  };

  const recovered = recoverResourcePlanRecord(record, []);

  assert.deepEqual(recovered.resources.map((item) => [item.id, item.status]), [
    ["plan-1:lecture-1", "ready"],
    ["plan-1:quiz-1", "failed"],
  ]);
  assert.equal(recovered.path[0].steps?.[0].resources?.[0].id, "plan-1:lecture-1");
  assert.equal(recovered.execution.tasks["lecture-1"].approved, true);
  assert.equal(recovered.execution.tasks["quiz-1"].approved, false);
  assert.equal(
    recovered.execution.phases.find((phase) => phase.id === "review")?.status,
    "error",
  );
  assert.equal(
    recovered.execution.phases.find((phase) => phase.id === "delivery")?.status,
    "error",
  );
  assert.ok(
    recovered.execution.phases
      .filter((phase) => ["understanding", "planning", "generation"].includes(phase.id))
      .every((phase) => phase.status === "completed"),
  );
});

test("terminal plans reconcile every plan task without overwriting unrelated resources", () => {
  const record = {
    plan: {
      plan_id: "plan-terminal",
      student_id: "student-1",
      version: 1,
      status: "failed",
      request_summary: "学习栈",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks: [
        { task_id: "lecture", type: "explainer", agent: "explainer", title: "栈讲义", knowledge_points: ["栈"], source_ids: [], status: "ready" },
        { task_id: "quiz", type: "quiz", agent: "quiz", title: "栈测验", knowledge_points: ["LIFO"], source_ids: [], status: "failed" },
        { task_id: "reading", type: "reading", agent: "reading", title: "栈阅读", knowledge_points: ["应用"], source_ids: [], status: "failed" },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [
        { id: "lecture", task_id: "lecture", type: "explainer", title: "栈讲义", overview: "理解 LIFO" },
        { id: "external", task_id: "external", type: "quiz", title: "不属于本计划的新标题" },
      ],
      schedule: [],
      task_progress: {},
      coverage: { complete: false },
      integration: {},
      reviews: {
        lecture: { approved: true, score: 1, issues: [], retry_count: 0 },
        quiz: { approved: false, score: 0, issues: ["依赖资料生成失败"], retry_count: 1 },
      },
    },
  };
  const previous = [
    { id: "external", type: "quiz", title: "其他计划资料", subtitle: "保持原样", meta: [], status: "ready", version: 4, sources: 0 },
    { id: "plan-terminal:lecture", type: "explainer", title: "栈讲义", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    { id: "plan-terminal:quiz", type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    { id: "plan-terminal:reading", type: "reading", title: "栈阅读", subtitle: "等待审核", meta: [], status: "review", version: 1, sources: 0 },
  ];

  const recovered = recoverResourcePlanRecord(record, previous);
  const resources = new Map(recovered.resources.map((item) => [item.id, item]));

  assert.equal(resources.get("external")?.title, "其他计划资料");
  assert.equal(resources.get("external")?.subtitle, "保持原样");
  assert.deepEqual(
    record.plan.tasks.map((task) => [
      task.task_id,
      resources.get(`plan-terminal:${task.task_id}`)?.status,
    ]),
    [["lecture", "ready"], ["quiz", "failed"], ["reading", "failed"]],
  );
  assert.equal(resources.get("plan-terminal:quiz")?.subtitle, "依赖资料生成失败");
  assert.equal(resources.get("plan-terminal:reading")?.subtitle, "任务未产生可审核资料");
});

test("completed, failed, and cancelled plans never leave their task placeholders pending", () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const record = {
      plan: {
        plan_id: `plan-${status}`,
        student_id: "student-1",
        version: 1,
        status,
        request_summary: "学习栈",
        complexity: { level: "simple", reasons: [], auto_execute: true },
        constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
        days: [],
        tasks: [
          { task_id: "quiz", type: "quiz", agent: "quiz", title: "栈测验", knowledge_points: ["LIFO"], source_ids: [], status: "failed" },
        ],
        validation: { valid: true, errors: [], warnings: [] },
      },
      execution: { resources: [], schedule: [], task_progress: {}, coverage: {}, integration: {}, reviews: {} },
    };

    const recovered = recoverResourcePlanRecord(record, [
      { id: `plan-${status}:quiz`, type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    ]);

    assert.equal(recovered.resources[0].status, "failed", status);
  }
});


test("a persisted retryable review restores as rework instead of failed", () => {
  const record = {
    plan: {
      plan_id: "plan-rework",
      student_id: "student-1",
      version: 1,
      status: "running",
      request_summary: "retry",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "basic", material_types: [] },
      days: [],
      tasks: [
        { task_id: "lecture", type: "explainer", agent: "explainer", title: "Lecture", knowledge_points: ["term"], source_ids: [], status: "review" },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [{ task_id: "lecture", type: "explainer", title: "Lecture", overview: "candidate" }],
      schedule: [],
      task_progress: { lecture: { status: "rework" } },
      coverage: {},
      integration: {},
      reviews: { lecture: { approved: false, terminal: false, issues: ["provider timeout"] } },
    },
  };

  const recovered = recoverResourcePlanRecord(record, []);
  const resource = recovered.resources.find((item) => item.id === "plan-rework:lecture");

  assert.equal(resource?.status, "rejected");
  assert.match(resource?.subtitle ?? "", /返工/);
});

test("completed and cancelled plans restore approved task placeholders as ready", () => {
  for (const status of ["completed", "cancelled"]) {
    const record = {
      plan: {
        plan_id: `plan-approved-${status}`,
        student_id: "student-1",
        version: 1,
        status,
        request_summary: "学习栈",
        complexity: { level: "simple", reasons: [], auto_execute: true },
        constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
        days: [],
        tasks: [
          {
            task_id: "lecture",
            type: "explainer",
            agent: "explainer",
            title: "栈讲义",
            knowledge_points: ["栈"],
            source_ids: [],
            status: "ready",
            review: { approved: true, score: 1, issues: [], fixes: [] },
          },
        ],
        validation: { valid: true, errors: [], warnings: [] },
      },
      execution: { resources: [], schedule: [], task_progress: {}, coverage: {}, integration: {}, reviews: {} },
    };

    const recovered = recoverResourcePlanRecord(record, [
      { id: `plan-approved-${status}:lecture`, type: "explainer", title: "栈讲义", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
    ]);

    assert.equal(recovered.resources[0].status, "ready", status);
    assert.equal(recovered.resources[0].subtitle, "质量审核通过", status);
  }
});

test("cancelled plans leave no pending or running execution phases", () => {
  const record = collisionRecord("plan-cancelled", "已取消讲义");
  record.plan.status = "cancelled";

  const recovered = recoverResourcePlanRecord(record, []);

  assert.ok(
    recovered.execution.phases.every((phase) => ["completed", "error"].includes(phase.status)),
  );
  assert.ok(
    recovered.execution.phases
      .filter((phase) => ["generation", "review", "integration", "delivery"].includes(phase.id))
      .every((phase) => phase.status === "error" && phase.detail?.includes("取消")),
  );
});

test("non-terminal plans may retain pending and review task cards", () => {
  const record = {
    plan: {
      plan_id: "plan-running",
      student_id: "student-1",
      version: 1,
      status: "running",
      request_summary: "学习栈",
      complexity: { level: "simple", reasons: [], auto_execute: true },
      constraints: { days: 1, daily_minutes: 30, difficulty: "入门", material_types: [] },
      days: [],
      tasks: [
        { task_id: "lecture", type: "explainer", agent: "explainer", title: "栈讲义", knowledge_points: ["栈"], source_ids: [], status: "generated" },
        { task_id: "quiz", type: "quiz", agent: "quiz", title: "栈测验", knowledge_points: ["LIFO"], source_ids: [], status: "pending" },
      ],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [{ id: "lecture", task_id: "lecture", type: "explainer", title: "栈讲义" }],
      schedule: [],
      task_progress: {},
      coverage: {},
      integration: {},
      reviews: {},
    },
  };

  const recovered = recoverResourcePlanRecord(record, [
    { id: "plan-running:quiz", type: "quiz", title: "栈测验", subtitle: "等待生成", meta: [], status: "pending", version: 1, sources: 0 },
  ]);

  assert.deepEqual(
    recovered.resources.map((item) => [item.id, item.status]).sort(),
    [["plan-running:lecture", "review"], ["plan-running:quiz", "pending"]],
  );
});
