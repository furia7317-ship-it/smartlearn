import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const kb = await readFile(new URL("../components/desktop/desktop-kb.tsx", import.meta.url), "utf8");
const shelf = await readFile(new URL("../components/desktop/desktop-bookshelf.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");

test("search results expose the persistent bookshelf action", () => {
  assert.match(kb, /加入书架/);
  assert.match(kb, /writeBookshelf/);
  assert.match(kb, /DesktopBookshelf/);
});

test("shelf supports preview and agent graph generation", () => {
  assert.match(shelf, /previewBook/);
  assert.match(shelf, /generateBookGraph/);
  assert.match(shelf, /全书知识图谱/);
  assert.match(shelf, /全书 → 章节 → 核心概念 → 示例 \/ 应用/);
  assert.match(shelf, /graphVersion === 2/);
  assert.match(api, /\/api\/kb\/\$\{path\}/);
});
