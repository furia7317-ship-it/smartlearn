import test from "node:test";
import assert from "node:assert/strict";
import { moveGraphNode } from "../lib/graph-node-drag.ts";

test("drag coordinates stay aligned with edges on resized and zoomed graphs", () => {
  const normal = { x: 30, y: 40, width: 800, height: 500, radiusX: 34, radiusY: 34 };
  const zoomed = { ...normal, width: 960, height: 600, radiusX: 40.8, radiusY: 40.8 };
  assert.deepEqual(moveGraphNode(normal, 80, -50), { x: 40, y: 30 });
  assert.deepEqual(moveGraphNode(zoomed, 96, -60), { x: 40, y: 30 });
  assert.deepEqual(moveGraphNode({ ...normal, width: 400, height: 250 }, 40, -25), { x: 40, y: 30 });
});

test("dragging keeps the whole bubble inside the graph at every boundary", () => {
  const start = { x: 50, y: 50, width: 500, height: 400, radiusX: 50, radiusY: 40 };
  assert.deepEqual(moveGraphNode(start, -1000, 1000), { x: 10, y: 90 });
  assert.deepEqual(moveGraphNode(start, 1000, -1000), { x: 90, y: 10 });
  assert.deepEqual(moveGraphNode({ ...start, width: 0 }, 100, 100), { x: 50, y: 50 });
});
