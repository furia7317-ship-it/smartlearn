import test from "node:test";
import assert from "node:assert/strict";
import { createMasteryForceLayout } from "../lib/mastery-force-layout.ts";

const nodes = [
  { id: "root", x: 50, y: 50, root: true },
  { id: "a", x: 20, y: 25 },
  { id: "b", x: 80, y: 25 },
  { id: "c", x: 20, y: 75 },
];
const edges = [
  { source: "root", target: "a", strength: "strong" },
  { source: "root", target: "b", strength: "medium" },
  { source: "a", target: "c", strength: "weak" },
];

test("dragging one bubble moves both immediate and indirect neighbours", () => {
  const layout = createMasteryForceLayout(nodes, edges, 800, 500, false, () => {});
  try {
    layout.pin("a", { x: 40, y: 60 });
    layout.stop();
    layout.simulation.tick(45);
    const result = layout.positions();
    assert.deepEqual(result.a, { x: 40, y: 60 });
    for (const id of ["root", "b", "c"]) {
      const original = nodes.find((node) => node.id === id);
      assert.ok(Math.hypot(result[id].x - original.x, result[id].y - original.y) > 2, `${id} should follow the force network`);
    }
    layout.release("a");
    layout.stop();
    layout.simulation.tick(180);
    assert.ok(layout.simulation.alpha() < .001, "motion should settle after release");
    assert.ok(layout.simulation.nodes().every((node) => node.fx == null && node.fy == null));
  } finally { layout.stop(); }
});

test("force layout keeps finite bounded positions and leaves source graph unchanged", () => {
  const before = JSON.stringify({ nodes, edges });
  const layout = createMasteryForceLayout(nodes, edges, 420, 300, true, () => {});
  try {
    layout.pin("root", { x: 0, y: 100 });
    layout.stop();
    layout.simulation.tick(100);
    for (const node of Object.values(layout.positions())) {
      assert.ok(Number.isFinite(node.x) && node.x > 0 && node.x < 100);
      assert.ok(Number.isFinite(node.y) && node.y > 0 && node.y < 100);
    }
    assert.equal(JSON.stringify({ nodes, edges }), before);
  } finally { layout.stop(); }
});
