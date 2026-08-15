import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPathDashboardPlan,
  buildDailyTaskPlan,
  materialCompletionKey,
  taskCompletionKey,
} from "../lib/daily-task-plan.ts";
import * as pathResourceLinks from "../lib/path-resource-links.ts";
import { buildPathResourceCollection, collectPathResourceTypes, findResourceForTask } from "../lib/path-resource-links.ts";

const step = {
  day: "D1",
  title: "数据结构基础定位",
  desc: "完成基础概念的理解、练习和输出",
  types: ["explainer", "mindmap", "quiz"],
  state: "current",
  minutes: 75,
  steps: [
    {
      title: "学习：数据结构基础定位",
      detail: "阅读讲义/导图，先建立概念框架。",
      minutes: 30,
      resource_types: ["explainer", "mindmap"],
    },
    {
      title: "练习：数据结构基础定位",
      detail: "完成配套题目，把知识点转成可操作步骤。",
      minutes: 30,
      resource_types: ["quiz"],
    },
    {
      title: "复盘输出",
      detail: "写下今天最不稳的 1 个点和明天要追问的问题。",
      minutes: 15,
      resource_types: [],
    },
  ],
};

test("path resource links expose one shared task-target resolver", () => {
  assert.equal(typeof pathResourceLinks.resolveResourceForTaskTarget, "function");
});

test("path material type summary includes every generated type owned by the active plan", () => {
  const path = [{
    ...step,
    steps: [{
      ...step.steps[0],
      resource_types: ["explainer"],
      resources: [{ id: "plan-current:explainer-d1", type: "explainer", title: "D1" }],
    }],
  }];
  const resources = [
    { id: "plan-current:code-d2", type: "code", status: "ready", version: 1, data: { plan_id: "plan-current" } },
    { id: "plan-current:mindmap-d3", type: "mindmap", status: "ready", version: 1, data: { plan_id: "plan-current" } },
    { id: "plan-other:quiz", type: "quiz", status: "ready", version: 1, data: { plan_id: "plan-other" } },
  ];

  assert.deepEqual(collectPathResourceTypes(path, resources), ["explainer", "code", "mindmap"]);
});

test("daily task plan makes each study day actionable", () => {
  const plan = buildDailyTaskPlan(step, 0, [
    "0:task:0",
    "0:explainer",
    "0:mindmap",
  ]);

  assert.equal(plan.objective, "掌握数据结构基础定位");
  assert.equal(plan.totalMinutes, 75);
  assert.equal(plan.taskCount, 3);
  assert.equal(plan.resourceCount, 3);
  assert.equal(plan.completedTaskCount, 1);
  assert.equal(plan.progressLabel, "1/3");
  assert.deepEqual(
    plan.tasks.map((task) => ({
      key: task.key,
      action: task.action,
      resourceLabel: task.resourceLabel,
      href: task.href,
      standard: task.standard,
      completed: task.completed,
    })),
    [
      {
        key: "0:task:0",
        action: "学习",
        resourceLabel: "打开讲义",
        href: "/resources",
        standard: "读完资料并在配套练习达到 60 分后自动记录",
        completed: true,
      },
      {
        key: "0:task:1",
        action: "练习",
        resourceLabel: "开始练习",
        href: "/practice",
        standard: "提交答案后自动记录",
        completed: false,
      },
      {
        key: "0:task:2",
        action: "复盘",
        resourceLabel: "写复盘",
        href: "/resources",
        standard: "提交学习产出后自动记录",
        completed: false,
      },
    ]
  );
  assert.deepEqual(
    plan.tasks.map((task) => task.resourceTargets?.map((resource) => [resource.key, resource.type])),
    [
      [
        ["0:explainer", "explainer"],
        ["0:mindmap", "mindmap"],
      ],
      [["0:quiz", "quiz"]],
      [],
    ]
  );
});

test("task completion keys are stable per day and task index", () => {
  assert.equal(taskCompletionKey(2, 4), "2:task:4");
});

test("path dashboard separates today action from compact upcoming stages", () => {
  const nextStep = {
    day: "D2",
    title: "复盘巩固",
    desc: "复盘前面章节，补齐错题和薄弱点。",
    types: ["quiz", "reading"],
    state: "todo",
    minutes: 90,
    steps: [
      {
        title: "练习：错题回看",
        detail: "重做上一阶段错题，标记仍然不会的题。",
        minutes: 45,
        resource_types: ["quiz"],
      },
      {
        title: "学习：综合串联",
        detail: "把概念和题型串成一张复习清单。",
        minutes: 45,
        resource_types: ["reading"],
      },
    ],
  };
  const thirdStep = {
    day: "D3",
    title: "数据结构核心框架",
    desc: "梳理线性表、树、图的核心关系。",
    types: ["code", "explainer"],
    state: "todo",
    minutes: 80,
  };

  const dashboard = buildPathDashboardPlan([step, nextStep, thirdStep], [
    taskCompletionKey(0, 0),
    materialCompletionKey(0, "explainer"),
    materialCompletionKey(0, "mindmap"),
    taskCompletionKey(1, 0),
  ]);

  assert.equal(dashboard.today?.step.day, "D1");
  assert.equal(dashboard.today?.plan.progressLabel, "1/3");
  assert.deepEqual(
    dashboard.todayResources.map((resource) => [
      resource.key,
      resource.type,
      resource.taskAction,
      resource.taskTitle,
      resource.completed,
    ]),
    [
      ["0:explainer", "explainer", "学习", "数据结构基础定位", true],
      ["0:mindmap", "mindmap", "学习", "数据结构基础定位", true],
      ["0:quiz", "quiz", "练习", "数据结构基础定位", false],
    ]
  );
  assert.deepEqual(
    dashboard.upcoming.map((stage) => [
      stage.day,
      stage.title,
      stage.totalMinutes,
      stage.taskCount,
      stage.resourceCount,
      stage.progressLabel,
    ]),
    [
      ["D2", "复盘巩固", 90, 2, 2, "1/2"],
      ["D3", "数据结构核心框架", 80, 2, 2, "0/2"],
    ]
  );
});

test("daily task resources preserve concrete generated resource links", () => {
  const linkedStep = {
    ...step,
    steps: [
      {
        title: "学习：数据结构基础定位",
        detail: "先阅读讲义和导图。",
        minutes: 35,
        resource_types: ["explainer", "mindmap"],
        resources: [
          { id: "explainer_c1", type: "explainer", title: "数据结构基础讲义" },
          { id: "mindmap_c1", type: "mindmap", title: "数据结构导图" },
        ],
      },
      {
        title: "练习：数据结构基础定位",
        detail: "完成配套测验。",
        minutes: 30,
        resource_types: ["quiz"],
        resources: [{ id: "quiz_c1", type: "quiz", title: "数据结构基础测验" }],
      },
    ],
  };

  const dashboard = buildPathDashboardPlan([linkedStep], ["resource:explainer_c1"]);

  assert.equal(dashboard.today?.plan.resourceCount, 3);
  assert.deepEqual(
    dashboard.today?.plan.tasks.map((task) =>
      task.resourceTarget ? [task.resourceTarget.id, task.resourceTarget.type] : null
    ),
    [
      ["explainer_c1", "explainer"],
      ["quiz_c1", "quiz"],
    ]
  );
  assert.deepEqual(
    dashboard.todayResources.map((resource) => [
      resource.key,
      resource.id,
      resource.type,
      resource.title,
      resource.taskTitle,
      resource.completed,
    ]),
    [
      ["resource:explainer_c1", "explainer_c1", "explainer", "数据结构基础讲义", "数据结构基础定位", true],
      ["resource:mindmap_c1", "mindmap_c1", "mindmap", "数据结构导图", "数据结构基础定位", false],
      ["resource:quiz_c1", "quiz_c1", "quiz", "数据结构基础测验", "数据结构基础定位", false],
    ]
  );
});

test("path resource collection folds every path-generated material into one collection", () => {
  const path = [
    {
      day: "D1",
      title: "foundation",
      desc: "start",
      types: ["explainer", "mindmap"],
      state: "current",
      steps: [
        {
          title: "study: foundation",
          detail: "read and map",
          minutes: 30,
          resource_types: ["explainer", "mindmap"],
          resources: [
            { id: "explainer_c1", type: "explainer", title: "Foundation lecture" },
            { id: "mindmap_c1", type: "mindmap", title: "Foundation map" },
          ],
        },
      ],
    },
    {
      day: "D2",
      title: "practice",
      desc: "apply",
      types: ["quiz", "code"],
      state: "todo",
      steps: [
        {
          title: "practice: quiz and code",
          detail: "answer and implement",
          minutes: 40,
          resource_types: ["quiz", "code"],
          resources: [
            { id: "quiz_c2", type: "quiz", title: "Practice quiz" },
            { id: "code_c2", type: "code", title: "Practice code" },
          ],
        },
      ],
    },
  ];
  const generated = [
    { id: "explainer_c1", type: "explainer", title: "Foundation lecture", subtitle: "", meta: [], status: "ready", version: 1, sources: 1 },
    { id: "mindmap_c1", type: "mindmap", title: "Foundation map", subtitle: "", meta: [], status: "ready", version: 1, sources: 1 },
    { id: "quiz_c2", type: "quiz", title: "Practice quiz", subtitle: "", meta: [], status: "review", version: 1, sources: 1 },
    { id: "code_c2", type: "code", title: "Practice code", subtitle: "", meta: [], status: "ready", version: 1, sources: 1 },
  ];

  const collection = buildPathResourceCollection(path, [], generated);

  assert.equal(collection?.key, "learning-path");
  assert.equal(collection?.total, 3);
  assert.equal(collection?.readyCount, 3);
  assert.deepEqual(
    collection?.stages.map((stage) => [stage.day, stage.title, stage.total]),
    [
      ["D1", "foundation", 2],
      ["D2", "practice", 1],
    ]
  );
  assert.deepEqual(
    collection?.resources.map((entry) => [entry.stageDay, entry.item.id, entry.target.type]),
    [
      ["D1", "explainer_c1", "explainer"],
      ["D1", "mindmap_c1", "mindmap"],
      ["D2", "code_c2", "code"],
    ]
  );
});

test("path resource collection includes only ready resources explicitly bound to the current path", () => {
  const path = [
    {
      day: "D1",
      title: "bound stage",
      desc: "explicit resources",
      types: ["explainer", "mindmap"],
      state: "current",
      steps: [
        {
          title: "study bound materials",
          detail: "open exact resources",
          minutes: 30,
          resource_types: ["explainer", "mindmap"],
          resources: [
            { id: "bound-ready", type: "explainer", title: "Ready lecture" },
            { id: "bound-review", type: "mindmap", title: "Review map" },
          ],
        },
      ],
    },
    {
      day: "D2",
      title: "legacy stage",
      desc: "no explicit resource id",
      types: ["quiz"],
      state: "todo",
      steps: [
        {
          title: "legacy quiz",
          detail: "type only",
          minutes: 20,
          resource_types: ["quiz"],
        },
      ],
    },
  ];
  const resources = [
    { id: "bound-ready", type: "explainer", title: "Ready lecture", subtitle: "", meta: [], status: "ready", version: 1, sources: 1 },
    { id: "bound-review", type: "mindmap", title: "Review map", subtitle: "", meta: [], status: "review", version: 1, sources: 1 },
    { id: "legacy-ready", type: "quiz", title: "Legacy quiz", subtitle: "", meta: [], status: "ready", version: 1, sources: 1 },
    { id: "unrelated-ready", type: "explainer", title: "Other lecture", subtitle: "", meta: [], status: "ready", version: 2, sources: 1 },
  ];

  const collection = buildPathResourceCollection(path, [], resources);

  assert.deepEqual(
    collection?.resources.map((entry) => entry.item.id),
    ["bound-ready"],
  );
  assert.deepEqual(collection?.stages.map((stage) => stage.day), ["D1"]);
  assert.equal(collection?.total, 1);
  assert.equal(collection?.readyCount, 1);
});

test("tasks without an exact generated resource never open an unrelated material", () => {
  const plan = buildDailyTaskPlan(step, 0, []);
  const reviewTask = plan.tasks[2];
  const generated = [
    {
      id: "explainer_c1",
      type: "explainer",
      title: "Foundation lecture",
      subtitle: "",
      meta: [],
      status: "ready",
      version: 1,
      sources: 1,
    },
  ];

  assert.equal(reviewTask.resourceTargets.length, 0);
  assert.equal(findResourceForTask(reviewTask, generated), undefined);
});

test("an explicit path target never falls back to an unrelated resource", () => {
  const plan = buildDailyTaskPlan(
    {
      ...step,
      steps: [
        {
          title: "学习：指定讲义",
          detail: "打开规划绑定的讲义。",
          minutes: 30,
          resource_types: ["explainer"],
          resources: [{ id: "expected-explainer", type: "explainer", title: "指定讲义" }],
        },
      ],
    },
    0,
    [],
  );
  const task = plan.tasks[0];
  const resources = [
    {
      id: "old-explainer",
      type: "explainer",
      title: "旧计划讲义",
      subtitle: "",
      meta: [],
      status: "ready",
      version: 3,
      sources: 1,
    },
    {
      id: "expected-explainer",
      type: "explainer",
      title: "指定讲义",
      subtitle: "",
      meta: [],
      status: "review",
      version: 1,
      sources: 1,
    },
  ];

  assert.equal(findResourceForTask(task, resources), undefined);
});

test("task target resolver only opens the exact ready resource for an explicit id", () => {
  const task = buildDailyTaskPlan(
    {
      ...step,
      steps: [
        {
          title: "学习：指定讲义",
          detail: "打开规划绑定的讲义。",
          minutes: 30,
          resource_types: ["explainer"],
          resources: [{ id: "expected-explainer", type: "explainer", title: "指定讲义" }],
        },
      ],
    },
    0,
    [],
  ).tasks[0];
  const target = task.resourceTargets[0];
  const unrelatedReady = {
    id: "old-explainer",
    type: "explainer",
    title: "旧计划讲义",
    subtitle: "",
    meta: [],
    status: "ready",
    version: 3,
    sources: 1,
  };
  const exactReview = {
    ...unrelatedReady,
    id: "expected-explainer",
    title: "指定讲义",
    status: "review",
  };

  assert.equal(
    pathResourceLinks.resolveResourceForTaskTarget(
      target,
      task,
      [unrelatedReady, exactReview],
    ),
    undefined,
  );

  const exactReady = { ...exactReview, status: "ready" };
  assert.equal(
    pathResourceLinks.resolveResourceForTaskTarget(
      target,
      task,
      [unrelatedReady, exactReady],
    )?.id,
    "expected-explainer",
  );
});

test("task target resolver preserves type and refuses unrelated legacy fallback", () => {
  const task = buildDailyTaskPlan(step, 0, []).tasks[0];
  const target = task.resourceTargets[0];
  const matchingReady = {
    id: "legacy-explainer",
    type: target.type,
    title: "Legacy matching material",
    subtitle: "",
    meta: [],
    status: "ready",
    version: 1,
    sources: 1,
  };
  const taskFallback = {
    ...matchingReady,
    id: "legacy-quiz",
    type: "quiz",
  };

  assert.equal(target.id, undefined);
  assert.equal(
    pathResourceLinks.resolveResourceForTaskTarget(
      target,
      task,
      [taskFallback, matchingReady],
    )?.id,
    "legacy-explainer",
  );
  assert.equal(pathResourceLinks.resolveResourceForTaskTarget(target, task, [taskFallback]), undefined);
});
