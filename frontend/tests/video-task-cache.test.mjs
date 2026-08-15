import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  forgetVideoTaskId,
  readVideoTaskId,
  rememberVideoTaskId,
  VIDEO_WORKFLOW_VERSION,
} from "../lib/video-task-cache.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("video task id survives viewer remounts for the same resource version", () => {
  const storage = memoryStorage();

  rememberVideoTaskId(storage, "video-1:3", "task_abc-123");

  assert.equal(readVideoTaskId(storage, "video-1:3"), "task_abc-123");
  assert.equal(readVideoTaskId(storage, "video-1:4"), "");
});

test("embedded video task ids refresh the durable cache", () => {
  const storage = memoryStorage();

  assert.equal(readVideoTaskId(storage, "video-1:3", "server_task_9"), "server_task_9");
  assert.equal(readVideoTaskId(storage, "video-1:3"), "server_task_9");

  forgetVideoTaskId(storage, "video-1:3");
  assert.equal(readVideoTaskId(storage, "video-1:3"), "");
});

test("invalid task ids are never restored", () => {
  const storage = memoryStorage();

  rememberVideoTaskId(storage, "video-1:3", "../outside");

  assert.equal(readVideoTaskId(storage, "video-1:3"), "");
});

test("video cache exposes the renderer version used to invalidate old files", () => {
  assert.equal(VIDEO_WORKFLOW_VERSION, "remotion-whiteboard-mimo-v5");
});

test("opening a video resource inspects paused work without starting a render", async () => {
  const viewer = await readFile(new URL("../components/resource-viewer.tsx", import.meta.url), "utf8");

  assert.match(viewer, /\/snapshot/);
  assert.match(viewer, /MP4 任务已暂停，不会占用 CPU/);
  assert.match(viewer, /继续生成视频/);
  assert.doesNotMatch(viewer, /if \(!existingTaskId\) return renderVideo\(\)/);
});
