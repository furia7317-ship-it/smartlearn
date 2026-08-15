import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const graph = await readFile(new URL("../components/desktop/knowledge-mastery-graph.tsx", import.meta.url), "utf8");
const bookshelf = await readFile(new URL("../components/desktop/desktop-bookshelf.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../components/desktop/knowledge-graph.module.css", import.meta.url), "utf8");

test("mastery graph renders grouped curriculum relationships and AI evidence", () => {
  assert.match(graph, /DATA_STRUCTURE_GROUPS/);
  assert.match(graph, /strength: "strong"/);
  assert.match(graph, /判断置信度/);
  assert.match(graph, /当前薄弱点/);
  assert.match(graph, /近 30 天/);
});

test("book graph renders a whole-book hierarchy with a reusable inspector", () => {
  assert.match(bookshelf, /buildBookLayout/);
  assert.match(bookshelf, /全书主题/);
  assert.match(bookshelf, /章节/);
  assert.match(bookshelf, /核心概念/);
  assert.match(bookshelf, /重新分析全书/);
});

test("graph styling is component-scoped and keeps the main canvas visible", () => {
  assert.match(styles, /\.page\s*\{[\s\S]*height:\s*100%/);
  assert.match(styles, /\.content\s*\{[\s\S]*grid-template-columns/);
  assert.match(styles, /\.graphStage\s*\{[\s\S]*position:\s*absolute/);
  assert.match(styles, /\.bookGraphLayout\s*\{[\s\S]*grid-template-columns/);
});
