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
  assert.match(launcher, /clampTeacherLauncherPosition/);
  assert.match(launcher, /POSITION_STORAGE_KEY/);
  assert.match(launcher, /DISMISSED_SESSION_KEY/);
  assert.match(launcher, /collapsedPositionRef/);
  assert.match(launcher, /onClick=\{minimizeLauncher\}/);
  assert.match(launcher, /onClick=\{dismissLauncher\}/);
  assert.match(launcher, /onPointerDown=\{startDrag\}/);
  assert.match(launcher, /aria-label="拖动智能教师窗口"/);
  assert.match(launcher, /grid size-16/);
  assert.match(launcher, /拖动气泡，点击提问/);
  assert.doesNotMatch(launcher, /min-w-\[330px\]/);
  assert.doesNotMatch(launcher, /教师会结合当前课程、学习路径和已经生成的资料回答/);
});

test("path keeps the knowledge canvas visible beside the node resource drawer", async () => {
  const [path, styles] = await Promise.all([
    read("../components/desktop/desktop-path.tsx"),
    read("../components/desktop/desktop-path.module.css"),
  ]);

  assert.match(path, /aria-label="学习路径知识依赖图"/);
  assert.match(path, /aria-label=\{`\$\{selectedNode\.step\.title\}学习资料`\}/);
  assert.match(path, /查看全部资料/);
  assert.match(styles, /\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 272px/s);
  assert.match(styles, /\.resourceDrawer/);
});

test("resource viewer keeps its teacher control but removes the fixed audit footer", async () => {
  const viewer = await read("../components/resource-viewer.tsx");

  assert.match(viewer, /aria-label="询问智能教师"/);
  assert.doesNotMatch(viewer, /本资源经质检审核/);
  assert.doesNotMatch(viewer, /引用 \{sourceCount\} 处/);
});
