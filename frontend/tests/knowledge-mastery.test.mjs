import test from "node:test";
import assert from "node:assert/strict";
import { buildKnowledgeMastery, knowledgeAdvice } from "../lib/knowledge-mastery.ts";

const now = Date.parse("2026-09-07T12:00:00Z");
const paths = [{ title: "数据结构", status: "active", path: [{ title: "线性结构", state: "current", desc: "掌握边界处理", knowledge_points: ["数组", "链表", "栈"] }] }];
const assessment = { id: "a", subject: "数据结构", created_at: "2026-07-01T00:00:00Z", analysis: { knowledge_seed: { 数组: .76, 链表: .6, 知识基础: .9 } } };
const paper = { id: "p", topic: "数据结构", status: "graded", created_at: "2026-09-01T00:00:00Z", questions: [], mastery: { 链表: { score: .85, question_count: 2 } }, results: [{ knowledge_point: "链表", score: 8.5, max_score: 10, feedback: "注意空链表" }] };

test("published mastery stays fixed when a new raw grade arrives", () => {
  const published = [{ course: "数据结构", label: "链表", score: 72, evidenceCount: 2, updatedAt: paper.created_at, provisional: false }];
  const before = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [paper], published, now });
  const after = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [{ ...paper, mastery: { 链表: 1 } }], published, now });
  assert.equal(before.overall, 72);
  assert.equal(after.overall, 72);
  assert.equal(after.nodes.find(node => node.label === "数组").score, null);
  const updated = buildKnowledgeMastery({ paths, assessments: [], papers: [], published: [{ ...published[0], score: 84 }], now });
  assert.equal(updated.overall, 84);
  assert.match(knowledgeAdvice(updated.nodes.find(node => node.label === "链表")).review, /加权整理/);
});

test("self-reported mastery is labeled and excluded from course averages", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [paper], published: [{ course: "数据结构", label: "链表", score: 100, evidenceCount: 1, updatedAt: paper.created_at, provisional: true }], now });
  assert.equal(graph.overall, null);
  assert.match(knowledgeAdvice(graph.nodes.find(node => node.label === "链表")).judgement, /自评参考/);
});

test("knowledge nodes never substitute learning-profile axes or invent scores", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [], now });
  assert.deepEqual(graph.nodes.map((node) => node.label), ["数组", "链表", "栈"]);
  assert.equal(graph.nodes[2].score, null);
  assert.equal(graph.overall, 68);
  assert.equal(graph.assessedCount, 2);
  const empty = buildKnowledgeMastery({ paths: [], papers: [], assessments: [{ ...assessment, analysis: {} }], now });
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.overall, null);
});

test("latest per-topic results update only the corresponding topic, including teacher feedback", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [paper], now });
  assert.equal(graph.nodes.find((node) => node.label === "链表").score, 85);
  assert.equal(graph.nodes.find((node) => node.label === "链表").feedback, "注意空链表");
  assert.equal(graph.nodes.find((node) => node.label === "数组").score, 76);
  assert.equal(graph.overall, 81);
  const current = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [paper], rangeDays: 30, now });
  assert.equal(current.nodes.find((node) => node.label === "数组").score, null);
  assert.equal(current.overall, 85);
});

test("ungraded paper totals never turn into knowledge scores; graded questions use their own maximum", () => {
  const ungraded = buildKnowledgeMastery({ paths, assessments: [], papers: [{ ...paper, status: "submitted", overall_score: 100 }], now });
  assert.equal(ungraded.overall, null);
  const graded = buildKnowledgeMastery({ paths, assessments: [], papers: [{ ...paper, mastery: {}, results: [{ knowledge_point: "栈", score: 1, max_score: 5 }, { knowledge_point: "栈", score: 5, max_score: 5 }] }], now });
  assert.equal(graded.nodes.find((node) => node.label === "栈").score, 60);
});

test("same-name topics in different courses keep separate scores", () => {
  const graph = buildKnowledgeMastery({ paths: [...paths, { ...paths[0], title: "Python" }], assessments: [], papers: [{ ...paper, topic: "Python" }], now, subject: "数据结构" });
  assert.equal(graph.nodes.find((node) => node.label === "链表").score, null);
  assert.equal(graph.courses.length, 2);
});

test("advice changes with the selected knowledge point and measured level", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [paper], now });
  const linked = knowledgeAdvice(graph.nodes.find((node) => node.label === "链表"));
  const stack = knowledgeAdvice(graph.nodes.find((node) => node.label === "栈"));
  assert.match(linked.judgement, /已基本掌握/);
  assert.match(linked.steps[0], /指针/);
  assert.match(stack.judgement, /尚无测评/);
  assert.match(stack.steps[0], /入栈出栈/);
});

test("course prefixes do not become knowledge content and the default course has available evidence", () => {
  const graph = buildKnowledgeMastery({ paths: [{ ...paths[0], title: "未测课程", path: [{ knowledge_points: ["未测课程：链表"], title: "链表", desc: "" }] }], assessments: [assessment], papers: [], now });
  assert.equal(graph.course.title, "数据结构");
  const pending = buildKnowledgeMastery({ paths: [{ ...paths[0], path: [{ title: "链表", desc: "", knowledge_points: ["数据结构：链表"] }] }], assessments: [], papers: [], now });
  assert.equal(pending.nodes[0].label, "链表");
  assert.match(knowledgeAdvice(pending.nodes[0]).steps[0], /指针/);
});

test("learning review synthesizes progress and stage instead of a single correct-answer verdict", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [{ ...paper, results: [{ knowledge_point: "链表", score: 8.5, max_score: 10, feedback: "回答正确" }] }], now });
  const advice = knowledgeAdvice(graph.nodes.find((node) => node.label === "链表"), graph.course.currentStage);
  assert.match(advice.review, /60% 提高到 85%/);
  assert.match(advice.review, /线性结构/);
  assert.match(advice.review, /掌握边界处理/);
  assert.match(advice.review, /独立应用/);
  assert.doesNotMatch(advice.review, /回答正确/);
});

test("learning review acknowledges missing comparisons and avoids inventing regression", () => {
  const graph = buildKnowledgeMastery({ paths, assessments: [assessment], papers: [{ ...paper, mastery: { 链表: { score: .4, question_count: 2 } } }], now });
  const decline = knowledgeAdvice(graph.nodes.find((node) => node.label === "链表"));
  assert.match(decline.review, /60% 降至 40%/);
  assert.match(decline.review, /不能仅凭分数认定学习退步/);
  assert.match(knowledgeAdvice(graph.nodes.find((node) => node.label === "数组")).review, /缺少前后两次/);
  assert.match(knowledgeAdvice(graph.nodes.find((node) => node.label === "栈")).review, /先补充证据/);
});
