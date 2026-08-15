import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStudyPlan,
  defaultStudyStageIndex,
} from "../lib/study-plan.ts";

const path = [
  {
    day: "D1",
    title: "线性表",
    desc: "学习线性结构",
    types: ["explainer"],
    state: "current",
    steps: [
      {
        title: "阅读讲义",
        detail: "建立概念",
        minutes: 30,
        resource_types: ["explainer"],
        resources: [
          { id: "explainer_c1", type: "explainer", title: "线性表讲义" },
        ],
      },
    ],
  },
  {
    day: "D2",
    title: "练习",
    desc: "完成测验",
    types: ["quiz"],
    state: "todo",
    steps: [
      {
        title: "答题",
        detail: "完成题目",
        minutes: 20,
        resource_types: ["quiz"],
      },
    ],
  },
];

const resource = (overrides) => ({
  id: "resource",
  type: "explainer",
  title: "学习资料",
  subtitle: "",
  meta: [],
  status: "ready",
  version: 1,
  sources: 0,
  ...overrides,
});

test("projects real path stages and prioritizes an explicitly linked resource", () => {
  const resources = [
    resource({ id: "explainer_other", title: "其他讲义" }),
    resource({ id: "explainer_c1", title: "线性表讲义" }),
    resource({ id: "quiz_c2", type: "quiz", title: "线性表测验" }),
  ];

  const plan = buildStudyPlan(path, resources);

  assert.equal(plan[0].resources[0].id, "explainer_c1");
  assert.equal(plan[1].resources[0].id, "quiz_c2");
  assert.equal(plan[0].minutes, 30);
  assert.equal(defaultStudyStageIndex(plan), 0);
});

test("excludes failed or rejected resources and de-duplicates by id", () => {
  const resources = [
    resource({ id: "explainer_c1", status: "rejected" }),
    resource({ id: "explainer_ready" }),
    resource({ id: "quiz_failed", type: "quiz", status: "failed" }),
  ];

  const plan = buildStudyPlan(path, resources);

  assert.deepEqual(plan[0].resources.map((item) => item.id), ["explainer_ready"]);
  assert.deepEqual(plan[1].resources, []);
});

test("does not invent a study plan without a generated path", () => {
  assert.deepEqual(buildStudyPlan([], [resource({ id: "orphan" })]), []);
  assert.equal(defaultStudyStageIndex([]), 0);
});
