import assert from "node:assert/strict";
import test from "node:test";

import * as webMotion from "../lib/web-motion.ts";

const { getSectionIntent, normalizeSectionIndex } = webMotion;

test("wheel intent advances only after the threshold", () => {
  assert.equal(
    getSectionIntent({ delta: 38, threshold: 64, current: 0, total: 3 }),
    0
  );
  assert.equal(
    getSectionIntent({ delta: 80, threshold: 64, current: 0, total: 3 }),
    1
  );
  assert.equal(
    getSectionIntent({ delta: -80, threshold: 64, current: 1, total: 3 }),
    0
  );
});

test("section indices stay within range", () => {
  assert.equal(normalizeSectionIndex(-1, 3), 0);
  assert.equal(normalizeSectionIndex(9, 3), 2);
  assert.equal(normalizeSectionIndex(0, 0), 0);
});

test("wheel gesture triggers one section until the gesture resets", () => {
  assert.equal(typeof webMotion.advanceWheelGesture, "function");
  const first = webMotion.advanceWheelGesture({ sum: 0, triggered: false }, 18, 48);
  assert.equal(first.direction, 0);
  assert.deepEqual(first.state, { sum: 18, triggered: false });

  const trigger = webMotion.advanceWheelGesture(first.state, 34, 48);
  assert.equal(trigger.direction, 1);
  assert.deepEqual(trigger.state, { sum: 0, triggered: true });

  const repeated = webMotion.advanceWheelGesture(trigger.state, 120, 48);
  assert.equal(repeated.direction, 0);
  assert.deepEqual(repeated.state, trigger.state);
});

test("section transition easing starts and lands exactly", () => {
  assert.equal(typeof webMotion.easeSectionTransition, "function");
  assert.equal(webMotion.easeSectionTransition(-1), 0);
  assert.equal(webMotion.easeSectionTransition(0), 0);
  assert.equal(webMotion.easeSectionTransition(1), 1);
  assert.equal(webMotion.easeSectionTransition(2), 1);
  assert.ok(webMotion.easeSectionTransition(0.25) > 0.25);
  assert.ok(webMotion.easeSectionTransition(0.75) > 0.75);
  assert.ok(
    webMotion.easeSectionTransition(0.25) < webMotion.easeSectionTransition(0.75)
  );
});

test("section transition easing moves noticeably in the first tenth", () => {
  const firstTenth = webMotion.easeSectionTransition(0.1);
  assert.ok(
    firstTenth >= 0.15,
    `expected immediate visual response, received ${firstTenth}`
  );
});

test("scene entry waits until the destination is mostly visible", () => {
  assert.equal(typeof webMotion.getSceneEntryIndex, "function");
  assert.equal(
    webMotion.getSceneEntryIndex({ progress: 0.91, current: 0, target: 1 }),
    0
  );
  assert.equal(
    webMotion.getSceneEntryIndex({ progress: 0.92, current: 0, target: 1 }),
    1
  );
});
