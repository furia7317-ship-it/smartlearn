import assert from "node:assert/strict";
import test from "node:test";
import { guideCardPosition, DESKTOP_GUIDE_STEPS, DEMO_ACCOUNT } from "../lib/welcome.ts";

test("tour cards remain inside small and desktop viewports, including a missing target", () => {
  for (const [width, height] of [[320, 640], [900, 600], [1934, 1318]]) {
    for (const rect of [null, { top: 40, bottom: 90, left: 12, right: 160 }, { top: height - 100, bottom: height - 10, left: width - 80, right: width - 10 }]) {
      const position = guideCardPosition(rect, width, height, 340);
      assert.ok(position.left >= 16);
      assert.ok(position.top >= 16);
      assert.ok(position.left + position.width <= width - 16);
      assert.ok(position.top + 340 <= height - 16);
    }
  }
});

test("tour keeps left-rail hints to the right and teacher hints to the left", () => {
  assert.ok(guideCardPosition({ top: 100, bottom: 150, left: 0, right: 180 }, 1934, 1318, 330).left > 180);
  assert.ok(guideCardPosition({ top: 1100, bottom: 1180, left: 1800, right: 1880 }, 1934, 1318, 330).left + 390 < 1800);
  assert.equal(new Set(DESKTOP_GUIDE_STEPS.map(step => step.target)).size, DESKTOP_GUIDE_STEPS.length);
  assert.equal(DEMO_ACCOUNT.login, "furia");
  assert.ok(DEMO_ACCOUNT.password.length >= 8);
});
