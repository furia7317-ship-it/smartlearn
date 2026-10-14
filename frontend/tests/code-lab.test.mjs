import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("code examples request visualization only from the explicit button action", async () => {
  const [viewer, api] = await Promise.all([
    read("../components/resource-viewer.tsx"),
    read("../lib/code-lab.ts"),
  ]);

  assert.match(viewer, /生成演示/);
  assert.match(viewer, /onClick=\{\(\) => void visualize\(\)\}/);
  assert.match(viewer, /await requestCodeVisualization\(code/);
  assert.match(viewer, /action=\{eligibility\?\.eligible/);
  assert.match(viewer, /checkCodeVisualizationEligibility\(code, language\)/);
  assert.doesNotMatch(viewer, /useEffect\(\(\) => \{\s*void visualize\(\)/);
  assert.match(api, /MAX_VISUALIZATION_SOURCE_LINES = 300/);
  assert.match(api, /\/api\/code-lab\/eligibility/);
  assert.match(api, /\/api\/code-lab\/visualizations\/restore/);
  assert.match(viewer, /restoreCodeVisualization\(code, resourceId\)/);
  assert.match(viewer, /resourceId=\{item\.id\}/);
  assert.match(viewer, /extractPythonCodeExamples/);
  assert.doesNotMatch(viewer, /\{eligibility\?\.reason\}/);
  assert.match(viewer, /result\.execution\.trace\.length === 0/);
  assert.doesNotMatch(viewer, /result\.execution\.error \|\| result\.execution\.trace\.length/);
});

test("visualization line limits ignore blank and full-line Python comments", async () => {
  const api = await read("../lib/code-lab.ts");
  assert.match(api, /export function countExecutableSourceLines/);
  assert.match(api, /!trimmed\.startsWith\("#"\)/);
  assert.match(api, /countExecutableSourceLines\(code\) > MAX_VISUALIZATION_SOURCE_LINES/);
});

test("code trace renders animated bars, index pointers, and stack transitions", async () => {
  const visualizer = await read("../components/code-execution-visualizer.tsx");

  assert.match(visualizer, /function ArrayDiagram/);
  assert.match(visualizer, /数据变化画布/);
  assert.match(visualizer, /POINTER_NAMES/);
  assert.match(visualizer, /BAR_TONES/);
  assert.match(visualizer, /POINTER_TONES/);
  assert.match(visualizer, /type: "spring"/);
  assert.match(visualizer, /AnimatePresence/);
  assert.match(visualizer, /codeViewportRef/);
  assert.match(visualizer, /data-code-line/);
  assert.match(visualizer, /aria-label="当前执行行"/);
  assert.match(visualizer, /stripPythonComment/);
  assert.match(visualizer, /displayLines\.map/);
  assert.match(visualizer, /getBoundingClientRect/);
  assert.match(visualizer, /viewport\.scrollTo/);
  assert.doesNotMatch(visualizer, /scrollIntoView/);
  assert.match(visualizer, /排序算法轨迹/);
  assert.match(visualizer, /SORT_ALGORITHM_LABELS/);
  assert.match(visualizer, /\$\{name\}:slot:\$\{index\}/);
  assert.doesNotMatch(visualizer, /tokenizedValues/);
  assert.doesNotMatch(visualizer, /数组状态/);
});

test("learning paths open code resources without linking to the retired challenge page", async () => {
  const [dailyPlan, scheduler] = await Promise.all([
    read("../lib/daily-task-plan.ts"),
    read("../../backend/app/agents/scheduler.py"),
  ]);

  assert.match(dailyPlan, /code:\s*\{ label: "打开代码资料", href: "\/resources" \}/);
  assert.match(scheduler, /CODE_RESOURCE_TYPES = \{"code"\}/);
  assert.match(scheduler, /"title": f"代码挑战：\{chapter_title\}"/);
  assert.match(scheduler, /"completion_kind": "written_response"/);
});

test("video task association is persisted through the materials API", async () => {
  const [library, viewer] = await Promise.all([
    read("../lib/library.ts"),
    read("../components/resource-viewer.tsx"),
  ]);

  assert.match(library, /\/api\/materials\/detail\/\$\{encodeURIComponent\(materialId\)\}\/media/);
  assert.match(viewer, /await linkMaterialVideo\(/);
  assert.match(viewer, /media_task_id: linked\.media_task_id/);
});
