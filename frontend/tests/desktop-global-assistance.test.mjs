import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop shell keeps account identity at the bottom of the rail and mounts one persistent teacher", async () => {
  const [shell, launcher] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-teacher-launcher.tsx"),
  ]);

  assert.match(shell, /desktop-rail-account/);
  assert.match(shell, /desktop-rail-profile/);
  assert.match(shell, /aria-label="打开个人菜单"/);
  assert.match(shell, /<UserAvatar/);
  assert.match(shell, /\{displayName\}/);
  assert.match(shell, /href="\/desktop\/profile"/);
  assert.match(shell, /href="\/desktop\/settings"/);
  assert.match(shell, /await logout\(\)/);
  assert.doesNotMatch(shell, /desktop-topbar|topbar-academy-scroll/);
  assert.doesNotMatch(shell, /desktop-global-search/);
  assert.doesNotMatch(shell, /desktop-resource-shortcuts/);
  assert.doesNotMatch(shell, /desktop-service-state/);
  assert.doesNotMatch(shell, /checkBackend/);
  assert.doesNotMatch(shell, /SERVICE_POLL_INTERVAL_MS/);
  assert.match(shell, /<DesktopTeacherLauncher/);
  assert.doesNotMatch(shell, /label: "智能教师"/);
  assert.doesNotMatch(shell, /!pathname\.startsWith\("\/desktop\/(?:studio|resources)"\)/);
  assert.match(launcher, /aria-label="询问智能教师"/);
  assert.match(launcher, /sendQuestion\(question, attachments\)/);
  assert.match(launcher, /session\.askResourceQuestion/);
  assert.match(launcher, /<VoiceCallControl/);
  assert.match(launcher, /surfaceMode="inline"/);
  assert.match(launcher, /clampTeacherLauncherPosition/);
  assert.match(launcher, /POSITION_STORAGE_KEY/);
  assert.match(launcher, /collapsedPositionRef/);
  assert.match(launcher, /onClick=\{minimizeLauncher\}/);
  assert.match(launcher, /toggleWide/);
  assert.match(launcher, /uploadTutorAttachment/);
  assert.match(launcher, /session\.openConversation/);
  assert.match(launcher, /session\.renameConversation/);
  assert.match(launcher, /session\.deleteConversation/);
  assert.match(launcher, /session\.clearMessages/);
  assert.match(launcher, /pendingSoftwareAction/);
  assert.match(launcher, /<ResourceViewer item=\{openResource\}/);
  assert.match(launcher, /参考：/);
  assert.doesNotMatch(launcher, /dismissLauncher/);
  assert.doesNotMatch(launcher, /DISMISSED_SESSION_KEY/);
  assert.match(launcher, /onPointerDown=\{startDrag\}/);
  assert.match(launcher, /window\.addEventListener\("pointermove", onWindowPointerMove/);
  assert.match(launcher, /window\.addEventListener\("pointerup", onWindowPointerEnd\)/);
  assert.match(launcher, /onDragStart=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(launcher, /draggable=\{false\}/);
  assert.match(launcher, /aria-label="拖动智能教师窗口"/);
  assert.match(launcher, /data-teacher-drag-handle/);
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

test("path workspaces rely on the shared rail account instead of duplicating avatar menus", async () => {
  const [path, assessment] = await Promise.all([
    read("../components/desktop/desktop-path.tsx"),
    read("../components/desktop/desktop-course-assessment.tsx"),
  ]);

  for (const source of [path, assessment]) {
    assert.doesNotMatch(source, /pathUserMenu/);
    assert.doesNotMatch(source, /<UserAvatar/);
    assert.doesNotMatch(source, /aria-label="打开个人菜单"/);
  }
});

test("resource viewer delegates teacher actions to the persistent window and removes the fixed audit footer", async () => {
  const viewer = await read("../components/resource-viewer.tsx");

  assert.match(viewer, /useTeacherWindow/);
  assert.match(viewer, /openTeacher\(\{/);
  assert.doesNotMatch(viewer, /aria-label="资料问答"/);
  assert.doesNotMatch(viewer, /本资源经质检审核/);
  assert.doesNotMatch(viewer, /引用 \{sourceCount\} 处/);
});
