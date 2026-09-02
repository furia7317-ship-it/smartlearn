import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop modules defer the resource viewer until first open and retain its exit animation", async () => {
  const modules = await Promise.all([
    read("../app/desktop/page.tsx"),
    read("../components/desktop/desktop-path.tsx"),
    read("../components/desktop/desktop-resources.tsx"),
    read("../components/desktop/desktop-studio.tsx"),
  ]);

  for (const source of modules) {
    assert.match(
      source,
      /dynamic\(\s*\(\) => import\("@\/components\/resource-viewer"\)/,
    );
    assert.doesNotMatch(
      source,
      /^import \{ ResourceViewer \} from "@\/components\/resource-viewer";/m,
    );
    assert.match(
      source,
      /const \[resourceViewerActivated, setResourceViewerActivated\] = useState\(false\)/,
    );
    assert.match(source, /\{resourceViewerActivated \?/);
    assert.match(source, /item=\{open(?:Item|Resource)(?:\?\.item \?\? null)?\}/);
  }

  const path = modules[1];
  const resources = modules[2];
  assert.match(path, /import\("@\/components\/learning-baseline-gate"\)/);
  assert.match(resources, /import\("@\/components\/market-publish-dialog"\)/);
  assert.match(resources, /import\("@\/components\/resource-path-attachment-dialog"\)/);
  assert.match(resources, /\{attachItem \? \(/);
  assert.match(resources, /\{marketOpen \? \(/);
});

test("desktop rail gives immediate pending feedback and prefetches selectively", async () => {
  const [shell, moduleView] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../lib/desktop-module-view.ts"),
  ]);

  assert.match(shell, /prefetch=\{false\}/);
  assert.match(shell, /onMouseEnter=\{\(\) => onPrefetch\(item\)\}/);
  assert.match(shell, /onFocus=\{\(\) => onPrefetch\(item\)\}/);
  assert.match(shell, /requestIdleCallback\(prefetch, \{ timeout: 2_000 \}\)/);
  assert.match(shell, /IDLE_PREFETCH_MODULES = \["\/desktop\/path", "\/desktop\/resources"\]/);
  assert.match(shell, /setPendingHref\(href\)/);
  assert.match(shell, /aria-busy=\{Boolean\(pendingHref\)\}/);
  assert.match(shell, /getDesktopModuleId\(pathname\) === getDesktopModuleId\(pendingHref\)/);
  assert.match(shell, /NAVIGATION_PENDING_TIMEOUT_MS = 10_000/);
  assert.match(shell, /current === pendingHref \? "" : current/);
  assert.doesNotMatch(
    shell,
    /NAV\.map\([\s\S]{0,220}router\.prefetch/,
    "the rail must not eagerly prefetch every primary module",
  );
  assert.match(shell, /label: "资源中心"[\s\S]{0,180}activePrefixes: \["\/desktop\/create", "\/desktop\/kb", "\/desktop\/video-learning"\]/);
  assert.doesNotMatch(shell, /label: "智能教师"[\s\S]{0,140}activePrefixes: \[[^\]]*"\/desktop\/create"/);
  assert.match(moduleView, /resources: \["\/desktop\/resources", "\/desktop\/create", "\/desktop\/kb", "\/desktop\/video-learning"\]/);
});

test("desktop route motion stays on cheap compositor properties", async () => {
  const [motion, globals] = await Promise.all([
    import("../lib/web-motion.ts"),
    read("../app/globals.css"),
  ]);

  assert.ok(motion.DESKTOP_PAGE_DURATION <= 0.16);
  for (const state of [motion.DESKTOP_PAGE_ENTER, motion.DESKTOP_PAGE_ENTER_STILL]) {
    assert.equal("filter" in state, false);
    assert.equal("scale" in state, false);
    assert.ok(state.opacity > 0.9, "the incoming page must remain visible");
  }
  const runningRule = globals.match(/\.desktop-page-transition\[data-transition="running"\]\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.doesNotMatch(runningRule, /filter/);
});

test("learning-path particles move with transform and pause while dragging", async () => {
  const css = await read("../components/desktop/desktop-path.module.css");
  const keyframes = css.match(/@keyframes graph-pipe-flow-x[\s\S]*?@keyframes graph-pipe-flow-y[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(keyframes, /translate3d/);
  assert.doesNotMatch(keyframes, /\b(?:left|top)\s*:/);
  assert.match(css, /\.canvasViewportPanning \.graphEdge::before\s*\{[^}]*animation-play-state:\s*paused/s);
});

test("heavy desktop artwork uses compact WebP derivatives", async () => {
  const refs = await Promise.all([
    read("../app/globals.css"),
    read("../app/desk-study.css"),
    read("../components/desktop/desktop-path.module.css"),
    read("../components/desktop/desktop-course-assessment.module.css"),
    read("../components/layout/desktop-shell.tsx"),
  ]);
  const joined = refs.join("\n");
  for (const name of [
    "book-spine-texture-v2",
    "paper-texture-v2",
    "path-learning-landscape-v1",
    "path-canvas-network-v2",
  ]) {
    assert.match(joined, new RegExp(`${name}\\.webp`));
  }

  const optimized = [
    "../public/brand/desktop/book-spine-texture-v2.webp",
    "../public/brand/desktop/paper-texture-v2.webp",
    "../public/brand/path/path-learning-landscape-v1.webp",
    "../public/brand/path/path-canvas-network-v2.webp",
  ];
  const sizes = await Promise.all(optimized.map((path) => stat(new URL(path, import.meta.url))));
  assert.ok(sizes.every((entry) => entry.size < 150_000));
});

test("home charts are split out of the initial route chunk", async () => {
  const [home, charts] = await Promise.all([
    read("../components/desktop/desktop-home-dossier.tsx"),
    read("../components/desktop/desktop-home-charts.tsx"),
  ]);
  assert.doesNotMatch(home, /from "recharts"/);
  assert.doesNotMatch(home, /import\("recharts"\)/);
  assert.match(home, /dynamic\(\s*\(\) => import\("\.\/desktop-home-charts"\)/);
  assert.match(charts, /from "recharts"/);
  assert.match(charts, /<Scatter data=\{graphData\} dataKey="z">[\s\S]*?<Cell/);
});
