import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildPptExportPayload,
  pptDownloadUrl,
} from "../lib/ppt-export.ts";

test("buildPptExportPayload extracts courseware slides for backend media route", () => {
  const payload = buildPptExportPayload(
    {
      id: "courseware_dp",
      type: "courseware",
      title: "动态规划课件",
      subtitle: "适合考前复习",
      meta: [],
      status: "ready",
      version: 1,
      sources: 2,
      data: {
        title: "动态规划",
        slides: [
          {
            slide_num: 1,
            title: "核心思想",
            content: ["拆分重叠子问题", "保存中间结果"],
            layout: "content",
          },
        ],
      },
    },
    "student-1"
  );

  assert.deepEqual(payload, {
    topic: "动态规划课件",
    student_id: "student-1",
    slides: [
      {
        slide_num: 1,
        title: "核心思想",
        content: ["拆分重叠子问题", "保存中间结果"],
        layout: "content",
      },
    ],
  });
});

test("pptDownloadUrl points to generated pptx file endpoint", () => {
  assert.equal(
    pptDownloadUrl("task-123"),
    "http://localhost:8000/api/media/ppt/task-123/file"
  );
});

test("courseware viewer exposes a pptx export action", async () => {
  const viewer = await readFile(
    new URL("../components/resource-viewer.tsx", import.meta.url),
    "utf8"
  );

  assert.match(viewer, /exportCoursewarePpt/);
  assert.match(viewer, /导出 PPTX/);
});
