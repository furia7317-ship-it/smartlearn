import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("desktop shell has a transform-only route transition that respects reduced motion", async () => {
  const [transition, shell] = await Promise.all([
    source("../components/layout/desktop-page-transition.tsx"),
    source("../components/layout/desktop-shell.tsx"),
  ]);

  assert.match(transition, /useReducedMotion/);
  assert.match(transition, /useAnimationControls/);
  assert.match(transition, /useLayoutEffect/);
  assert.match(transition, /requestAnimationFrame/);
  assert.match(transition, /initial=\{false\}/);
  assert.match(
    transition,
    /if \(reducedMotion \|\| suppressMotion\)[\s\S]{0,240}?controls\.set\([\s\S]{0,240}?return;/,
    "reduced motion must jump to the settled state and skip the animation",
  );
  assert.doesNotMatch(transition, /AnimatePresence/);
  assert.doesNotMatch(transition, /exit=/);
  assert.doesNotMatch(
    transition,
    /opacity:\s*0(?:\D|$)/,
    "route entry motion must never hide the whole page",
  );
  assert.doesNotMatch(
    transition,
    /web-scope/,
    "the desktop shell must not borrow the web scope",
  );

  assert.match(shell, /DesktopPageTransition/);
  assert.match(
    shell,
    /<main[\s\S]{0,200}?<DesktopPageTransition>\s*\{children\}\s*<\/DesktopPageTransition>/,
    "the desktop <main> must mount the route transition around its children",
  );
});

test("desktop route motion normalizes trailing slashes and stays still on transform-sensitive routes", async () => {
  const motion = await source("../lib/web-motion.ts");

  assert.match(motion, /normalizeRouteKey/);
  assert.match(motion, /getDesktopPageEnter/);
  assert.match(motion, /DESKTOP_PAGE_ENTER/);
  assert.match(motion, /\/desktop\/studio/);

  const { getDesktopPageEnter, normalizeRouteKey } = await import("../lib/web-motion.ts");

  assert.equal(normalizeRouteKey("/desktop/path/"), "/desktop/path");
  assert.equal(normalizeRouteKey("/desktop/path"), "/desktop/path");
  assert.equal(normalizeRouteKey("/"), "/");
  assert.equal(normalizeRouteKey(null), "/");

  assert.equal(getDesktopPageEnter("/desktop/studio/").y, 0, "studio hosts a fixed webview overlay");
  assert.ok(getDesktopPageEnter("/desktop/market").y > 0, "market keeps a small compositor-only offset");
  assert.equal(getDesktopPageEnter("/desktop/path").y, 0, "the graph canvas must not inherit a route transform");
});

test("desktop view swaps degrade to a no-op when the user asks for reduced motion", async () => {
  const { getDesktopPagerSwap, getDesktopViewSwap } = await import("../lib/web-motion.ts");

  const reduced = getDesktopViewSwap(true);
  assert.equal(reduced.transition.duration, 0);
  assert.deepEqual(reduced.initial, { opacity: 1, y: 0 });
  assert.deepEqual(reduced.exit, { opacity: 1, y: 0 });

  const full = getDesktopViewSwap(false);
  assert.ok(full.transition.duration > 0);
  assert.notDeepEqual(full.initial, full.animate);

  const pager = getDesktopPagerSwap(false);
  assert.ok(pager.initial(1).x > 0, "forward pagination enters from the right");
  assert.ok(pager.exit(1).x < 0, "forward pagination exits to the left");
  assert.ok(pager.initial(-1).x < 0, "back pagination enters from the left");
  assert.ok(pager.exit(-1).x > 0, "back pagination exits to the right");

  const reducedPager = getDesktopPagerSwap(true);
  assert.equal(reducedPager.transition.duration, 0);
  assert.deepEqual(reducedPager.initial(1), reducedPager.animate);
  assert.deepEqual(reducedPager.exit(-1), reducedPager.animate);
});

test("the desktop transition wrapper keeps the page scroll container from collapsing", async () => {
  const globals = await source("../app/globals.css");

  assert.match(globals, /\.desktop-page-transition\s*\{[^}]*height:\s*100%/s);
  assert.match(globals, /\.desktop-page-transition\s*\{[^}]*min-height:\s*0/s);
  assert.match(globals, /\.desktop-page-transition[^{]*\{[^}]*will-change:\s*transform/s);
  assert.match(globals, /--dur-page:/, "page rhythm tokens belong to the shared :root block");
  assert.doesNotMatch(
    globals,
    /\.desktop-scope[^{]*\{[^}]*--dur-page:/s,
    "shared motion tokens must not be scoped to the desktop shell",
  );
});

test("desktop rail marks the active route with a shared sliding indicator", async () => {
  const [shell, globals] = await Promise.all([
    source("../components/layout/desktop-shell.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(shell, /LayoutGroup/, "NAV and SETTINGS render apart and need one layout group");
  assert.match(shell, /layoutId=/);
  assert.match(shell, /layout=\{[^}]*"position"[^}]*\}/, "collapsing the rail must not fight a size animation");
  assert.match(shell, /desktop-rail-indicator/);
  assert.match(globals, /\.desktop-rail-indicator\s*\{[^}]*position:\s*absolute/s);
  assert.match(globals, /\.desktop-rail-link\s*\{[^}]*position:\s*relative/s);
});

test("desktop rail navigation provides immediate feedback without a blocking book overlay", async () => {
  const [shell, globals, motion] = await Promise.all([
    source("../components/layout/desktop-shell.tsx"),
    source("../app/globals.css"),
    import("../lib/web-motion.ts"),
  ]);

  assert.match(shell, /navigateFromRail/);
  assert.match(shell, /prefetch=\{false\}/);
  assert.match(shell, /setPendingHref\(href\)[\s\S]{0,180}?router\.push\(href\)/);
  assert.match(shell, /data-navigation-pending=\{pending \? "true" : undefined\}/);
  assert.match(shell, /requestIdleCallback\(prefetch, \{ timeout: 2_000 \}\)/);
  assert.doesNotMatch(shell, /DesktopBookTransition|bookPhase/);
  assert.ok(motion.DESKTOP_PAGE_DURATION <= 0.16);
  assert.match(
    globals,
    /\.desktop-page-transition\[data-transition="running"\]\s*\{[^}]*will-change:\s*transform, opacity/s,
  );
});

test("heavy desktop pages animate only their outermost view container", async () => {
  const [path, studio] = await Promise.all([
    source("../components/desktop/desktop-path.tsx"),
    source("../components/desktop/desktop-studio.tsx"),
  ]);

  for (const page of [path, studio]) {
    assert.match(page, /AnimatePresence mode="wait"/);
    assert.match(page, /getDesktopViewSwap/);
    assert.match(page, /useReducedMotion/);
  }
  assert.match(path, /<motion\.div key=\{`\$\{activeWorkspaceTab\}:\$\{view\}`\}/);
  assert.match(studio, /<motion\.div key=\{conversationGroup\}/);
  assert.match(studio, /<motion\.div key=\{activeTab\}[^>]*min-h-0/, "the studio flex chain needs min-h-0 restored");

  // 列表项本身不得套 motion：这两个文件都超过 1000 行，逐项动画会掉帧。
  assert.doesNotMatch(path, /\.map\(\([^)]*\) => \(\s*<motion\./s);
  assert.doesNotMatch(studio, /\.map\(\([^)]*\) => \(\s*<motion\./s);
});

test("studio inspector transition never displaces the persistent browser slot", async () => {
  const studio = await source("../components/desktop/desktop-studio.tsx");

  // 退出中的面板必须脱离普通流。它若留在流里，会和同一次 commit 渲染出来的
  // browser 占位槽上下堆叠把槽推出可视区，而 use-studio-panels 正是在那次 commit 后
  // 同步测量并定位 <webview>，量到错位后不会再有任何东西触发重测。
  const panel = studio.match(
    /role="tabpanel"[\s\S]{0,900}?<motion\.div[^>]*className="([^"]*)"/,
  );
  assert.ok(panel, "inspector tabpanel should still wrap its views in a motion element");
  assert.match(panel[1], /absolute/, "exiting inspector view must leave normal flow");
  assert.match(panel[1], /inset-0/);

  // absolute 需要一个定位祖先，否则会相对更外层容器定位。
  assert.match(
    studio,
    /className="relative[^"]*"\s+role="tabpanel"|role="tabpanel"[^>]*className="relative/,
    "tabpanel container must establish a positioning context",
  );

  // 浏览器占位槽本身不能被套进过场。
  assert.match(studio, /\{activeTab === "browser" && <div ref=\{browserSlotRef\}/);
});
