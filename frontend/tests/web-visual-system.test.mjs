import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("web shell uses the scoped paper palette and a top navigation", async () => {
  const [shell, globals, desktop, transition] = await Promise.all([
    source("../components/layout/app-shell.tsx"),
    source("../app/globals.css"),
    source("../components/layout/desktop-shell.tsx"),
    source("../components/layout/web-page-transition.tsx"),
  ]);

  assert.match(shell, /web-scope/);
  assert.match(shell, /<header/);
  assert.doesNotMatch(shell, /<aside/);
  for (const token of ["--web-paper", "--web-teal", "--web-ochre", "--web-coral"]) {
    assert.match(globals, new RegExp(token));
  }
  assert.match(globals, /\.web-scope/);
  assert.doesNotMatch(desktop, /web-scope/);
  assert.doesNotMatch(transition, /AnimatePresence/);
  assert.doesNotMatch(transition, /exit=/);
  assert.match(transition, /useAnimationControls/);
  assert.match(transition, /controls\.set\(WEB_PAGE_ENTER\)/);
  assert.match(transition, /requestAnimationFrame/);
  assert.match(transition, /initial=\{false\}/);
  assert.doesNotMatch(
    transition,
    /opacity:\s*0(?:\D|$)/,
    "route entry motion must never hide the whole page"
  );
});

test("web app dashboard keeps live learning data and delegates presentation to the scroll story", async () => {
  const [home, story, hero, board, globals] = await Promise.all([
    source("../app/app/page.tsx"),
    source("../components/home/home-scroll-story.tsx"),
    source("../components/home/home-hero.tsx"),
    source("../components/home/home-learning-board.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(home, /useOrchestratorContext/);
  assert.match(home, /getDashboardInsights/);
  assert.match(home, /getHomeModules/);
  assert.match(home, /HomeScrollStory/);
  assert.match(story, /HOME_SECTION_IDS/);
  assert.match(story, /onScroll=/, "active section must follow native scrolling without animation frames");
  assert.match(story, /onWheel=/, "one wheel gesture should move to the next full section");
  assert.match(story, /wheelGesture/);
  assert.match(story, /sceneActive/);
  assert.match(story, /getSceneEntryIndex/);
  assert.match(story, /isActive=\{sceneActive === 1\}/);
  assert.match(story, /isActive=\{sceneActive === 2\}/);
  assert.match(story, /requestAnimationFrame/);
  assert.match(story, /classList\.add\(["']is-section-animating["']\)/);
  assert.match(story, /classList\.remove\(["']is-section-animating["']\)/);
  assert.doesNotMatch(
    story,
    /data-native-scroll/,
    "home wheel gestures must always belong to the full-section story"
  );
  assert.doesNotMatch(
    board,
    /data-native-scroll/,
    "the learning ledger must fit inside its section instead of trapping wheel input"
  );
  assert.doesNotMatch(story, /wheelLock|720/, "full-section motion must not use the old fixed lock");
  assert.match(story, /useScroll/);
  assert.match(story, /useSpring/);
  assert.match(story, /home-scroll-progress/);
  assert.match(globals, /scroll-snap-type:\s*y mandatory/);
  assert.match(
    globals,
    /\.home-scroll-story\.is-section-animating\s*\{[^}]*scroll-snap-type:\s*none/s,
    "custom animation frames must not be quantized by mandatory scroll snap"
  );
  assert.match(globals, /scroll-snap-stop:\s*always/);
  assert.match(globals, /scroll-behavior:\s*auto/);
  assert.match(globals, /\.learning-ledger\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(
    globals,
    /\.home-workspace__grid\s*\{[^}]*min-height:\s*0/s,
    "the workspace scene must fit exactly inside one viewport"
  );
  assert.match(
    hero,
    /initial:\s*reducedMotion \? false : \{ y:/,
    "hero copy needs a visible transform-only entry state"
  );
  assert.doesNotMatch(
    board,
    /opacity:\s*0/,
    "workspace content must never depend on a hidden animation start state"
  );
  assert.match(board, /isActive:\s*boolean/);
  assert.match(board, /animate=\{isActive \?/);
  assert.doesNotMatch(board, /whileInView/);

  const finale = await source("../components/home/home-resource-finale.tsx");
  assert.match(finale, /isActive:\s*boolean/);
  assert.match(finale, /animate=\{isActive \?/);
  assert.doesNotMatch(finale, /whileInView/);
});

test("primary web routes use a wider desktop work area", async () => {
  const routes = [
    "../app/create/page.tsx",
    "../app/diagnostic/page.tsx",
    "../app/kb/page.tsx",
    "../app/path/page.tsx",
    "../app/path/study/page.tsx",
    "../app/practice/page.tsx",
    "../app/profile/page.tsx",
    "../app/resources/page.tsx",
    "../app/settings/page.tsx",
  ];
  const [globals, settings, ...pages] = await Promise.all([
    source("../app/globals.css"),
    source("../app/settings/page.tsx"),
    ...routes.map(source),
  ]);

  for (const page of pages) {
    assert.match(page, /web-route-frame/);
  }
  assert.match(settings, /settings-page-grid/);
  assert.match(globals, /\.web-route-frame\s*\{[^}]*max-width:\s*1360px/s);
  assert.match(globals, /\.settings-page-grid\s*\{[^}]*grid-template-columns:/s);
});

test("web and desktop expose equivalent learning tools through independent page components", async () => {
  const [shell, webVideo, webCodeLab, webPath, webStudio, desktopRoute, desktopPath, desktopFeature] =
    await Promise.all([
      source("../components/layout/app-shell.tsx"),
      source("../app/video-learning/page.tsx"),
      source("../app/code-lab/page.tsx"),
      source("../app/path/page.tsx"),
      source("../app/studio/page.tsx"),
      source("../app/desktop/video-learning/page.tsx"),
      source("../components/desktop/desktop-path.tsx"),
      source("../components/desktop/desktop-video-learning.tsx"),
    ]);

  assert.match(shell, /href="\/video-learning"/);
  assert.match(shell, /href="\/code-lab"/);
  assert.match(webVideo, /searchBilibiliVideos/);
  assert.match(webVideo, /analyzeBilibiliVideo/);
  assert.match(webCodeLab, /executeCodeWithReview/);
  assert.match(webPath, /WebSubjectPathManager/);
  assert.match(webStudio, /WebConversationSidebar/);
  for (const webSource of [webVideo, webCodeLab, webPath, webStudio]) {
    assert.doesNotMatch(webSource, /@\/components\/desktop|@\/app\/desktop/);
    assert.doesNotMatch(webSource, /["']\/desktop(?:\/|["'])/);
  }
  assert.match(desktopRoute, /desktop-video-learning/);
  assert.match(desktopPath, /href=["']\/desktop\/video-learning["']/);
  assert.doesNotMatch(desktopPath, /href=["']\/video-learning["']/);
  assert.doesNotMatch(desktopPath, /\/desktop\/desktop\/video-learning/);
  assert.match(desktopFeature, /searchBilibiliVideos/);
  assert.match(desktopFeature, /analyzeBilibiliVideo/);
  assert.match(desktopFeature, /recordWatchedVideo/);
  assert.match(desktopFeature, /appendResources/);
});

test("public home is a five-scene marketing story whose trial CTA enters login first", async () => {
  const [route, marketing, styles, shell] = await Promise.all([
    source("../app/page.tsx"),
    source("../components/marketing/marketing-home.tsx"),
    source("../components/marketing/marketing-home.module.css"),
    source("../components/layout/shell-switch.tsx"),
  ]);

  assert.match(route, /MarketingHome/);
  assert.match(marketing, /\["hero", "agents", "resources", "loop", "start"\]/);
  assert.match(marketing, /FREE_TRIAL_HREF = "\/login\?next=\/app"/);
  assert.match(marketing, /advanceWheelGesture/);
  assert.match(marketing, /onWheel=/);
  assert.match(marketing, /AnimatePresence/);
  assert.match(marketing, /agent-orbits-v2\.png/);
  assert.match(marketing, /learning-loop-v2\.png/);
  assert.match(marketing, /dashboard-path-mascot\.webp/);
  assert.match(marketing, /dashboard-plan-mascot\.webp/);
  assert.match(marketing, /dashboard-review-mascot\.webp/);
  assert.match(marketing, /题目解析/);
  assert.match(marketing, /代码挑战/);
  assert.match(marketing, /图片、PDF 和文档/);
  assert.match(marketing, /30 天/);
  assert.match(marketing, /transitioning/);
  assert.match(marketing, /下载桌面端/);
  assert.match(styles, /scroll-snap-type:\s*y mandatory/);
  assert.match(styles, /scroll-snap-stop:\s*always/);
  assert.match(styles, /\.heroTarget/);
  assert.match(styles, /\.agentNetwork/);
  assert.match(styles, /\.loopScene/);
  assert.match(shell, /if \(isMarketing\) return children/);
});

test("studio conversation uses the available desktop width", async () => {
  const [studio, chat] = await Promise.all([
    source("../app/studio/page.tsx"),
    source("../components/chat.tsx"),
  ]);

  assert.match(studio, /h-14 shrink-0/);
  assert.match(studio, /font-display text-base/);
  assert.match(chat, /max-w-\[980px\]/);
  assert.doesNotMatch(chat, /max-w-\[760px\]/);
});

test("local preview allows loopback and the current WSL browser origin", async () => {
  const config = await source("../next.config.mjs");
  assert.match(config, /allowedDevOrigins:\s*\[[^\]]*["']127\.0\.0\.1["']/);
  assert.match(config, /allowedDevOrigins:\s*\[[^\]]*["']172\.24\.20\.109["']/);
});

test("desktop launcher enters the exported desktop route", async () => {
  const launcher = await source("../electron/main.js");
  assert.match(launcher, /loadURL\(`\$\{SCHEME\}:\/\/local\/desktop\/`\)/);
  assert.doesNotMatch(launcher, /start\.bat|\/mobile\//);
});

test("responsive charts start from a positive fallback size", async () => {
  const frame = await source("../components/chart-frame.tsx");
  assert.match(frame, /initialDimension=\{\{\s*width:\s*360,\s*height\s*\}\}/);
});

test("approved mascot assets are installed", async () => {
  for (const file of [
    "../public/brand/animals/hero-study.webp",
    "../public/brand/animals/red-panda-plan.webp",
    "../public/brand/animals/chinese-alligator-review.webp",
    "../public/brand/animals/resource-desk.webp",
    "../public/brand/animals/dashboard-path-mascot.webp",
    "../public/brand/animals/dashboard-plan-mascot.webp",
    "../public/brand/animals/dashboard-review-mascot.webp",
  ]) {
    await access(new URL(file, import.meta.url));
  }
});

test("web presentation contains no purple-family utility colors", async () => {
  const videoPlayer = await source("../components/video-player.tsx");
  assert.doesNotMatch(videoPlayer, /purple|violet|lilac|magenta|indigo/i);
});
