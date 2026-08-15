import assert from "node:assert/strict";
import test from "node:test";

import { buildProfileInsights } from "../lib/profile-insights.ts";

const now = new Date("2026-07-29T12:00:00+08:00");

const subjectPath = {
  id: "subject-data-structures",
  title: "数据结构",
  requestSummary: "系统学习数据结构",
  status: "active",
  controlStatus: "active",
  activationDate: "2026-07-20",
  dailyMinutes: 45,
  sourcePlanIds: ["plan-1"],
  completedTasks: 1,
  totalTasks: 2,
  progress: 50,
  sourceStatus: "completed",
  path: [
    {
      day: "D1",
      title: "线性结构",
      desc: "掌握栈和队列的基本操作",
      objective: "理解线性结构并完成一次复盘",
      types: ["reading", "quiz"],
      state: "current",
      steps: [
        {
          title: "阅读栈与队列讲义",
          detail: "理解基本操作",
          minutes: 60,
          resource_types: ["reading"],
          completion_key: "subject-data-structures:0:task:0",
        },
        {
          title: "完成栈与队列练习",
          detail: "提交十道练习题",
          minutes: 30,
          resource_types: ["quiz"],
          completion_key: "subject-data-structures:0:task:1",
          resources: [
            {
              id: "quiz-stack",
              type: "quiz",
              title: "栈与队列练习",
            },
          ],
        },
      ],
    },
  ],
};

test("profile insights aggregate persisted learning records without sample values", () => {
  const insights = buildProfileInsights({
    now,
    profile: [
      { key: "knowledge", label: "知识基础", value: 64, delta: 4 },
      { key: "pace", label: "学习节奏", value: 56, delta: 2 },
    ],
    completedMaterials: ["subject-data-structures:0:task:0"],
    subjectPaths: [subjectPath],
    taskEvidence: {
      "subject-data-structures:0:task:0": {
        kind: "written_response",
        content: "我能解释栈和队列的差异。",
        completedAt: "2026-07-29T09:00:00+08:00",
        passed: true,
      },
    },
    practiceAttempts: [
      {
        id: "attempt-1",
        resourceId: "quiz-stack",
        title: "栈与队列练习",
        submittedAt: "2026-07-28T16:42:00+08:00",
        score: 70,
        correctCount: 7,
        total: 10,
        answers: {},
        wrongQuestions: [
          { id: "q1", stem: "队列的出队顺序？", chosen: "B", answer: "A" },
        ],
      },
    ],
    watchedVideos: [
      {
        bvid: "BV1",
        title: "线性表补充讲解",
        url: "https://www.bilibili.com/video/BV1",
        watched_seconds: 120,
        watched_at: "2026-07-27T20:00:00+08:00",
      },
    ],
    assessments: [
      {
        id: "assessment-1",
        subject: "数据结构",
        self_level: "中等",
        analysis: {
          knowledge_seed: { 栈: 0.6, 队列: 0.7 },
        },
        created_at: "2026-07-26T10:00:00+08:00",
      },
    ],
    papers: [],
  });

  assert.equal(insights.summary.studyMinutes, 62);
  assert.equal(insights.summary.completedQuestions, 10);
  assert.equal(insights.summary.accuracy, 70);
  assert.equal(insights.summary.mastery, 60);
  assert.equal(insights.summary.masteryDelta, 3);
  assert.equal(insights.summary.activityLevels.length, 30);
  assert.ok(insights.summary.activityLevels.some((level) => level > 0));
  assert.deepEqual(
    new Set(insights.evidence.map((item) => item.kind)),
    new Set(["diagnostic", "practice", "review"]),
  );
});

test("current focus follows the active subject path and its first incomplete task", () => {
  const insights = buildProfileInsights({
    now,
    profile: [],
    practiceAttempts: [],
    taskEvidence: {},
    completedMaterials: ["subject-data-structures:0:task:0"],
    watchedVideos: [],
    subjectPaths: [subjectPath],
    assessments: [],
    papers: [],
  });

  assert.equal(insights.focus?.subjectTitle, "数据结构");
  assert.equal(insights.focus?.stageTitle, "线性结构");
  assert.equal(insights.focus?.progress, 50);
  assert.equal(insights.focus?.remainingMinutes, 30);
  assert.equal(insights.focus?.statusLabel, "正在学习");
});

test("paper scores are used only as a fallback when no persisted practice attempt exists", () => {
  const insights = buildProfileInsights({
    now,
    profile: [],
    practiceAttempts: [],
    taskEvidence: {},
    completedMaterials: [],
    watchedVideos: [],
    subjectPaths: [],
    assessments: [],
    papers: [
      {
        id: "paper-1",
        exam_id: "exam-1",
        title: "算法阶段测验",
        topic: "算法",
        category: "阶段测验",
        tags: ["算法"],
        status: "graded",
        overall_score: 80,
        question_count: 20,
        created_at: "2026-07-29T08:00:00+08:00",
      },
    ],
  });

  assert.equal(insights.summary.completedQuestions, 20);
  assert.equal(insights.summary.accuracy, 80);
  assert.equal(insights.evidence[0]?.content, "算法阶段测验");
});
