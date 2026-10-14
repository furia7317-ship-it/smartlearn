import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("ability overview routes long learning content to a separate study page", () => {
  const source = read("components/desktop/ability-path-tree.tsx");
  const study = read("components/desktop/ability-study.tsx");
  assert.match(source, /drawerOpen && selected/);
  assert.match(source, /abilityStudyHref/);
  assert.doesNotMatch(source, /<ResourceViewer/);
  assert.match(study, /<ResourceViewer/);
  assert.match(source, /aria-expanded=\{todayOpen\}/);
  assert.match(source, /aria-current/);
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
