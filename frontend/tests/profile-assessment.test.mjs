import assert from "node:assert/strict";
import test from "node:test";

import {
  masteryTarget,
  mergeAssessmentTags,
} from "../lib/profile-assessment.ts";

test("maps every mastery level explicitly", () => {
  assert.equal(masteryTarget("基础"), 42);
  assert.equal(masteryTarget("进阶"), 64);
  assert.equal(masteryTarget("完全掌握"), 86);
});
test("builds readable assessment tags and drops legacy mojibake", () => {
  assert.deepEqual(
    mergeAssessmentTags(["鎽稿簳路数据结构", "已有标签"], {
      subject: "高数",
      level: "基础",
      gaps: ["极限", "导数"],
    }),
    ["已有标签", "摸底·高数", "掌握度·基础", "薄弱·极限"]
  );
});

test("reapplying one assessment keeps tags unique", () => {
  assert.deepEqual(
    mergeAssessmentTags(["摸底·高数", "掌握度·进阶"], {
      subject: "高数",
      level: "进阶",
    }),
    ["摸底·高数", "掌握度·进阶"]
  );
});
