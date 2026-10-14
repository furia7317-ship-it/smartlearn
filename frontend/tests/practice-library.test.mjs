import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { buildPracticePapers, selectPracticePapers, buildPracticeMistakes, practiceStatistics, practiceTimestamp } from "../lib/practice-library.ts";

const paper = (id, extra = {}) => ({ id, exam_id: `exam-${id}`, title: "数据结构练习", topic: "线性表", category: "练习", tags: ["算法"], status: "created", overall_score: null, question_count: 5, created_at: "2026-09-14T02:00:00Z", ...extra });
const attempt = (resourceId, extra = {}) => ({ id: `attempt-${resourceId}`, resourceId, title: "练习", submittedAt: "2026-09-14T03:00:00Z", score: 0, correctCount: 0, total: 5, answers: {}, wrongQuestions: [], ...extra });
const select = (papers, extra = {}) => selectPracticePapers(papers, { filter: "mine", query: "", sort: "latest", starred: [], recent: {}, ...extra });

test("session quiz merges only by identity; same titles stay independent and a zero score is retained", () => {
  const resource = { id: "resource-a", exam_id: "exam-a", type: "quiz", title: "数据结构练习", subtitle: "线性表", status: "ready", meta: [], version: 1, sources: 0, data: { questions: [{ stem: "题目" }] } };
  const rows = buildPracticePapers([paper("a"), paper("b")], [resource, { ...resource, id: "new", exam_id: "" }], [attempt("resource-a")]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(row => row.id === "a").sessionResource.id, "resource-a");
  assert.equal(rows.find(row => row.id === "a").overall_score, 0);
  assert.equal(rows.find(row => row.id === "a").status, "graded");
  assert.equal(rows.find(row => row.id === "b").status, "created");
  assert.equal(rows.find(row => row.id === "session_new").created_at, "");
});

test("search, persisted favorites and recent records use real paper fields", () => {
  const rows = [paper("a", { starred: true }), paper("b", { title: "Python 入门", tags: ["程序设计"] }), paper("c")];
  assert.deepEqual(select(rows, { query: "python" }).map(row => row.id), ["b"]);
  assert.deepEqual(select(rows, { query: " 程序设计 " }).map(row => row.id), ["b"]);
  assert.deepEqual(select(rows, { filter: "starred", starred: ["c"] }).map(row => row.id), ["a", "c"]);
  assert.deepEqual(select(rows, { filter: "recent", recent: { b: "2026-09-14T04:00:00Z" } }).map(row => row.id), ["b"]);
  assert.equal(select(rows, { query: "不存在的题目" }).length, 0);
});

test("recommendations prioritize unfinished and weaker work; score sort keeps zero and unknown apart", () => {
  const rows = [paper("good", { status: "graded", overall_score: 90 }), paper("zero", { status: "graded", overall_score: 0 }), paper("pending"), paper("weak", { status: "graded", overall_score: 72 })];
  assert.deepEqual(select(rows, { filter: "recommended", sort: "recommended" }).map(row => row.id), ["pending", "zero", "weak", "good"]);
  assert.deepEqual(select(rows, { sort: "score-low" }).map(row => row.id), ["zero", "weak", "good", "pending"]);
  assert.deepEqual(select(rows, { sort: "score-high" }).map(row => row.id), ["good", "weak", "zero", "pending"]);
});

test("latest retry replaces archived mistakes, including clearing a now-correct paper", () => {
  const detail = { ...paper("a", { status: "graded" }), questions: [{ id: "q1", stem: "FIFO？", answer: "A" }], results: [{ question_id: "q1", correct: false, student_answer: "B", answer: "A", feedback: "先入先出" }] };
  assert.equal(buildPracticeMistakes([detail], [], [detail]).length, 1);
  assert.equal(buildPracticeMistakes([detail], [attempt("a", { score: 100, correctCount: 5 })], [detail]).length, 0);
  const wrong = { id: "q2", stem: "栈？", chosen: "A", answer: "B" };
  const rows = buildPracticeMistakes([detail], [attempt("a", { wrongQuestions: [wrong] }), attempt("a", { submittedAt: "2026-09-13T03:00:00Z", wrongQuestions: [wrong, { ...wrong, id: "q3" }] })], [detail]);
  assert.deepEqual(rows.map(row => row.id), ["a:q2"]);
});

test("accuracy is weighted by actual questions and local retries do not double count archive records", () => {
  const first = { ...paper("a", { status: "graded", overall_score: 100 }), results: [{ correct: true }] };
  const second = { ...paper("b", { status: "graded", overall_score: 0 }), results: Array.from({ length: 9 }, () => ({ correct: false })) };
  const now = new Date("2026-09-14T12:00:00Z");
  assert.deepEqual(practiceStatistics([first, second], [], [first, second], now), { weekly: 2, accuracy: 10, days: 1 });
  assert.deepEqual(practiceStatistics([first], [attempt("a", { total: 4, correctCount: 3 })], [first], now), { weekly: 1, accuracy: 75, days: 1 });
  assert.equal(practiceStatistics([], [], [], now).accuracy, null);
});

test("backend unzoned dates normalize to UTC and invalid dates are ignored", () => {
  assert.equal(practiceTimestamp("2026-09-14T02:00:00"), Date.parse("2026-09-14T02:00:00Z"));
  assert.equal(practiceTimestamp("bad-date"), 0);
});

test("standalone code challenge and diagnostic routes are retired", async () => {
  for (const path of ["../app/desktop/code-lab/page.tsx", "../app/code-lab/page.tsx", "../app/desktop/diagnostic/page.tsx", "../app/diagnostic/page.tsx"]) {
    await assert.rejects(access(new URL(path, import.meta.url)), { code: "ENOENT" });
  }
});
