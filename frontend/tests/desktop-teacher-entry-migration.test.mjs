import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("desktop teacher entry points open the persistent teacher window with page context", async () => {
  const entries = [
    ["../components/desktop/desktop-calendar.tsx", "calendar"],
    ["../components/desktop/desktop-todos.tsx", "todos"],
    ["../components/desktop/desktop-home-dossier.tsx", "home"],
    ["../components/desktop/desktop-path.tsx", "path"],
    ["../components/desktop/desktop-course-assessment.tsx", "assessment"],
    ["../components/desktop/desktop-practice.tsx", "practice"],
    ["../components/desktop/desktop-resources.tsx", "resources"],
    ["../components/desktop/knowledge-mastery-graph.tsx", "profile"],
  ];

  for (const [relative, moduleName] of entries) {
    const source = await read(relative);
    assert.match(source, /TeacherOpenButton|useTeacherWindow/);
    assert.match(source, new RegExp(`module:\\s*"${moduleName}"`));
    assert.match(source, /title:\s*(?:"|`)/);
    assert.match(source, /detail:\s*(?:"|`|selected)/);
    assert.doesNotMatch(source, /href="\/(?:desktop\/)?studio"/);
  }
});

test("legacy desktop studio route opens the teacher window through a compatibility redirect", async () => {
  const route = await read("../app/desktop/studio/page.tsx");
  assert.match(route, /import \{ redirect \} from "next\/navigation"/);
  assert.match(route, /redirect\("\/desktop\?teacher=open"\)/);
  assert.doesNotMatch(route, /desktop-studio/);
});

test("resource external-browser workflow opens the persistent browser without restoring studio", async () => {
  const [resources, host] = await Promise.all([
    read("../components/desktop/desktop-resources.tsx"),
    read("../components/persistent-browser.tsx"),
  ]);
  assert.doesNotMatch(resources, /\/desktop\/studio/);
  assert.match(resources, /const openExternalInBrowser = \(url: string\) => \{[\s\S]*?openInBrowser\(url\);/);
  assert.doesNotMatch(resources, /href="\/desktop\/studio"/);
  assert.match(host, /setStandalone\(true\)/);
  assert.match(host, /aria-label=\{standalone \? "内置浏览器"/);
  assert.match(host, /关闭内置浏览器/);
});

test("link-styled teacher buttons retain the surrounding desktop presentation", async () => {
  const [home, path, globals, graph] = await Promise.all([
    read("../components/desktop/desktop-home-dossier.module.css"),
    read("../components/desktop/desktop-path.module.css"),
    read("../app/globals.css"),
    read("../components/desktop/knowledge-graph.module.css"),
  ]);

  assert.match(home, /\.quickActions a,\s*\.quickActions button/);
  assert.match(path, /\.pathTopbarTools > a,\s*\.pathTopbarTools > button/);
  assert.match(globals, /\.desktop-resource-empty a,\s*\.desktop-resource-empty button/);
  assert.match(graph, /\.back\s*\{[\s\S]*?background:\s*transparent/);
});
