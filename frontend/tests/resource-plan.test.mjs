import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  movePlanDay,
  removePlanTask,
  updatePlanTask,
  validatePlanDraft,
} from "../lib/resource-plan.ts";

const samplePlan = {
  plan_id: "plan-1",
  student_id: "student-1",
  version: 1,
  status: "awaiting_confirmation",
  request_summary: "两天掌握数据结构",
  complexity: { level: "complex", reasons: ["multi_day"], auto_execute: false },
  constraints: { days: 2, daily_minutes: 60, difficulty: "适中", material_types: [] },
  days: [
    {
      day: "D1",
      title: "数组与链表",
      knowledge_points: ["数组", "链表"],
      objective: "掌握存储方式差异",
      minutes: 60,
      prerequisites: [],
      task_ids: ["explainer-d1"],
      actions: ["学习", "练习"],
    },
    {
      day: "D2",
      title: "栈与队列",
      knowledge_points: ["LIFO", "FIFO"],
      objective: "掌握访问顺序差异",
      minutes: 60,
      prerequisites: ["数组与链表"],
      task_ids: ["quiz-d2"],
      actions: ["测验", "复盘"],
    },
  ],
  tasks: [
    {
      task_id: "explainer-d1",
      day: "D1",
      agent: "explainer",
      type: "explainer",
      title: "数组与链表讲义",
      knowledge_points: ["数组", "链表"],
      difficulty: "基础",
      audience: "学习者",
      outline: {
        objective: "解释存储方式差异",
        sections: [
          { title: "存储", goal: "比较布局", must_cover: ["数组", "链表"], target_words: 300 },
        ],
      },
      quality_criteria: ["有对比示例"],
      source_ids: [],
      depends_on: [],
      status: "pending",
      retry_count: 0,
    },
    {
      task_id: "quiz-d2",
      day: "D2",
      agent: "quiz",
      type: "quiz",
      title: "栈与队列测验",
      knowledge_points: ["LIFO", "FIFO"],
      difficulty: "基础",
      audience: "学习者",
      outline: {
        objective: "检查访问顺序",
        sections: [
          { title: "辨析", goal: "区分顺序", must_cover: ["LIFO", "FIFO"], target_words: 200 },
        ],
      },
      quality_criteria: ["5 道题"],
      source_ids: [],
      depends_on: ["explainer-d1"],
      status: "pending",
      retry_count: 0,
    },
  ],
  validation: { valid: true, errors: [], warnings: [] },
};


test("removing a task also removes day and dependency references", () => {
  const next = removePlanTask(samplePlan, "explainer-d1");

  assert.deepEqual(next.days[0].task_ids, []);
  assert.deepEqual(next.tasks.find((task) => task.task_id === "quiz-d2").depends_on, []);
  assert.equal(samplePlan.days[0].task_ids.length, 1);
});


test("moving days renumbers D labels and task day bindings", () => {
  const next = movePlanDay(samplePlan, 1, 0);

  assert.equal(next.days[0].title, "栈与队列");
  assert.equal(next.days[0].day, "D1");
  assert.equal(next.tasks.find((task) => task.task_id === "quiz-d2").day, "D1");
  assert.equal(samplePlan.days[0].title, "数组与链表");
});


test("draft validation blocks confirmation with empty outlines", () => {
  const broken = updatePlanTask(samplePlan, "explainer-d1", {
    outline: { objective: "", sections: [] },
  });

  assert.equal(validatePlanDraft(broken).valid, false);
});


test("draft validation rejects dependency cycles and unmounted tasks", () => {
  const broken = structuredClone(samplePlan);
  broken.tasks[0].depends_on = ["quiz-d2"];
  broken.days[1].task_ids = [];

  const validation = validatePlanDraft(broken);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("依赖环")));
  assert.ok(validation.errors.some((error) => error.includes("未挂载")));
});


test("typed API sends only editable fields when saving", async () => {
  const source = await readFile(new URL("../lib/resource-plan-api.ts", import.meta.url), "utf8");
  assert.match(source, /constraints:\s*plan\.constraints/);
  assert.match(source, /days:\s*plan\.days/);
  assert.match(source, /tasks:\s*plan\.tasks/);
  assert.doesNotMatch(source, /validation:\s*plan\.validation/);
  assert.match(source, /confirm:\s*options\?\.confirm\s*\?\?\s*false/);
});
