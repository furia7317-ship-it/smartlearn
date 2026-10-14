import assert from "node:assert/strict";
import test from "node:test";
import { fitTeacherWindow, resizeTeacherWindow } from "../lib/teacher-window-geometry.ts";

const viewport = { width: 1280, height: 900 };
const rect = { left: 870, top: 320, width: 390, height: 560 };

test("resizing a bottom-right window from the top-left keeps its opposite corner fixed", () => {
  const next = resizeTeacherWindow(rect, "nw", -230, -150, viewport);
  assert.deepEqual(next, { left: 640, top: 170, width: 620, height: 710 });
  assert.equal(next.left + next.width, rect.left + rect.width);
  assert.equal(next.top + next.height, rect.top + rect.height);
});
test("all eight handles respect the viewport and usable minimum dimensions", () => {
  for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) {
    for (const delta of [-5000, 5000]) {
      const next = resizeTeacherWindow(rect, edge, delta, delta, viewport);
      assert.ok(next.left >= 12 && next.top >= 12);
      assert.ok(next.width >= 360 && next.height >= 420);
      assert.ok(next.left + next.width <= viewport.width - 12);
      assert.ok(next.top + next.height <= viewport.height - 12);
    }
  }
});
test("small screens fit without overflowing, and viewport shrink clamps the saved window", () => {
  const next = fitTeacherWindow(rect, { width: 375, height: 360 });
  assert.deepEqual(next, { left: 12, top: 12, width: 351, height: 336 });
  assert.deepEqual(resizeTeacherWindow(next, "se", 800, 800, { width: 375, height: 360 }), next);
});
