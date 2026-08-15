import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningSchedule,
  pendingTasksForDate,
} from "../lib/learning-schedule.ts";
import { pathScheduleCurrentIndex } from "../lib/path-schedule-clock.ts";

const path = [
  {
    day: "D1",
    title: "基础",
    desc: "学习基础",
    types: ["explainer", "quiz"],
    state: "current",
    minutes: 60,
    steps: [
      { title: "学习：基础讲义", detail: "阅读", minutes: 30, resource_types: ["explainer"], kind: "resource" },
      { title: "练习：基础测验", detail: "交卷", minutes: 30, resource_types: ["quiz"], kind: "practice" },
    ],
  },
  {
    day: "D2",
    title: "进阶",
    desc: "继续学习",
    types: ["code"],
    state: "todo",
    minutes: 45,
    steps: [
      { title: "学习：代码", detail: "实现", minutes: 45, resource_types: ["code"], kind: "resource" },
    ],
  },
];

test("calendar schedule anchors the current path day to today and colors from real completion", () => {
  const anchor = new Date(2026, 6, 14, 12);
  const schedule = buildLearningSchedule(path, ["0:task:0", "0:task:1"], anchor);

  assert.equal(schedule[0].date, "2026-07-14");
  assert.equal(schedule[0].status, "completed");
  assert.equal(schedule[1].date, "2026-07-15");
  assert.equal(schedule[1].status, "pending");
  assert.deepEqual(pendingTasksForDate(schedule, "2026-07-15").map((task) => task.title), ["代码"]);
});

test("a study task remains pending until a passing quiz writes its task completion key", () => {
  const anchor = new Date(2026, 6, 14, 12);
  const schedule = buildLearningSchedule(path, ["0:task:1"], anchor);

  assert.equal(schedule[0].status, "pending");
  assert.deepEqual(pendingTasksForDate(schedule, "2026-07-14").map((task) => task.action), ["学习"]);
});

test("the active path day advances with real local calendar days", () => {
  assert.equal(
    pathScheduleCurrentIndex(path, "2026-07-14", new Date(2026, 6, 14, 12)),
    0,
  );
  assert.equal(
    pathScheduleCurrentIndex(path, "2026-07-14", new Date(2026, 6, 15, 12)),
    1,
  );
  assert.equal(
    pathScheduleCurrentIndex(path, "2026-07-14", new Date(2026, 6, 20, 12)),
    1,
  );
});
