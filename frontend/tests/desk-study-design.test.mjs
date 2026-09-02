import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("the desktop imports the shared 书院案头 visual system", () => {
  const layout = read("app/layout.tsx");
  const styles = read("app/desk-study.css");

  assert.match(layout, /import "\.\/desk-study\.css"/);
  assert.match(styles, /--desk-paper:/);
  assert.match(styles, /--desk-pine:/);
  assert.match(styles, /--desk-cinnabar:/);
  assert.match(styles, /market-hero-ink\.png/);
  assert.match(styles, /\.desktop-desk-layout/);
  assert.match(styles, /\.desk-avatar-picker/);
  assert.match(styles, /\.desktop-rail\s*\{[\s\S]*repeating-linear-gradient/);
  assert.doesNotMatch(styles, /radial-gradient/);
});

test("the desktop home follows the selected single-page dossier composition", () => {
  const page = read("app/desktop/page.tsx");
  const home = read("components/desktop/desktop-home-dossier.tsx");
  const source = `${page}\n${home}`;

  assert.match(page, /DesktopHomeDossier/);
  assert.match(home, /id="desktop-home-today"/);
  assert.match(home, /id="desktop-home-analysis"/);
  assert.match(home, /id="desktop-home-growth"/);
  assert.match(home, /aria-label="首页快捷操作"/);
  assert.match(home, /title="今日案头"/);
  assert.doesNotMatch(home, /PAGE_ORDER|pageDirection|window\.history\.pushState|aria-label="首页分页"/);
  assert.match(home, />当前学习任务</);
  assert.match(home, />今日安排</);
  assert.doesNotMatch(home, /下一页：/);
  assert.doesNotMatch(source, />智能教师批注</);
  assert.doesNotMatch(source, />已审核资料</);
  assert.doesNotMatch(source, /生成复习计划/);
  for (const title of [
    "学习分析",
    "掌握度趋势",
    "薄弱项优先级",
    "知识结构",
    "学习行为",
    "智能教师结论",
    "成长记录",
    "能力变化",
    "学习习惯",
    "成果档案",
  ]) {
    assert.match(home, new RegExp(title));
  }
  assert.doesNotMatch(source, /学习驾驶舱/);
});

test("the packaged Electron app opens the exported desktop home", () => {
  const electronMain = read("electron/main.js");
  const nextConfig = read("next.config.mjs");

  assert.match(electronMain, /loadURL\(`\$\{SCHEME\}:\/\/local\/desktop\/`\)/);
  assert.match(nextConfig, /output:\s*"export"/);
  assert.match(nextConfig, /trailingSlash:\s*true/);
});
