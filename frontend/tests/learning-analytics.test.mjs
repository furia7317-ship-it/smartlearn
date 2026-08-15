import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningAnalytics } from "../lib/learning-analytics.ts";

const now = new Date("2026-07-31T20:00:00+08:00");

function persistedActivity({
  id,
  occurredAt,
  durationSeconds = 0,
  subject = "",
  knowledgePoints = [],
  resourceType = "reading",
  kind = "view",
}) {
  return {
    id,
    learnerId: "learner-1",
    resourceId: id,
    resourceTitle: id,
    resourceType,
    topic: subject,
    knowledgePoints,
    startedAt: occurredAt,
    updatedAt: occurredAt,
    activeSeconds: durationSeconds,
    interactions: {
      scrolls: kind === "view" ? 1 : 0,
      questions: kind === "question" ? 1 : 0,
      selections: 0,
      practiceSubmissions: resourceType === "quiz" ? 1 : 0,
    },
  };
}

const dataStructurePath = {
  id: "path-data-structures",
  title: "数据结构",
  requestSummary: "三天掌握数据结构基础",
  status: "active",
  controlStatus: "active",
  activationDate: "2026-07-29",
  dailyMinutes: 40,
  sourcePlanIds: ["plan-1"],
  completedTasks: 1,
  totalTasks: 3,
  progress: 33,
  sourceStatus: "completed",
  path: [
    {
      day: "D1",
      title: "线性结构",
      desc: "学习栈与队列",
      types: ["reading", "quiz"],
      state: "current",
      minutes: 90,
      steps: [
        { title: "栈与队列讲义", detail: "阅读", minutes: 40, resource_types: ["reading"] },
        { title: "线性结构练习", detail: "练习", minutes: 50, resource_types: ["quiz"] },
      ],
    },
  ],
};

const databasePath = {
  ...dataStructurePath,
  id: "path-database",
  title: "数据库",
  status: "scheduled",
  controlStatus: "scheduled",
  completedTasks: 0,
  totalTasks: 1,
  progress: 0,
  path: [{
    day: "D1",
    title: "SQL 基础",
    desc: "查询与索引",
    types: ["reading"],
    state: "todo",
    minutes: 90,
    steps: [{ title: "SQL 讲义", detail: "阅读", minutes: 90, resource_types: ["reading"] }],
  }],
};

function completeInput() {
  return {
    now,
    activities: [
      persistedActivity({
        id: "read-tree",
        occurredAt: "2026-07-31T14:00:00+08:00",
        kind: "view",
        durationSeconds: 3600,
        subject: "数据结构",
        knowledgePoints: ["二叉树"],
        resourceType: "reading",
      }),
      persistedActivity({
        id: "quiz-tree",
        occurredAt: "2026-07-31T15:00:00+08:00",
        kind: "practice",
        durationSeconds: 1800,
        subject: "数据结构",
        knowledgePoints: ["二叉树"],
        resourceType: "quiz",
      }),
      persistedActivity({
        id: "question-tree",
        occurredAt: "2026-07-31T15:20:00+08:00",
        kind: "question",
        subject: "数据结构",
        knowledgePoints: ["二叉树"],
        resourceType: "explainer",
      }),
      persistedActivity({
        id: "question-tree-2",
        occurredAt: "2026-07-30T15:20:00+08:00",
        kind: "question",
        subject: "数据结构",
        knowledgePoints: ["二叉树"],
        resourceType: "explainer",
      }),
      persistedActivity({
        id: "question-tree-3",
        occurredAt: "2026-07-29T15:20:00+08:00",
        kind: "question",
        subject: "数据结构",
        knowledgePoints: ["二叉树"],
        resourceType: "explainer",
      }),
      persistedActivity({
        id: "sql-short",
        occurredAt: "2026-07-31T09:00:00+08:00",
        kind: "view",
        durationSeconds: 600,
        subject: "数据库",
        knowledgePoints: ["SQL"],
        resourceType: "reading",
      }),
      persistedActivity({
        id: "old-review",
        occurredAt: "2026-07-20T18:00:00+08:00",
        kind: "review",
        durationSeconds: 600,
        subject: "数据结构",
        knowledgePoints: ["队列"],
        resourceType: "explainer",
      }),
    ],
    masteryEvidence: [
      {
        knowledgePoint: "二叉树",
        subject: "数据结构",
        score: 0.45,
        measuredAt: "2026-07-31T15:30:00+08:00",
        source: "practice",
      },
      {
        knowledgePoint: "SQL",
        subject: "数据库",
        score: 80,
        measuredAt: "2026-07-25T10:00:00+08:00",
        source: "diagnostic",
      },
      {
        knowledgePoint: "队列",
        subject: "数据结构",
        score: 70,
        measuredAt: "2026-07-20T18:00:00+08:00",
        source: "review",
      },
    ],
    practiceAttempts: [
      {
        id: "attempt-tree",
        resourceId: "tree-quiz",
        title: "二叉树练习",
        submittedAt: "2026-07-31T15:30:00+08:00",
        score: 40,
        correctCount: 4,
        total: 10,
        answers: {},
        wrongQuestions: [{ id: "q1", stem: "遍历", chosen: "B", answer: "A" }],
      },
    ],
    practiceTopics: {
      "tree-quiz": { subject: "数据结构", knowledgePoints: ["二叉树"] },
    },
    subjectPaths: [dataStructurePath, databasePath],
    conversations: [
      { id: "c1", occurredAt: "2026-07-31T15:22:00+08:00", kind: "question", subject: "数据结构", knowledgePoints: ["二叉树"], resolved: false },
      { id: "c2", occurredAt: "2026-07-31T15:24:00+08:00", kind: "question", subject: "数据结构", knowledgePoints: ["二叉树"], resolved: true },
      { id: "c3", occurredAt: "2026-07-30T15:24:00+08:00", kind: "question", subject: "数据结构", knowledgePoints: ["二叉树"], resolved: true },
    ],
    tasks: [
      { id: "task-1", occurredAt: "2026-07-31T16:00:00+08:00", subject: "数据结构", knowledgePoints: ["二叉树"], completed: true, passed: false },
    ],
    peerBenchmarks: [
      { subject: "数据结构", mastery: 60, studyShare: 50, sampleSize: 120, stage: "大二" },
      { subject: "不存在", mastery: 70, sampleSize: 120 },
    ],
  };
}

test("empty input reports insufficient evidence instead of synthesizing sample values", () => {
  const analytics = buildLearningAnalytics({ now });

  assert.deepEqual(analytics.evidence, {
    activityEvents: 0,
    activeMinutes: 0,
    masteryMeasurements: 0,
    practiceAttempts: 0,
    conversationRecords: 0,
    taskRecords: 0,
    subjectPaths: 0,
  });
  assert.equal(analytics.health.availability, "insufficient");
  assert.equal(analytics.health.score, null);
  assert.ok(analytics.health.factors.every((factor) => factor.score === null));
  assert.equal(analytics.subjectBalance.availability, "insufficient");
  assert.deepEqual(analytics.subjectBalance.items, []);
  assert.equal(analytics.dailySummary.narrative, null);
  assert.equal(analytics.learningStyle.dominant, null);
  assert.deepEqual(analytics.forgetting.items, []);
  assert.deepEqual(analytics.bottlenecks.items, []);
  assert.equal(analytics.efficiency.goldenHour, null);
  assert.deepEqual(analytics.teacherObservations.items, []);
  assert.equal(analytics.peerComparison.availability, "insufficient");
});

test("the ten dashboard insights are derived from persisted learning evidence", () => {
  const analytics = buildLearningAnalytics(completeInput());

  assert.equal(analytics.evidence.activityEvents, 7);
  assert.equal(analytics.evidence.activeMinutes, 110);
  assert.equal(analytics.health.availability, "ready");
  assert.equal(analytics.health.confidence, 1);
  assert.equal(analytics.health.factors.find((item) => item.id === "practice")?.score, 40);

  assert.equal(analytics.subjectBalance.availability, "ready");
  const dataStructures = analytics.subjectBalance.items.find((item) => item.subject === "数据结构");
  const database = analytics.subjectBalance.items.find((item) => item.subject === "数据库");
  assert.equal(dataStructures?.investmentShare, 90.9);
  assert.equal(dataStructures?.mastery, 57.5);
  assert.equal(dataStructures?.state, "high_effort_low_mastery");
  assert.equal(database?.state, "underinvested");

  assert.equal(analytics.dailySummary.availability, "ready");
  assert.equal(analytics.dailySummary.activeMinutes, 100);
  assert.equal(analytics.dailySummary.questions, 3);
  assert.equal(analytics.dailySummary.completedTasks, 1);
  assert.equal(analytics.dailySummary.practiceAttempts, 1);
  assert.match(analytics.dailySummary.narrative ?? "", /二叉树/);

  assert.equal(analytics.learningStyle.availability, "ready");
  assert.equal(analytics.learningStyle.basis, "active_time");
  assert.equal(analytics.learningStyle.dominant, "text");
  assert.equal(analytics.learningStyle.items.find((item) => item.channel === "text")?.share, 72.7);

  assert.equal(analytics.forgetting.availability, "ready");
  const queueRisk = analytics.forgetting.items.find((item) => item.knowledgePoint === "队列");
  assert.equal(queueRisk?.daysSinceStudy, 11);
  assert.equal(queueRisk?.risk, 57);

  assert.equal(analytics.pathProgress.availability, "ready");
  assert.equal(analytics.pathProgress.currentPathId, "path-data-structures");
  assert.equal(analytics.pathProgress.items.find((item) => item.id === "path-data-structures")?.remainingMinutes, 60);

  assert.equal(analytics.bottlenecks.availability, "ready");
  const treeBottleneck = analytics.bottlenecks.items.find((item) => item.topic === "二叉树");
  assert.equal(treeBottleneck?.mastery, 45);
  assert.equal(treeBottleneck?.practiceScore, 40);
  assert.equal(treeBottleneck?.questionCount, 6);
  assert.ok(treeBottleneck?.reasons.includes("投入较高但尚未形成掌握"));

  assert.equal(analytics.efficiency.availability, "ready");
  assert.equal(analytics.efficiency.basis, "outcomes");
  assert.equal(analytics.efficiency.goldenHour, 15);

  assert.equal(analytics.teacherObservations.availability, "ready");
  assert.ok(analytics.teacherObservations.items.some((item) => item.id === "bottleneck-二叉树"));

  assert.equal(analytics.peerComparison.availability, "ready");
  assert.equal(analytics.peerComparison.items.length, 1);
  assert.equal(analytics.peerComparison.items[0].subject, "数据结构");
  assert.equal(analytics.peerComparison.items[0].delta, -2.5);
  assert.equal(analytics.peerComparison.items[0].sampleSize, 120);
});

test("events outside the requested window cannot affect the dashboard", () => {
  const input = completeInput();
  input.rangeDays = 2;
  input.activities.push(persistedActivity({
    id: "stale",
    occurredAt: "2026-05-01T09:00:00+08:00",
    kind: "video",
    durationSeconds: 99_999,
    subject: "操作系统",
    knowledgePoints: ["进程"],
    resourceType: "video",
  }));
  input.masteryEvidence.push({
    knowledgePoint: "进程",
    subject: "操作系统",
    score: 100,
    measuredAt: "2026-05-01T10:00:00+08:00",
    source: "diagnostic",
  });

  const analytics = buildLearningAnalytics(input);

  assert.equal(analytics.evidence.activityEvents, 5);
  assert.equal(analytics.evidence.masteryMeasurements, 1);
  assert.equal(analytics.subjectBalance.items.some((item) => item.subject === "操作系统"), false);
  assert.equal(analytics.efficiency.hours.some((item) => item.hour === 9 && item.activeMinutes > 100), false);
});

test("learning style falls back to event counts only when active duration was not recorded", () => {
  const analytics = buildLearningAnalytics({
    now,
    activities: [
      persistedActivity({ id: "q1", occurredAt: "2026-07-31T10:00:00+08:00", kind: "question", resourceType: "explainer" }),
      persistedActivity({ id: "q2", occurredAt: "2026-07-31T10:05:00+08:00", kind: "question", resourceType: "explainer" }),
      persistedActivity({ id: "v1", occurredAt: "2026-07-31T11:00:00+08:00", kind: "video", resourceType: "video" }),
    ],
  });

  assert.equal(analytics.learningStyle.basis, "event_count");
  assert.equal(analytics.learningStyle.dominant, "dialogue");
  assert.equal(analytics.learningStyle.items.find((item) => item.channel === "dialogue")?.share, 66.7);
});

test("peer comparison stays hidden without an actual matching cohort", () => {
  const input = completeInput();
  input.peerBenchmarks = [
    { subject: "数据结构", mastery: 55, sampleSize: 0, stage: "大二" },
    { subject: "计算机网络", mastery: 70, sampleSize: 80, stage: "大二" },
  ];

  const analytics = buildLearningAnalytics(input);

  assert.equal(analytics.peerComparison.availability, "insufficient");
  assert.deepEqual(analytics.peerComparison.items, []);
});
