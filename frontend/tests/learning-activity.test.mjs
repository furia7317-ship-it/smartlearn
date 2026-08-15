import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addLearningActivityDuration,
  addLearningActivityInteraction,
  createLearningActivityEvent,
  finishLearningActivityEvent,
  learningActivityInputFromResource,
  learningActivityFromPersistedUsage,
  learningActivityStorageKey,
  persistLearningActivityEvent,
  readLearningActivityEvents,
  summarizeLearningActivities,
} from "../lib/learning-activity.ts";

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const resource = {
  id: "resource:graph:1",
  type: "explainer",
  title: "图的基本概念",
  subtitle: "顶点、边与邻接关系",
  meta: ["数据结构", "图论"],
  status: "ready",
  version: 1,
  sources: 2,
  data: {
    subject_title: "数据结构",
    knowledge_points: ["图", "顶点", "图"],
    key_points: ["邻接关系"],
  },
};

test("persisted SQLite usage becomes dashboard learning evidence", () => {
  const activity = learningActivityFromPersistedUsage({
    date: "2026-07-31",
    route: "/desktop/code-lab",
    minutes: 54,
    questions: 6,
    correct: 5,
    feedback_count: 1,
  }, "user_001");

  assert.ok(activity);
  assert.equal(activity.resourceType, "code");
  assert.equal(activity.topic, "编程实践");
  assert.equal(activity.activeSeconds, 54 * 60);
  assert.equal(activity.interactions.questions, 6);
  assert.equal(activity.interactions.practiceSubmissions, 1);
  assert.equal(activity.interactions.selections, 1);
});

test("resource activity records real active time and interactions per learner", () => {
  const storage = memoryStorage();
  const descriptor = learningActivityInputFromResource(resource, "student_1");
  let activity = createLearningActivityEvent(
    descriptor,
    new Date("2026-07-31T01:00:00.000Z"),
    "session_1",
  );
  activity = addLearningActivityDuration(activity, 12.5, new Date("2026-07-31T01:00:12.500Z"));
  activity = addLearningActivityInteraction(activity, "scrolls", 2, new Date("2026-07-31T01:00:13.000Z"));
  activity = addLearningActivityInteraction(activity, "questions", 1, new Date("2026-07-31T01:00:14.000Z"));
  activity = finishLearningActivityEvent(activity, new Date("2026-07-31T01:00:15.000Z"));
  persistLearningActivityEvent(storage, activity);

  const [stored] = readLearningActivityEvents(storage, "student_1");
  assert.equal(stored.activeSeconds, 12.5);
  assert.equal(stored.interactions.scrolls, 2);
  assert.equal(stored.interactions.questions, 1);
  assert.equal(stored.topic, "数据结构");
  assert.deepEqual(stored.knowledgePoints, ["图", "顶点", "邻接关系"]);
  assert.equal(stored.endedAt, "2026-07-31T01:00:15.000Z");
  assert.equal(readLearningActivityEvents(storage, "student_2").length, 0);
  assert.notEqual(learningActivityStorageKey("student_1"), learningActivityStorageKey("student_2"));
});

test("activity persistence upserts heartbeats instead of double-counting sessions", () => {
  const storage = memoryStorage();
  const descriptor = learningActivityInputFromResource(resource, "student_1");
  const created = createLearningActivityEvent(descriptor, new Date("2026-07-31T02:00:00.000Z"), "same");
  persistLearningActivityEvent(storage, addLearningActivityDuration(created, 5));
  persistLearningActivityEvent(storage, addLearningActivityDuration(created, 10));

  const events = readLearningActivityEvents(storage, "student_1");
  assert.equal(events.length, 1);
  assert.equal(events[0].activeSeconds, 10);
});

test("activity summaries are computed only from persisted evidence", () => {
  const first = {
    ...createLearningActivityEvent(
      learningActivityInputFromResource(resource, "student_1"),
      new Date("2026-07-30T02:00:00.000Z"),
      "a",
    ),
    activeSeconds: 60,
    interactions: { scrolls: 3, questions: 1, selections: 0, practiceSubmissions: 0 },
  };
  const quiz = {
    ...createLearningActivityEvent({
      learnerId: "student_1",
      resourceId: "quiz:graph",
      resourceTitle: "图论测验",
      resourceType: "quiz",
      topic: "数据结构",
      knowledgePoints: ["图"],
    }, new Date("2026-07-31T02:00:00.000Z"), "b"),
    activeSeconds: 40,
    interactions: { scrolls: 0, questions: 0, selections: 0, practiceSubmissions: 1 },
  };

  const summary = summarizeLearningActivities([first, quiz]);
  assert.equal(summary.totalActiveSeconds, 100);
  assert.equal(summary.totalInteractions, 5);
  assert.deepEqual(summary.byResourceType, { explainer: 60, quiz: 40 });
  assert.equal(summary.byTopic["数据结构"], 100);
  assert.equal(summary.byKnowledgePoint["图"], 100);
  assert.deepEqual(summary.byDay, { "2026-07-30": 60, "2026-07-31": 40 });
});

test("malformed or unavailable local storage never breaks resource learning", () => {
  const malformed = memoryStorage([[learningActivityStorageKey("student_1"), "not-json"]]);
  assert.deepEqual(readLearningActivityEvents(malformed, "student_1"), []);

  const unavailable = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
  };
  const event = createLearningActivityEvent(
    learningActivityInputFromResource(resource, "student_1"),
    new Date("2026-07-31T02:00:00.000Z"),
    "safe",
  );
  assert.doesNotThrow(() => persistLearningActivityEvent(unavailable, event));
  assert.deepEqual(readLearningActivityEvents(unavailable, "student_1"), []);
});

test("resource viewer tracks only visible focused active time and meaningful interactions", async () => {
  const viewer = await readFile(new URL("../components/resource-viewer.tsx", import.meta.url), "utf8");
  assert.match(viewer, /document\.visibilityState !== "hidden"/);
  assert.match(viewer, /document\.hasFocus\(\)/);
  assert.match(viewer, /window\.setInterval\(flush, 5_000\)/);
  assert.match(viewer, /window\.addEventListener\("focus", resume\)/);
  assert.match(viewer, /window\.addEventListener\("blur", pause\)/);
  assert.match(viewer, /window\.addEventListener\("pagehide", finish\)/);
  assert.match(viewer, /noteLearningActivityInteraction\("scrolls"\)/);
  assert.match(viewer, /noteLearningActivityInteraction\("questions"\)/);
  assert.match(viewer, /noteLearningActivityInteraction\("practiceSubmissions"\)/);
});
