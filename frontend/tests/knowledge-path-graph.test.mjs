import assert from "node:assert/strict";
import test from "node:test";

import { buildKnowledgePathGraph } from "../lib/knowledge-path-graph.ts";

const step = (day, title, prerequisites = []) => ({
  day,
  title,
  desc: `掌握${title}`,
  objective: `能够应用${title}`,
  knowledge_points: [title],
  prerequisites,
  types: ["explainer"],
  state: day === "D1" ? "current" : "todo",
});

test("explicit prerequisite labels create a real split and merge graph", () => {
  const graph = buildKnowledgePathGraph([
    step("D1", "数据结构基础"),
    step("D2", "线性表", ["数据结构基础"]),
    step("D3", "栈与队列", ["线性表"]),
    step("D4", "树与二叉树", ["线性表"]),
    step("D5", "图与搜索", ["栈与队列", "树与二叉树"]),
  ]);

  assert.equal(graph.usesExplicitPrerequisites, true);
  const tree = graph.nodes.find((node) => node.step.title === "树与二叉树");
  const stack = graph.nodes.find((node) => node.step.title === "栈与队列");
  const graphSearch = graph.nodes.find((node) => node.step.title === "图与搜索");
  assert.equal(tree.column, stack.column, "sibling prerequisites share one graph column");
  assert.notEqual(tree.lane, stack.lane, "siblings render on distinct branches");
  assert.ok(graph.edges.some((edge) => edge.from === tree.id && edge.to === graphSearch.id));
  assert.ok(graph.edges.some((edge) => edge.from === stack.id && edge.to === graphSearch.id));
});

test("legacy paths without prerequisites receive a stable branching fallback", () => {
  const graph = buildKnowledgePathGraph([
    step("D1", "基础"),
    step("D2", "线性表"),
    step("D3", "栈"),
    step("D4", "队列"),
    step("D5", "树"),
    step("D6", "图"),
    step("D7", "搜索"),
  ].map((item) => ({ ...item, prerequisites: [] })));

  assert.equal(graph.usesExplicitPrerequisites, false);
  assert.ok(new Set(graph.nodes.map((node) => node.lane)).size > 1);
  assert.ok(graph.edges.some((edge) => edge.inferred));
});
