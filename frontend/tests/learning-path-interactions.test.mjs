import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("knowledge nodes open the selected node resource drawer", () => {
  const source = read("components/desktop/desktop-path.tsx");
  const styles = read("components/desktop/desktop-path.module.css");

  assert.match(source, /selectedStageIndex/);
  assert.match(source, /buildKnowledgePathGraph\(pathSteps\)/);
  assert.match(source, /buildDailyTaskPlan\(pathSteps\[selectedStageIndex\]/);
  assert.match(source, /aria-pressed=\{selected\}/);
  assert.match(source, /setSelectedStageIndex\(node\.index\)/);
  assert.match(source, /<KnowledgeResourceDrawer/);
  assert.match(source, /resolveResourceForTaskTarget\(target, task, resources\)/);
  assert.match(styles, /\.knowledgeNode/);
  assert.match(styles, /\.resourceDrawer/);
  assert.match(styles, /\.graphEdge/);
  assert.match(styles, /\.graphEdgeCurrent/);
  assert.match(styles, /\.drawerNodeStatus/);
  assert.match(styles, /@keyframes\s+knowledge-node-select/);
  assert.match(styles, /\.knowledgeNodeSelected\s*\{[^}]*animation:\s*knowledge-node-select/s);
});

test("knowledge path canvas supports pointer-anchored wheel zoom and flowing pipes", () => {
  const source = read("components/desktop/desktop-path.tsx");
  const styles = read("components/desktop/desktop-path.module.css");

  assert.match(source, /viewportRef/);
  assert.match(source, /addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
  assert.match(source, /zoomAroundPointer\(zoomRef\.current \* zoomFactor, event\.clientX, event\.clientY\)/);
  assert.match(source, /knowledgePathPanForZoomAnchor/);
  assert.match(source, /className=\{styles\.graphStage\}/);
  assert.match(source, /onPointerDown=\{handleCanvasPointerDown\}/);
  assert.match(source, /target\.closest\("\[data-canvas-controls\], \[data-knowledge-node\]"\)/);
  assert.match(source, /data-knowledge-node/);
  assert.match(source, /onPointerMove=\{handleCanvasPointerMove\}/);
  assert.match(source, /onClickCapture=\{handleCanvasClickCapture\}/);
  assert.match(source, /Math\.hypot\(deltaX, deltaY\) < 4/);
  assert.match(source, /translate3d\(\$\{pan\.x\}px, \$\{pan\.y\}px, 0\) scale\(\$\{zoom\}\)/);
  assert.match(styles, /\.graphEdge::before/);
  assert.match(styles, /graph-pipe-flow-x/);
  assert.match(styles, /graph-pipe-flow-y/);
  assert.match(styles, /\.graphEdgeVerticalReverse::before/);
  assert.match(styles, /\.canvasViewportPanning/);
});

test("learning path top navigation opens real persisted workspaces", () => {
  const source = read("components/desktop/desktop-path.tsx");
  const styles = read("components/desktop/desktop-path.module.css");
  const api = read("lib/learning-path-api.ts");

  assert.match(source, /type PathWorkspaceTab = "overview" \| "courses" \| "plan"/);
  assert.match(source, /useDesktopModuleStringState<PathWorkspaceTab>/);
  assert.match(source, /"workspace\.tab"/);
  assert.match(source, /<CourseManagementWorkspace/);
  assert.match(source, /<LearningPlanWorkspace/);
  assert.doesNotMatch(source, /path-today-tasks.*scrollIntoView/);
  assert.match(source, /getLearningPathWorkspaceSummary\(\)/);
  assert.match(source, /replanSubjectPath/);
  assert.match(source, /recordTaskEvidence\(key, content, "written_response"\)/);
  assert.match(styles, /\.courseWorkspace/);
  assert.match(styles, /\.planWorkspace/);
  assert.match(api, /\/api\/path\/workspace\/\$\{encodeURIComponent\(studentId\)\}\/summary/);
});

test("desktop task steps switch the detail copy and exact linked material", () => {
  const page = read("app/desktop/page.tsx");
  const dossier = read("components/desktop/desktop-home-dossier.tsx");
  const styles = read("components/desktop/desktop-home-dossier.module.css");

  assert.match(page, /selectedTaskKey/);
  assert.match(page, /onSelectTask=\{setSelectedTaskKey\}/);
  assert.match(dossier, /onSelectTask\(task\.key\)/);
  assert.match(page, /resolveResourceForTaskTarget\(target, selectedTask, resources\)/);
  assert.match(dossier, /selectedResource/);
  assert.match(styles, /\.taskSteps button/);
});
