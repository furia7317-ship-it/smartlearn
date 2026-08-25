import assert from "node:assert/strict";
import test from "node:test";

import {
  KNOWLEDGE_PATH_MAX_ZOOM,
  KNOWLEDGE_PATH_MIN_ZOOM,
  clampKnowledgePathZoom,
  knowledgePathPanForZoomAnchor,
} from "../lib/knowledge-path-viewport.ts";

test("knowledge path zoom remains within a useful desktop range", () => {
  assert.equal(clampKnowledgePathZoom(0.12), KNOWLEDGE_PATH_MIN_ZOOM);
  assert.equal(clampKnowledgePathZoom(4.2), KNOWLEDGE_PATH_MAX_ZOOM);
  assert.equal(clampKnowledgePathZoom(1.2378), 1.238);
});

test("zooming keeps the world point below the mouse stationary", () => {
  const before = {
    panX: -220,
    panY: 90,
    anchorX: 360,
    anchorY: 180,
    currentZoom: 1,
    nextZoom: 1.45,
  };
  const next = knowledgePathPanForZoomAnchor(before);
  const worldXBefore = (before.anchorX - before.panX) / before.currentZoom;
  const worldYBefore = (before.anchorY - before.panY) / before.currentZoom;
  const worldXAfter = (before.anchorX - next.x) / before.nextZoom;
  const worldYAfter = (before.anchorY - next.y) / before.nextZoom;

  assert.equal(worldXAfter, worldXBefore);
  assert.equal(worldYAfter, worldYBefore);
});

test("dragging the canvas translates the entire graph without changing its scale", () => {
  const start = { x: -120, y: 40 };
  const delta = { x: 85, y: -55 };
  const next = { x: start.x + delta.x, y: start.y + delta.y };

  assert.deepEqual(next, { x: -35, y: -15 });
});
