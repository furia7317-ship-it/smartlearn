import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("review tasks open a dedicated reflection workspace instead of an inline form", async () => {
  const [workspace, compactPath, desktopPath] = await Promise.all([
    read("../components/reflection-workspace.tsx"),
    read("../components/path-panel.tsx"),
    read("../components/desktop/desktop-path.tsx"),
  ]);

  for (const pathSource of [compactPath, desktopPath]) {
    assert.match(pathSource, /reflectionHref/);
    assert.match(pathSource, /进入复盘工作台/);
    assert.match(pathSource, /const isReviewTask/);
  }
  assert.match(workspace, /我的复盘/);
  assert.match(workspace, /AI 补充/);
  assert.match(workspace, /generateReflectionSupplement/);
  assert.match(workspace, /saveReflection/);
  assert.match(workspace, /recordReflection/);
  assert.match(workspace, /orchestrator\.masterPath/);
  assert.match(workspace, /orchestrator\.subjectPaths/);
  assert.match(workspace, /pathId/);
  assert.match(workspace, /前往资源中心/);
  assert.match(workspace, /bg-\[#fff8e9\]/);
  assert.match(workspace, /bg-\[#eef6f0\]/);
});

test("reflection records chat, quiz, and task evidence without mixing authorship", async () => {
  const [context, materialApi, viewer, orchestrator] = await Promise.all([
    read("../lib/reflection.ts"),
    read("../lib/library.ts"),
    read("../components/resource-viewer.tsx"),
    read("../hooks/use-orchestrator.ts"),
  ]);

  assert.match(context, /chatHistory/);
  assert.match(context, /quizSummaries/);
  assert.match(context, /evidenceSummaries/);
  assert.match(context, /不要改写或冒充学生原文/);
  assert.match(materialApi, /\/api\/materials\/reflections/);
  assert.match(viewer, /学生原文/);
  assert.match(viewer, /教师补充/);
  assert.match(orchestrator, /const recordReflection = useCallback/);
  assert.match(orchestrator, /主动复盘/);
  assert.match(orchestrator, /AI 协作复盘/);
});
