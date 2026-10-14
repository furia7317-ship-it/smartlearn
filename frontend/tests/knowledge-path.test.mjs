import assert from "node:assert/strict";
import test from "node:test";
import { buildAbilityTree, buildAbilityTodayQueue, abilityStudyHref } from "../lib/ability-path.ts";
import { buildChapterKnowledgeGraph, chapterKnowledge } from "../lib/knowledge-path.ts";

const step = (title, extra = {}) => ({ day: title, title, objective: title, desc: title, state: "todo", types: ["quiz"], minutes: 30,
  steps: [{ title: `验证${title}`, minutes: 30, completion_kind: "quiz_submission", completion_key: title, resource_types: ["quiz"] }], ...extra });
const build = (path) => buildAbilityTree([{ id: "course", title: "数据结构", path, dailyMinutes: 60 }]);

test("existing chapter prose expands into parallel concepts with a supported comparison", () => {
  const chapter = step("复杂度与线性表", { objective: "建立复杂度直觉并比较数组、链表" });
  const parsed = chapterKnowledge(chapter);
  assert.deepEqual(parsed.points.map((point) => point.title), ["复杂度", "线性表", "数组", "链表"]);
  assert.equal(parsed.relations.length, 1);
  assert.equal(parsed.relations[0].kind, "related");
  const graph = buildChapterKnowledgeGraph(build([chapter]));
  assert.equal(graph.edges.filter((edge) => edge.kind === "membership").length, 4);
  assert.equal(new Set(graph.nodes.map((node) => node.x)).size, 4);
  assert.equal(new Set(graph.nodes.map((node) => node.y)).size, 1);
  assert.ok(graph.edges.find((edge) => edge.kind === "related").path);
});

test("explicit knowledge prerequisites form branches and joins, not a forced sequence", () => {
  const nodes = ["基础", "顺序实现", "链式实现", "综合运用"].map((title, index) => ({ id: String(index), title }));
  const relations = [["0", "1"], ["0", "2"], ["1", "3"], ["2", "3"]].map(([from, to]) => ({ from, to, kind: "prerequisite" }));
  const graph = buildChapterKnowledgeGraph(build([step("栈", { knowledge_nodes: nodes, knowledge_relations: relations })]));
  const [a, b, c, d] = graph.nodes;
  assert.equal(b.y, c.y);
  assert.notEqual(b.x, c.x);
  assert.ok(a.y < b.y && b.y < d.y);
  assert.equal(graph.semanticEdges.length, 4);
  assert.equal(graph.edges.filter((edge) => edge.kind === "membership").length, 1);
});

test("chapter expansion preserves identities and keeps hidden related concepts navigable", () => {
  const base = build([step("数组", { knowledge_nodes: [{ id: "array", title: "数组存储" }] }), step("链表", { knowledge_nodes: [{ id: "list", title: "链表存储" }], knowledge_relations: [{ from: "array", to: "list", kind: "related", label: "存储方式对比" }] })]);
  const collapsed = buildChapterKnowledgeGraph(base);
  assert.equal(collapsed.nodes[1].visible, false);
  assert.equal(collapsed.semanticEdges.length, 1);
  assert.equal(collapsed.edges.some((edge) => edge.kind === "related"), false);
  const expanded = buildChapterKnowledgeGraph(base, base.nodes.map((node) => node.id));
  assert.deepEqual(expanded.nodes.map((node) => node.id), collapsed.nodes.map((node) => node.id));
  assert.ok(expanded.edges.some((edge) => edge.kind === "related"));
  assert.ok(expanded.height > collapsed.height);
});

test("shared tasks and study links remain chapter-scoped after concept expansion", () => {
  const base = build([step("栈与队列", { knowledge_points: ["栈", "队列", "LIFO", "FIFO"] })]);
  const before = buildAbilityTodayQueue(base, 60);
  const graph = buildChapterKnowledgeGraph(base);
  assert.equal(graph.nodes.length, 4);
  assert.deepEqual(buildAbilityTodayQueue(base, 60), before);
  assert.equal(base.mainCount, 1);
  assert.ok(graph.nodes.every((node) => node.tasks === base.nodes[0].tasks));
  const url = new URL(abilityStudyHref(graph.nodes[2]), "http://localhost");
  assert.equal(url.searchParams.get("node"), base.nodes[0].id);
  assert.equal(url.searchParams.get("knowledge"), graph.nodes[2].knowledgeId);
});

test("legacy concept lists stay authoritative and unsupported prerequisites are not fabricated", () => {
  const parsed = chapterKnowledge(step("归并与快速排序", { knowledge_points: ["归并排序", "快速排序"] }));
  assert.deepEqual(parsed.points.map((point) => point.title), ["归并排序", "快速排序"]);
  assert.deepEqual(parsed.relations, []);
  assert.deepEqual(chapterKnowledge(step("归并与快速排序")).points.map((point) => point.title), ["归并排序", "快速排序"]);
});

test("cyclic or broken knowledge edges cannot make layout disappear or change chapter validation", () => {
  const base = build([step("章节", { knowledge_nodes: [{ id: "a", title: "甲" }, { id: "b", title: "乙" }], knowledge_relations: [{ from: "a", to: "b", kind: "prerequisite" }, { from: "b", to: "a", kind: "prerequisite" }, { from: "missing", to: "a", kind: "prerequisite" }] })]);
  const graph = buildChapterKnowledgeGraph(base);
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(graph.semanticEdges.length, 2);
  assert.equal(base.passedCount, 0);
});
