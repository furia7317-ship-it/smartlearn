import test from "node:test";
import assert from "node:assert/strict";

import {
  applyResourcePathAttachments,
  bindSubjectSupplementRequest,
  buildMasterLearningPath,
  buildSubjectLearningPaths,
  reflowSubjectPath,
} from "../lib/master-learning-path.ts";
import { buildDailyTaskPlan } from "../lib/daily-task-plan.ts";

function record(id, subject) {
  const days = [1, 2].map((number) => ({
    day: `D${number}`,
    title: `${subject}${number === 1 ? "基础" : "进阶"}`,
    objective: `掌握${subject}第${number}部分`,
    minutes: 30,
    steps: [
      {
        id: `${id}-task-${number}`,
        title: `学习${subject}${number}`,
        detail: "完成真实学习任务",
        minutes: 30,
        type: "study",
        resource_types: ["explainer"],
        completion_kind: "resource_read",
      },
    ],
  }));
  return {
    plan: {
      plan_id: id,
      student_id: "student",
      version: 1,
      status: "completed",
      request_summary: `请生成学习路径\n学习主题：${subject}`,
      complexity: { level: "complex", reasons: [], auto_execute: false },
      constraints: { days: 2, daily_minutes: 30, difficulty: "适中", material_types: ["explainer"] },
      days: [],
      tasks: [],
      validation: { valid: true, errors: [], warnings: [] },
    },
    execution: {
      resources: [],
      schedule: days,
      task_progress: {},
      coverage: {},
      integration: {},
    },
  };
}

const TODAY = new Date("2026-07-16T08:00:00+08:00");

test("completed learning plans recover from plan days when the legacy schedule snapshot is missing", () => {
  const legacy = record("plan-data", "数据结构");
  legacy.plan.days = [
    {
      day: "D1",
      title: "线性表基础",
      knowledge_points: ["线性表"],
      objective: "理解线性表的基本结构",
      minutes: 40,
      prerequisites: [],
      task_ids: ["lecture-d1", "quiz-d1"],
      actions: ["阅读讲义", "完成练习"],
    },
  ];
  legacy.plan.tasks = [
    {
      task_id: "lecture-d1",
      day: "D1",
      agent: "explainer",
      type: "explainer",
      title: "线性表讲义",
      knowledge_points: ["线性表"],
      difficulty: "适中",
      audience: "初学者",
      outline: { objective: "理解线性表", sections: [] },
      quality_criteria: [],
      source_ids: [],
      depends_on: [],
      status: "ready",
      review: null,
      retry_count: 0,
    },
    {
      task_id: "quiz-d1",
      day: "D1",
      agent: "quiz",
      type: "quiz",
      title: "线性表练习",
      knowledge_points: ["线性表"],
      difficulty: "适中",
      audience: "初学者",
      outline: { objective: "检查线性表掌握情况", sections: [] },
      quality_criteria: [],
      source_ids: [],
      depends_on: ["lecture-d1"],
      status: "ready",
      review: null,
      retry_count: 0,
    },
  ];
  legacy.execution.schedule = [];

  const subjects = buildSubjectLearningPaths({
    plans: { data: legacy },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "ready", updatedAt: 1 },
    },
    today: TODAY,
  });

  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].title, "数据结构");
  assert.equal(subjects[0].path.length, 1);
  assert.deepEqual(
    subjects[0].path[0].steps.map((task) => [task.title, task.completion_kind]),
    [
      ["线性表讲义", "resource_read"],
      ["线性表练习", "quiz_submission"],
    ],
  );
  assert.equal(
    subjects[0].path[0].steps[1].resources[0].id,
    "plan-data:quiz-d1",
  );
});

test("ready and future scheduled subject paths do not enter the master schedule", () => {
  const subjects = buildSubjectLearningPaths({
    plans: {
      data: record("plan-data", "数据结构与算法"),
      math: record("plan-math", "高等数学"),
    },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "active", activationDate: "2026-07-16", updatedAt: 1 },
      "plan-math": { status: "scheduled", activationDate: "2026-07-20", updatedAt: 1 },
    },
    today: TODAY,
  });
  const master = buildMasterLearningPath(subjects, TODAY);

  assert.deepEqual(master.activeSubjects.map((subject) => subject.title), ["数据结构与算法"]);
  assert.deepEqual(master.scheduledSubjects.map((subject) => subject.title), ["高等数学"]);
  assert.equal(master.path.length, 2);
  assert.ok(master.path.every((step) => step.subject_titles?.includes("数据结构与算法")));
  assert.ok(master.path.every((step) => !step.subject_titles?.includes("高等数学")));
});

test("a scheduled subject becomes active on its activation date", () => {
  const subjects = buildSubjectLearningPaths({
    plans: { math: record("plan-math", "高等数学") },
    fallbackPath: [],
    controls: {
      "plan-math": { status: "scheduled", activationDate: "2026-07-16", updatedAt: 1 },
    },
    today: TODAY,
  });

  assert.equal(subjects[0].status, "active");
  assert.equal(buildMasterLearningPath(subjects, TODAY).activeSubjects.length, 1);
});

test("a deleted subject path disappears from both subject and master paths", () => {
  const subjects = buildSubjectLearningPaths({
    plans: {
      data: record("plan-data", "数据结构与算法"),
      math: record("plan-math", "高等数学"),
    },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "deleted", updatedAt: 2 },
      "plan-math": { status: "active", activationDate: "2026-07-16", updatedAt: 1 },
    },
    today: TODAY,
  });
  const master = buildMasterLearningPath(subjects, TODAY);

  assert.deepEqual(subjects.map((subject) => subject.title), ["高等数学"]);
  assert.deepEqual(master.activeSubjects.map((subject) => subject.title), ["高等数学"]);
  assert.ok(master.path.every((step) => !step.subject_titles?.includes("数据结构与算法")));
});

test("daily-time replanning reuses every existing task and completion key", () => {
  const subjects = buildSubjectLearningPaths({
    plans: { data: record("plan-data", "数据结构") },
    fallbackPath: [],
    controls: {},
    today: TODAY,
  });
  const originalTasks = subjects[0].path.flatMap((step) => step.steps);
  const reflowed = reflowSubjectPath(subjects[0].path, 60);
  const reflowedTasks = reflowed.flatMap((step) => step.steps);

  assert.equal(reflowed.length, 1);
  assert.deepEqual(
    reflowedTasks.map((task) => task.completion_key),
    originalTasks.map((task) => task.completion_key),
  );
  assert.deepEqual(
    reflowedTasks.map((task) => task.resources),
    originalTasks.map((task) => task.resources),
  );
});

test("manual resource attachment follows a stable task without changing the schedule", () => {
  const subjects = buildSubjectLearningPaths({
    plans: { data: record("plan-data", "数据结构") },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "active", activationDate: "2026-07-16", updatedAt: 1 },
    },
    today: TODAY,
  });
  const targetTask = subjects[0].path[1].steps[0];
  const attached = applyResourcePathAttachments(subjects, {
    "manual-resource": {
      resourceId: "manual-resource",
      resourceType: "video",
      resourceTitle: "链表反转补充视频",
      subjectId: "plan-data",
      taskKey: targetTask.completion_key,
      attachedAt: 1,
    },
  });

  assert.equal(attached[0].path.length, subjects[0].path.length);
  assert.equal(attached[0].totalTasks, subjects[0].totalTasks);
  assert.equal(attached[0].path[1].steps[0].resources.length, 2);
  assert.ok(attached[0].path[1].steps[0].resources.some((resource) =>
    resource.id === "manual-resource"
      && resource.type === "video"
      && resource.title === "链表反转补充视频",
  ));
  assert.ok(attached[0].path[1].steps[0].resources.some((resource) =>
    resource.id === "plan-data:plan-data-task-2",
  ));
  assert.ok(attached[0].path[1].steps[0].resource_types.includes("video"));
  assert.ok(
    buildMasterLearningPath(attached, TODAY).path[1].steps[0].resources
      .some((resource) => resource.id === "manual-resource"),
  );
});

test("a supplement plan appends to its subject instead of creating another subject", () => {
  const base = record("plan-data", "数据结构");
  const supplement = record("plan-data-extra", "链表进阶");
  supplement.plan.request_summary = [
    "请补充现有科目学习路径",
    "学习主题：数据结构",
    "补充到科目路径ID：plan-data",
    "补充要求：增加链表反转",
  ].join("\n");
  const subjects = buildSubjectLearningPaths({
    plans: { base, supplement },
    fallbackPath: [],
    controls: {},
    today: TODAY,
  });

  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].id, "plan-data");
  assert.equal(subjects[0].path.length, 4);
  assert.deepEqual(subjects[0].sourcePlanIds, ["plan-data", "plan-data-extra"]);
});

test("historical duplicate full paths collapse without concatenating their schedules", () => {
  const subjects = buildSubjectLearningPaths({
    plans: {
      original: record("plan-data", "数据结构"),
      duplicate: record("plan-data-copy", "一份数据结构"),
    },
    fallbackPath: [],
    controls: {},
    today: TODAY,
  });

  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].title, "数据结构");
  assert.equal(subjects[0].path.length, 2);
  assert.deepEqual(subjects[0].sourcePlanIds, ["plan-data", "plan-data-copy"]);
});

test("a later full path replaces the old subject schedule and inherits its activation", () => {
  const original = record("plan-data", "数据结构");
  const replacement = record("plan-data-new", "数据结构");
  replacement.execution.schedule[0].steps[0].title = "新的覆盖任务";
  replacement.execution.schedule.push({
    ...structuredClone(replacement.execution.schedule[1]),
    day: "D3",
    title: "数据结构综合",
    steps: [{
      ...structuredClone(replacement.execution.schedule[1].steps[0]),
      id: "plan-data-new-task-3",
      title: "新的综合任务",
    }],
  });
  const subjects = buildSubjectLearningPaths({
    plans: { original, replacement },
    fallbackPath: [],
    controls: {
      "plan-data": {
        status: "active",
        activationDate: "2026-07-16",
        dailyMinutes: 60,
        updatedAt: 10,
      },
    },
    today: TODAY,
  });

  assert.equal(subjects.length, 1);
  assert.equal(subjects[0].id, "plan-data");
  assert.equal(subjects[0].status, "active");
  assert.equal(subjects[0].activationDate, "2026-07-16");
  assert.equal(subjects[0].dailyMinutes, 60);
  assert.equal(subjects[0].path.flatMap((step) => step.steps).length, 3);
  assert.ok(subjects[0].path.flatMap((step) => step.steps).some((task) => task.title === "新的覆盖任务"));
  assert.deepEqual(subjects[0].sourcePlanIds, ["plan-data", "plan-data-new"]);
});

test("a full-path replacement never overwrites a different prefix-similar subject", () => {
  const data = record("plan-data", "数据结构");
  const algorithms = record("plan-algorithms", "数据结构与算法");
  const replacement = record("plan-data-new", "数据结构");
  replacement.execution.schedule[0].steps[0].title = "仅覆盖数据结构的新任务";

  const subjects = buildSubjectLearningPaths({
    plans: { data, algorithms, replacement },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "active", activationDate: "2026-07-16", updatedAt: 10 },
      "plan-algorithms": { status: "active", activationDate: "2026-07-16", updatedAt: 9 },
    },
    today: TODAY,
  });

  assert.equal(subjects.length, 2);
  const dataSubject = subjects.find((subject) => subject.id === "plan-data");
  const algorithmsSubject = subjects.find((subject) => subject.id === "plan-algorithms");
  assert.ok(dataSubject);
  assert.ok(algorithmsSubject);
  assert.deepEqual(dataSubject.sourcePlanIds, ["plan-data", "plan-data-new"]);
  assert.deepEqual(algorithmsSubject.sourcePlanIds, ["plan-algorithms"]);
  assert.ok(dataSubject.path.flatMap((step) => step.steps).some((task) =>
    task.title === "仅覆盖数据结构的新任务",
  ));
  assert.ok(algorithmsSubject.path.flatMap((step) => step.steps).every((task) =>
    task.title !== "仅覆盖数据结构的新任务",
  ));
});

test("a matching subject request is bound to the existing subject id", () => {
  const subjects = buildSubjectLearningPaths({
    plans: { data: record("plan-data", "数据结构") },
    fallbackPath: [],
    controls: {},
    today: TODAY,
  });
  const routed = bindSubjectSupplementRequest(
    "请完善数据结构学习路径，增加链表反转",
    subjects,
  );

  assert.match(routed, /补充到科目路径ID：plan-data/);
  assert.match(routed, /不创建新的科目路径/);
});

test("a new matching full-path request is not silently converted into a supplement", () => {
  const subjects = buildSubjectLearningPaths({
    plans: { data: record("plan-data", "数据结构") },
    fallbackPath: [],
    controls: {},
    today: TODAY,
  });
  const request = "请重新生成数据结构学习路径并覆盖之前的安排";

  assert.equal(bindSubjectSupplementRequest(request, subjects), request);
});

test("master days merge active subjects and preserve stable completion keys", () => {
  const subjects = buildSubjectLearningPaths({
    plans: {
      data: record("plan-data", "数据结构与算法"),
      math: record("plan-math", "高等数学"),
    },
    fallbackPath: [],
    controls: {
      "plan-data": { status: "active", activationDate: "2026-07-16", updatedAt: 1 },
      "plan-math": { status: "active", activationDate: "2026-07-16", updatedAt: 1 },
    },
    today: TODAY,
  });
  const master = buildMasterLearningPath(subjects, TODAY);
  const firstDay = master.path[0];
  const keys = firstDay.steps.map((task) => task.completion_key);

  assert.deepEqual([...firstDay.subject_titles].sort(), ["数据结构与算法", "高等数学"].sort());
  assert.equal(firstDay.steps.length, 2);
  assert.equal(new Set(keys).size, 2);
  assert.ok(firstDay.steps.some((task) => task.title.startsWith("数据结构与算法 ·")));
  assert.ok(firstDay.steps.some((task) => task.title.startsWith("高等数学 ·")));

  const completed = buildDailyTaskPlan(firstDay, 0, [keys[0]]);
  assert.equal(completed.completedTaskCount, 1);
  assert.equal(completed.tasks[0].key, keys[0]);
});
