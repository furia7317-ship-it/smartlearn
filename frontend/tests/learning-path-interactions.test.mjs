import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("stage cards reveal only the selected stage resources on the opposite side", () => {
  const source = read("components/desktop/desktop-path.tsx");
  const styles = read("components/desktop/desktop-path.module.css");

  assert.match(source, /selectedStageIndex/);
  assert.match(source, /aria-expanded=\{isSelected\}/);
  assert.match(source, /buildDailyTaskPlan\(pathSteps\[selectedStageIndex\]/);
  assert.match(source, /side === "left" \? styles\.branchSlotRight : styles\.branchSlotLeft/);
  assert.match(source, /value === stage\.index \? null : stage\.index/);
  assert.match(styles, /\.branchSlotLeft/);
  assert.match(styles, /\.branchSlotRight/);
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
