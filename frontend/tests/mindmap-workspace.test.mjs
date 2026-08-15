import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../components/mindmap-workspace.tsx"), "utf8");
const viewer = fs.readFileSync(path.join(here, "../components/resource-viewer.tsx"), "utf8");

test("mindmap viewer uses the interactive knowledge canvas", () => {
  assert.match(viewer, /MindmapWorkspace/);
  assert.match(viewer, /viewedItem\.type === "mindmap" \? "overflow-hidden"/);
  assert.doesNotMatch(viewer, /function MindNode\(/);
});

test("mindmap workspace exposes every core interaction", () => {
  for (const text of [
    "搜索节点",
    "全部收起",
    "自适应",
    "缩小导图",
    "放大导图",
    "全屏查看导图",
    "打开相关讲义",
    "开始配套练习",
    "向浣熊老师提问",
  ]) {
    assert.match(source, new RegExp(text));
  }
});

test("mindmap workspace keeps the real red panda brand asset and avoids fake progress", () => {
  assert.match(source, /red-panda-mindmap-guide\.png/);
  assert.match(source, /absolute bottom-4 left-4/);
  assert.doesNotMatch(source, /导图缩略导航/);
  assert.match(source, /masteryOf\(selectedNode\) !== null/);
  assert.match(source, /完成关联讲义与配套练习后/);
  assert.doesNotMatch(source, /掌握 76%/);
});

test("mindmap actions open the linked lecture and generate reviewed practice inline", () => {
  const practiceStart = viewer.indexOf("const openPractice = async");
  const practiceEnd = viewer.indexOf("const goBack", practiceStart);
  const practiceSource = viewer.slice(practiceStart, practiceEnd);

  assert.match(viewer, /openRelatedLecture/);
  assert.match(practiceSource, /streamSSE\(/);
  assert.match(practiceSource, /"\/api\/materials\/generate"/);
  assert.match(practiceSource, /material_types: \["quiz"\]/);
  assert.match(practiceSource, /data\.review_approved !== true/);
  assert.match(practiceSource, /setLinkedItem/);
  assert.doesNotMatch(practiceSource, /explainAndGo/);
  assert.match(source, /正在生成题目…/);
  assert.match(source, /practiceError/);
  assert.match(viewer, /请结合当前思维导图/);
});

test("generated lectures expose a scroll-following clickable outline", () => {
  assert.match(viewer, /讲义章节目录/);
  assert.match(viewer, /scrollIntoView/);
  assert.match(viewer, /data-resource-scroll="true"/);
  assert.match(viewer, /aria-current=/);
});
