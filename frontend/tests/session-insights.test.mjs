import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyResourceFilters,
  filterResources,
  findQuizResource,
  getDashboardInsights,
  getHomeModules,
  getPathProgress,
  getResourceStatusCounts,
  getResourceTypeCounts,
  hasLearningSession,
  normalizeResourceStatusFilter,
  RESOURCE_STATUS_FILTERS,
} from "../lib/session-insights.ts";
import {
  applyPracticeProfile,
  buildPathAdjustment,
  gradeQuizSubmission,
} from "../lib/practice-feedback.ts";

const profile = [
  { key: "knowledge", label: "知识基础", value: 60, delta: 10 },
  { key: "goal", label: "目标清晰", value: 90, delta: 40 },
];

const resources = [
  {
    id: "explainer",
    type: "explainer",
    title: "动态规划讲义",
    subtitle: "五步法",
    meta: [],
    status: "ready",
    version: 1,
    sources: 5,
  },
  {
    id: "quiz",
    type: "quiz",
    title: "递归专项练习",
    subtitle: "薄弱点定向命题",
    meta: [],
    status: "ready",
    version: 2,
    sources: 4,
    data: { questions: [{ id: "q1", stem: "测试题", answer: "A" }] },
  },
  {
    id: "video",
    type: "video",
    title: "动画短片",
    subtitle: "排队中",
    meta: [],
    status: "pending",
    version: 1,
    sources: 3,
  },
];

const path = [
  { day: "D1", title: "递归回炉", desc: "建立直觉", types: ["video"], state: "current" },
  { day: "D2", title: "五步法", desc: "完成练习", types: ["quiz"], state: "todo" },
];

test("hasLearningSession only becomes true after useful session output exists", () => {
  assert.equal(hasLearningSession({ hasRunMain: false, tags: [], resources: [], path: [] }), false);
  assert.equal(hasLearningSession({ hasRunMain: true, tags: [], resources: [], path: [] }), true);
  assert.equal(hasLearningSession({ hasRunMain: false, tags: ["视觉型"], resources: [], path: [] }), true);
});

test("dashboard insights summarize reviewed outputs and learner state", () => {
  const insights = getDashboardInsights({
    profile,
    tags: ["视觉型学习者", "薄弱：递归"],
    resources,
    path,
  });

  assert.deepEqual(insights, {
    profileAverage: 75,
    generatedResources: 2,
    readyResources: 2,
    citationCount: 9,
    pathStages: 2,
    currentStage: "递归回炉",
    weakTags: ["薄弱：递归"],
    quizQuestions: 1,
  });
});

test("home modules expose generated materials and wrongbook entry points", () => {
  const modules = getHomeModules({
    profile,
    tags: ["视觉型学习者", "薄弱：递归"],
    resources,
    path,
    practiceAttempts: [
      {
        id: "a1",
        resourceId: "quiz",
        title: "递归专项练习",
        submittedAt: "2026-06-16T00:00:00.000Z",
        score: 50,
        correctCount: 1,
        total: 2,
        answers: { q1: "A" },
        wrongQuestions: [{ id: "q2", stem: "第二题", chosen: "A", answer: "B" }],
      },
    ],
  });

  assert.deepEqual(
    modules.map((module) => [module.id, module.title, module.href, module.value]),
    [
      ["resources", "生成资料", "/create", "2/2"],
      ["practice", "智能练习", "/practice", "最近 50 分"],
      ["wrongbook", "错题本", "/practice", "1 道"],
      ["path", "总学习路径", "/path", "2 阶段"],
      ["profile", "学习画像", "/profile", "2 标签"],
      ["kb", "课程知识库", "/kb", "数据结构"],
    ]
  );
});

test("resource search excludes unpublished candidates", () => {
  assert.deepEqual(filterResources(resources, "递归"), [resources[1]]);
  assert.deepEqual(filterResources(resources, "讲义"), [resources[0]]);
  assert.deepEqual(filterResources(resources, "动画"), []);
  assert.equal(filterResources(resources, "").length, 2);
});

test("resource centers publish only reviewed resources and normalize legacy failure filters", () => {
  const managedResources = [
    ...resources,
    {
      id: "code",
      type: "code",
      title: "递归代码案例",
      subtitle: "驳回重做中",
      meta: [],
      status: "rejected",
      version: 1,
      sources: 1,
    },
    {
      id: "courseware",
      type: "courseware",
      title: "动态规划课件",
      subtitle: "待审核",
      meta: [],
      status: "review",
      version: 1,
      sources: 2,
    },
    {
      id: "failed-reading",
      type: "reading",
      title: "生成失败的阅读资料",
      subtitle: "可重试",
      meta: [],
      status: "failed",
      version: 1,
      sources: 0,
    },
  ];

  assert.deepEqual(getResourceTypeCounts(managedResources), {
    all: 2,
    explainer: 1,
    mindmap: 0,
    quiz: 1,
    solution: 0,
    reading: 0,
    code: 0,
    video: 0,
    courseware: 0,
    interactive: 0,
  });
  assert.deepEqual(getResourceStatusCounts(managedResources), {
    all: 2,
    ready: 2,
  });
  assert.equal(RESOURCE_STATUS_FILTERS.some((item) => item.id === "failed"), false);
  assert.equal(normalizeResourceStatusFilter("failed"), "all");
  assert.equal(normalizeResourceStatusFilter("rejected"), "all");
  assert.deepEqual(
    applyResourceFilters(managedResources, { type: "all", status: "all", query: "" }).map((r) => r.id),
    ["explainer", "quiz"]
  );
  assert.deepEqual(
    applyResourceFilters(managedResources, { type: "all", status: "failed", query: "" }).map((r) => r.id),
    ["explainer", "quiz"]
  );
  assert.deepEqual(
    applyResourceFilters(managedResources, { type: "courseware", status: "review", query: "" }).map((r) => r.id),
    []
  );
  assert.deepEqual(
    applyResourceFilters(managedResources, { type: "all", status: "all", query: "代码" }).map((r) => r.id),
    [],
    "rejected resources must not appear even when search matches them"
  );
});

test("quiz and path selectors expose generated learning actions", () => {
  assert.equal(findQuizResource(resources)?.id, "quiz");
  assert.equal(
    findQuizResource([{ ...resources[1], status: "rejected" }]),
    undefined,
    "rejected quizzes must not be available for practice"
  );
  assert.deepEqual(getPathProgress(path), {
    currentIndex: 0,
    currentPosition: 1,
    total: 2,
    ratio: 0.5,
  });
  assert.deepEqual(getPathProgress([]), {
    currentIndex: -1,
    currentPosition: 0,
    total: 0,
    ratio: 0,
  });
});

test("quiz grading produces a durable wrong-question payload", () => {
  const submission = gradeQuizSubmission(
    [
      { id: "q1", stem: "第一题", options: ["A. 对", "B. 错"], answer: "A" },
      { id: "q2", stem: "第二题", options: ["A. 对", "B. 错"], answer: "B", explanation: "应选 B" },
    ],
    { q1: "A", q2: "A" }
  );

  assert.equal(submission.score, 50);
  assert.equal(submission.correctCount, 1);
  assert.equal(submission.total, 2);
  assert.deepEqual(submission.wrongQuestions, [
    {
      id: "q2",
      stem: "第二题",
      chosen: "A",
      answer: "B",
      explanation: "应选 B",
    },
  ]);
});

test("practice feedback updates profile evidence and creates a real path adjustment", () => {
  const submission = {
    score: 50,
    correctCount: 1,
    total: 2,
    answers: { q1: "A", q2: "A" },
    wrongQuestions: [{ id: "q2", stem: "第二题", chosen: "A", answer: "B" }],
  };
  const updated = applyPracticeProfile(profile, submission);

  assert.deepEqual(updated, [
    { key: "knowledge", label: "知识基础", value: 57, delta: -3 },
    { key: "goal", label: "目标清晰", value: 90, delta: 40 },
  ]);
  assert.equal(
    buildPathAdjustment("递归专项练习", submission),
    "递归专项练习 50 分，1 道错题已归档；路径保留当前阶段并增加错题复盘。"
  );
});

test("standalone pages are wired to the shared orchestrator session", async () => {
  const files = {
    dashboard: await readFile(new URL("../app/app/page.tsx", import.meta.url), "utf8"),
    profile: await readFile(new URL("../app/profile/page.tsx", import.meta.url), "utf8"),
    resources: await readFile(new URL("../app/resources/page.tsx", import.meta.url), "utf8"),
    desktopVideoLearning: await readFile(
      new URL("../components/desktop/desktop-video-learning.tsx", import.meta.url),
      "utf8"
    ).catch(() => ""),
    desktopVideoRoute: await readFile(
      new URL("../app/desktop/video-learning/page.tsx", import.meta.url),
      "utf8"
    ),
    desktopPath: await readFile(
      new URL("../components/desktop/desktop-path.tsx", import.meta.url),
      "utf8"
    ),
    practice: await readFile(new URL("../app/practice/page.tsx", import.meta.url), "utf8"),
    path: await readFile(new URL("../app/path/page.tsx", import.meta.url), "utf8"),
    shell: await readFile(new URL("../components/layout/app-shell.tsx", import.meta.url), "utf8"),
    quizRunner: await readFile(new URL("../components/quiz-runner.tsx", import.meta.url), "utf8"),
    hook: await readFile(new URL("../hooks/use-orchestrator.ts", import.meta.url), "utf8"),
    globals: await readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  };

  for (const [name, source] of Object.entries(files).filter(
    ([name]) =>
      ![
        "hook",
        "quizRunner",
        "globals",
        "shell",
        "desktopVideoRoute",
        "desktopPath",
      ].includes(name)
  )) {
    assert.match(source, /useOrchestratorContext/, `${name} must consume the shared session`);
  }
  assert.match(files.dashboard, /getDashboardInsights/);
  assert.match(files.dashboard, /getHomeModules/);
  assert.match(files.profile, /ProfilePanel/);
  assert.match(files.resources, /ResourceCard/);
  assert.match(files.resources, /ResourceViewer/);
  assert.match(files.resources, /applyResourceFilters/);
  assert.match(files.resources, /RESOURCE_TYPE_FILTERS/);
  assert.match(files.resources, /RESOURCE_STATUS_FILTERS/);
  assert.match(files.desktopVideoLearning, /searchBilibiliVideos/);
  assert.match(files.desktopVideoLearning, /analyzeBilibiliVideo/);
  assert.match(files.desktopVideoLearning, /recordWatchedVideo/);
  assert.match(files.desktopVideoLearning, /appendResources/);
  assert.match(files.desktopVideoRoute, /desktop-video-learning/);
  assert.match(files.desktopPath, /href="\/desktop\/video-learning"/);
  assert.doesNotMatch(files.desktopPath, /href="\/video-learning"/);
  assert.doesNotMatch(files.desktopPath, /\/desktop\/desktop\/video-learning/);
  assert.match(files.path, /watchedVideos/);
  assert.doesNotMatch(files.shell, /href:\s*"\/video-learning"/);
  assert.match(files.practice, /QuizRunner/);
  assert.match(files.practice, /recordPractice/);
  assert.match(files.practice, /practiceAttempts/);
  assert.match(files.path, /adjustments/);
  assert.doesNotMatch(files.path, /PATH_STEPS/);
  assert.match(files.quizRunner, /onSubmit/);
  assert.match(files.quizRunner, /gradeQuizSubmission/);
  assert.match(files.hook, /practiceAttempts/);
  assert.match(files.hook, /recordPractice/);
  assert.match(files.hook, /watchedVideos/);
  assert.match(files.hook, /recordWatchedVideo/);
  assert.match(files.hook, /appendResources/);
  assert.match(files.hook, /return\s*\{[\s\S]*hydrated,/);
  assert.match(files.globals, /--background:\s*oklch\(0\.975 0\.018 88\)/);
  assert.match(files.globals, /--surface-2:\s*oklch\(0\.948 0\.02 88\)/);
});
