import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { APP_DESTINATIONS, parseAppNavigation, appHelpAnswer, appFeatureSelection, navigateToAppTarget, APP_NAVIGATION_EVENT, TEACHER_TOOL_EVENT } from "../lib/app-navigation.ts";

const source = JSON.parse(readFileSync(new URL("../../backend/app/catalogs/app_guide.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/app_navigation_cases.json", import.meta.url), "utf8"));

test("known commands resolve while questions, negatives and resource titles do not navigate", () => {
  for (const [question, expected] of cases) assert.equal(parseAppNavigation(question)?.id ?? null, expected, question);
});

test("bundled guides agree and every destination has an existing student page", () => {
  assert.deepEqual(APP_DESTINATIONS, source.entries);
  for (const item of APP_DESTINATIONS) {
    const pathname = new URL(item.href, "http://local").pathname;
    assert.ok(existsSync(new URL(`../app${pathname}page.tsx`, import.meta.url)), item.href);
    assert.equal(parseAppNavigation(`打开${item.title}`)?.id, item.id, item.title);
  }
});

test("page executor selects the correct feature and refuses arbitrary URLs", () => {
  const events = [];
  const routes = [];
  const previous = globalThis.window;
  globalThis.window = { location: { pathname: "/desktop/resources/" }, dispatchEvent: (event) => { events.push(event); return true; } };
  try {
    assert.equal(navigateToAppTarget("wrongbook", { push: (href) => routes.push(href) }), true);
    assert.deepEqual(routes, ["/desktop/practice/?tab=wrongbook"]);
    assert.equal(events[0].type, APP_NAVIGATION_EVENT);
    assert.equal(navigateToAppTarget("teacher-plan", { push: (href) => routes.push(href) }), true);
    assert.equal(events[1].type, TEACHER_TOOL_EVENT);
    assert.equal(events[1].detail, "plan");
    assert.equal(routes.length, 1, "tool window does not leave current page");
    assert.equal(navigateToAppTarget("javascript:alert(1)", { push: assert.fail }), false);
    assert.equal(navigateToAppTarget("/teacher/", { push: assert.fail }), false);
  } finally { globalThis.window = previous; }
});

test("default usage answers name actual pages, controls and collaboration entry", () => {
  assert.match(appHelpAnswer("这个软件怎么用"), /左侧.*首页/s);
  assert.match(appHelpAnswer("错题本在哪里"), /顶部「错题本」/);
  assert.match(appHelpAnswer("严谨模式在哪打开"), /更多生成设置.*完整模式/s);
  assert.match(appHelpAnswer("在哪里上传 PDF 附件"), /附件按钮/);
  assert.match(appHelpAnswer("知识库怎么用"), /生成书单/);
  assert.equal(appHelpAnswer("如何实现二叉树遍历"), null);
  assert.equal(appHelpAnswer("打开资源中心并告诉我怎么使用"), null, "mixed commands go to the agent rather than swallowing the navigation");
});

test("deep links select allowed tabs in browsers and Electron", () => {
  assert.equal(appFeatureSelection("/desktop/practice/?tab=wrongbook", "/desktop/practice/", "tab", ["recommended", "wrongbook"]), "wrongbook");
  assert.equal(appFeatureSelection("app://local/desktop/path/?tab=plan", "/desktop/path/", "tab", ["overview", "plan"]), "plan");
  assert.equal(appFeatureSelection("/desktop/settings/?section=memory", "/desktop/settings/", "section", ["memory", "profile"]), "memory");
  assert.equal(appFeatureSelection("/desktop/path/?tab=wrongbook", "/desktop/practice/", "tab", ["wrongbook"]), null);
  assert.equal(appFeatureSelection("/desktop/practice/?tab=unknown", "/desktop/practice/", "tab", ["wrongbook"]), null);
});
