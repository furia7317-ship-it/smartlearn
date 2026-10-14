import test from "node:test";
import assert from "node:assert/strict";
import { graphLinks, layoutFocusGraph, focusNeighborhood } from "../lib/focus-layout.ts";

const node = (id, module_id, all_of = [], any_of_groups = []) => ({ id, module_id, title: id, prerequisites: { all_of, any_of_groups }, kind: "core", objective: id, knowledge_point_ids: [id], estimated_minutes: 30, icon: "book", source_ids: [] });
const graph = { title: "Example", goal: "Goal", sources: [], modules: [{ id: "chapter1", title: "Chapter 1" }, { id: "chapter2", title: "Chapter 2" }], nodes: [node("a", "chapter1"), node("b", "chapter1"), node("c", "chapter1", ["a"]), node("d", "chapter2", ["c"], [["a", "b"]]), node("e", "chapter2")], relations: [{ source: "b", target: "c", kind: "recommended", reason: "advice" }] };

test("renders only explicit prerequisites and keeps suggestions distinct", () => {
  const edges = graphLinks(graph);
  assert.equal(edges.length, 5);
  assert.equal(edges.filter(e => e.kind === "alternative").length, 2);
  assert.equal(edges.find(e => e.source === "b" && e.target === "c").kind, "recommended");
  assert.equal(edges.some(e => e.target === "e"), false);
  assert.deepEqual([...focusNeighborhood(graph, "d")].sort(), ["a", "b", "c", "d"]);
});

test("a milestone with dependents stays above them, including wide chapter branches", async () => {
  const roots = Array.from({ length: 7 }, (_, i) => node(`root${i}`, "chapter1"));
  const milestone = { ...node("milestone", "chapter2", roots.map(n => n.id)), kind: "milestone" };
  const child = { ...node("validation", "chapter2", ["milestone"]), kind: "milestone" };
  const input = { ...graph, relations: [], nodes: [...roots, milestone, child] };
  const layout = await layoutFocusGraph("milestone-test", 1, input);
  const positions = new Map(layout.placements.map(n => [n.id, n]));
  assert.ok(positions.get("milestone").y < positions.get("validation").y);
  assert.equal(layout.links.filter(e => e.kind === "required").length, 8);
  assert.equal(layout.links.filter(e => e.kind === "required" && e.target.startsWith("root")).length, 0);
  assert.equal(new Set(roots.map(n => positions.get(n.id).y)).size, 4);
});

test("ELK positions every knowledge point, caches a version and does not mutate the curriculum", async () => {
  const before = JSON.stringify(graph);
  const first = await layoutFocusGraph("layout-test", 1, graph);
  assert.equal(first.placements.filter(n => n.kind === "knowledge").length, 5);
  assert.ok(first.placements.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const second = await layoutFocusGraph("layout-test", 1, structuredClone(graph));
  assert.strictEqual(second, first);
  assert.equal(JSON.stringify(graph), before);
  assert.equal(first.links.filter(e => e.kind !== "membership").length, 5);
  const positions = first.placements.filter(n => n.kind === "knowledge");
  for (const a of positions) for (const b of positions) if (a.id !== b.id) {
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} overlaps ${b.id}`);
  }
});
