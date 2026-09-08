import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop shell exposes real health and a global teacher outside studio", async () => {
  const [shell, launcher] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-teacher-launcher.tsx"),
  ]);

  assert.match(shell, /checkBackend/);
  assert.match(shell, /window\.setInterval\(refreshServiceState/);
  assert.match(shell, /!pathname\.startsWith\("\/desktop\/studio"\)/);
  assert.match(shell, /<DesktopTeacherLauncher/);
  assert.match(launcher, /aria-label="询问智能教师"/);
  assert.match(launcher, /session\.send\(text\)/);
  assert.match(launcher, /<VoiceCallControl/);
  assert.match(launcher, /surfaceMode="inline"/);
  assert.doesNotMatch(launcher, /教师会结合当前课程、学习路径和已经生成的资料回答/);
});

test("path summary collapses without hiding the learning canvas", async () => {
  const [path, styles] = await Promise.all([
    read("../components/desktop/desktop-path.tsx"),
    read("../components/desktop/desktop-path.module.css"),
  ]);

  assert.match(path, /const \[summaryOpen, setSummaryOpen\] = useState\(true\)/);
  assert.match(path, /aria-label=\{summaryOpen \? "收起路径摘要" : "展开路径摘要"\}/);
  assert.match(styles, /\.layoutSummaryCollapsed/);
  assert.match(styles, /\.summaryRailCollapsed/);
});

test("resource viewer keeps its teacher control but removes the fixed audit footer", async () => {
  const viewer = await read("../components/resource-viewer.tsx");

  assert.match(viewer, /aria-label="询问智能教师"/);
  assert.doesNotMatch(viewer, /本资源经质检审核/);
  assert.doesNotMatch(viewer, /引用 \{sourceCount\} 处/);
});
