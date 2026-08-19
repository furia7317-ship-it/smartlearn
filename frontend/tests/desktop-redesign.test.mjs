import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (relative) =>
  readFile(new URL(relative, import.meta.url), "utf8");

const DESKTOP_ROUTES = [
  "../app/desktop/page.tsx",
  "../app/desktop/studio/page.tsx",
  "../app/desktop/create/page.tsx",
  "../app/desktop/agents/page.tsx",
  "../app/desktop/path/page.tsx",
  "../app/desktop/path/study/page.tsx",
  "../app/desktop/todos/page.tsx",
  "../app/desktop/calendar/page.tsx",
  "../app/desktop/resources/page.tsx",
  "../app/desktop/theater/page.tsx",
  "../app/desktop/market/page.tsx",
  "../app/desktop/practice/page.tsx",
  "../app/desktop/code-lab/page.tsx",
  "../app/desktop/kb/page.tsx",
  "../app/desktop/diagnostic/page.tsx",
  "../app/desktop/profile/page.tsx",
  "../app/desktop/settings/page.tsx",
  "../app/desktop/video-learning/page.tsx",
  "../app/desktop/discover/page.tsx",
];

test("every required desktop route has a renderable page module", async () => {
  for (const route of DESKTOP_ROUTES) {
    await access(new URL(route, import.meta.url));
    const source = await read(route);
    assert.match(source, /export\s+(?:\{\s*default\s*\}|default)/, route);
  }
});

test("consolidated desktop destinations are reachable from their owning surfaces", async () => {
  const [shell, home, discover, resources, practice, path] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../app/desktop/page.tsx"),
    read("../components/desktop/desktop-discover.tsx"),
    read("../components/desktop/desktop-resources.tsx"),
    read("../components/desktop/desktop-practice.tsx"),
    read("../components/desktop/desktop-path.tsx"),
  ]);
  const homeDossier = await read("../components/desktop/desktop-home-dossier.tsx");
  const visibleControls = [shell, home, homeDossier, discover, resources, practice, path].join("\n");
  const requiredHrefs = [
    "/desktop",
    "/desktop/studio",
    "/desktop/path",
    "/desktop/path/study",
    "/desktop/calendar",
    "/desktop/resources",
    "/desktop/discover",
    "/desktop/theater",
    "/desktop/market",
    "/desktop/practice",
    "/desktop/code-lab",
    "/desktop/kb",
    "/desktop/diagnostic",
    "/desktop/profile",
    "/desktop/settings",
    "/desktop/video-learning",
  ];

  for (const href of requiredHrefs) {
    const escapedHref = href.replaceAll("/", "\\/");
    const literalHref = new RegExp(`href(?:=|:)\\s*["']${escapedHref}["']`);
    const conditionalHref = new RegExp(
      `href=\\{[^}]*["']${escapedHref}["'][^}]*\\}`,
    );
    assert.ok(literalHref.test(visibleControls) || conditionalHref.test(visibleControls), href);
  }
});

test("desktop-only video actions target the desktop route without relying on removed web pages", async () => {
  const [shell, path] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../components/desktop/desktop-path.tsx"),
  ]);

  assert.match(shell, /href="\/desktop\/video-learning"/);
  assert.match(path, /<NextLink[\s\S]{0,120}href="\/desktop\/video-learning"/);
  assert.doesNotMatch(path, /href="\/video-learning"/);
});

test("desktop shell matches the selected 书院案头 direction and exposes real tools", async () => {
  const [shell, home, homeDossier, deskStudy, desktopBrandAssets] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../app/desktop/page.tsx"),
    read("../components/desktop/desktop-home-dossier.tsx"),
    read("../app/desk-study.css"),
    readdir(new URL("../public/brand/desktop/", import.meta.url)),
  ]);

  const navBlock = shell.match(/const NAV[\s\S]*?\n\];/)?.[0] || "";
  for (const label of ["首页", "智能教师", "学习路径", "资源中心", "练习", "发现"]) {
    assert.match(navBlock, new RegExp(`label: "${label}"`));
  }
  assert.equal((navBlock.match(/href: "/g) || []).length, 6);
  for (const secondaryLabel of ["互动教学", "学习市场", "代码挑战", "学情摸底", "知识库", "视频学习", "设置"]) {
    assert.doesNotMatch(navBlock, new RegExp(`label: "${secondaryLabel}"`));
  }
  assert.match(shell, /href="\/desktop\/settings"/);
  assert.match(shell, /目标与设置/);
  assert.doesNotMatch(shell, /href:\s*"\/desktop\/create",\s*label:\s*"资源生成"/);
  assert.match(shell, /MessageCircle/);
  assert.match(deskStudy, /\.desktop-rail\s*\{[\s\S]*width:\s*178px/);
  assert.match(shell, /xueshu-plaque-v3\.png/);
  assert.doesNotMatch(shell, /desktop-book-rings|book-ring/);
  assert.doesNotMatch(deskStudy, /\.desktop-book-rings/);
  assert.equal(desktopBrandAssets.some((name) => name.startsWith("book-ring")), false);
  assert.match(deskStudy, /\[data-desktop-page-shell\]/);
  assert.match(deskStudy, /\.desktop-topbar\s*\{[\s\S]*height:\s*58px/);
  assert.match(deskStudy, /\.desktop-topbar-tools \.desktop-user-link\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*height:\s*34px;[\s\S]*align-items:\s*center;[\s\S]*white-space:\s*nowrap;/);
  assert.match(deskStudy, /--background:\s*#f6f0e5/);
  assert.match(deskStudy, /market-hero-ink\.png/);
  assert.match(shell, /currentCourse/);
  assert.doesNotMatch(shell, /notificationCount|通知 \{/);
  assert.match(shell, /const live = await checkBackend\(\)/);
  assert.match(shell, /serviceState === "live"/);
  assert.match(shell, /\/desktop\/profile/);
  assert.match(shell, /submitSearch/);

  assert.match(home, /buildPathDashboardPlan/);
  assert.match(homeDossier, /title: "今日案头"/);
  assert.match(homeDossier, />今日安排</);
  assert.doesNotMatch(homeDossier, />智能教师批注</);
  assert.doesNotMatch(homeDossier, />已审核资料</);
  assert.match(home, /DesktopHomeDossier/);
  assert.match(homeDossier, /"学习分析"/);
  assert.match(homeDossier, /"成长记录"/);
  assert.match(homeDossier, /downloadCsv/);
  assert.match(deskStudy, /\.desktop-desk-layout/);
  assert.match(home, /listMaterials/);
  assert.match(home, /ResourceViewer/);
  assert.doesNotMatch(home, /role="columnheader">审核状态/);
  assert.doesNotMatch(home, /desktop-reviewed-status/);
  assert.doesNotMatch(home, /协同智能体[\s\S]{0,80}12/);
  const resources = await read("../components/desktop/desktop-resources.tsx");
  assert.doesNotMatch(resources, /className="desktop-toolbar-primary"[\s\S]{0,120}生成新资料/);
  assert.match(resources, /aria-label="收起书页"/);
  assert.match(resources, /aria-label="展开资源典藏"/);
  assert.doesNotMatch(resources, /这里只发布最终审核通过的版本/);
  assert.doesNotMatch(shell, /marketMode|desktop-scope-market/);
});

test("discover presents the selected editorial-scroll direction with real destinations", async () => {
  const discover = await read("../components/desktop/desktop-discover.tsx");

  assert.match(discover, /discover-scroll-hero-v1\.png/);
  assert.match(discover, /discover-maze-pine-v1\.png/);
  assert.match(discover, /market-algorithm-v1\.png/);
  assert.match(discover, /discover-journey-panorama-v1\.png/);
  assert.match(discover, /今日策展/);
  assert.match(discover, /<Link href="\/desktop\/market" className=\{styles\.heroAction\}>/);
  assert.match(discover, /href="\/desktop\/theater"/);
  assert.match(discover, /href="\/desktop\/market"/);
  assert.match(discover, /二叉树迷宫课堂/);
  assert.match(discover, /MARKET_ITEMS\.map/);
  assert.doesNotMatch(discover, /探索不打断主路径/);
});

test("resource center has compact filters, real preview, export, confirmed delete, and offline recovery", async () => {
  const source = await read("../components/desktop/desktop-resources.tsx");

  assert.match(source, /desktop-resource-toolbar/);
  assert.match(source, /previewText\(selectedItem\.data\)/);
  assert.match(source, /getMaterialData/);
  assert.match(source, /materialsToMarkdown/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /session\.removeResource\(resource\.id\)/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /离线缓存中没有这份资料的正文/);
  assert.match(source, /disabled=\{loadingId === selectedItem\.id \|\| \(!selectedItem\.data && session\.mode !== "live"\)\}/);
  assert.match(source, /resource\.status !== "ready"/);
});

test("desktop sources contain no empty links, placeholder anchors, or double desktop prefixes", async () => {
  const roots = [
    new URL("../app/desktop/", import.meta.url),
    new URL("../components/desktop/", import.meta.url),
  ];
  const files = [];
  for (const root of roots) {
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
        if (entry.isDirectory()) await walk(child);
        else if (entry.name.endsWith(".tsx")) files.push(child);
      }
    };
    await walk(root);
  }

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /href\s*=\s*["'](?:#|)["']/, file.pathname);
    assert.doesNotMatch(source, /\/desktop\/desktop(?:\/|["'])/, file.pathname);
    if (/ShellLink as Link/.test(source)) {
      assert.doesNotMatch(
        source,
        /<Link\b[^>]*href\s*=\s*["']\/desktop\//,
        `${file.pathname} would be double-prefixed`,
      );
    }
  }
});

test("desktop layout contracts cover 1024 and 1440 widths with visible keyboard focus", async () => {
  const [shell, globals, video] = await Promise.all([
    read("../components/layout/desktop-shell.tsx"),
    read("../app/globals.css"),
    read("../components/desktop/desktop-video-learning.tsx"),
  ]);

  assert.match(shell, /min-w-\[1024px\]/);
  assert.match(globals, /max-width:\s*1420px/);
  assert.match(globals, /@media \(max-width:\s*1120px\)/);
  assert.match(globals, /focus-visible/);
  assert.match(video, /disabled=\{!hydrated \|\| mode !== "live"\}/);
  assert.match(video, /video-service-recovery/);
  assert.match(video, /127\.0\.0\.1:8000\/docs/);
});
