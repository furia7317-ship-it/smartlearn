import assert from "node:assert/strict";
import test from "node:test";
import { mapKbResults } from "../lib/kb-results.ts";

test("knowledge search preserves cloud rerank order and valid zero scores", () => {
  const hits = mapKbResults([
    { content: "first", distance: .1, reranker_score: .24, metadata: { source: "树.md", title: "遍历" } },
    { content: "second", distance: 0, reranker_score: 0 },
  ]);
  assert.deepEqual(hits.map(hit => hit.score), [.24, 0]);
  assert.deepEqual(hits.map(hit => hit.text), ["first", "second"]);
  assert.equal(hits[0].doc, "树.md");
  assert.equal(hits[0].section, "遍历");
});

test("knowledge search supports legacy distances without displaying invalid scores", () => {
  assert.deepEqual(mapKbResults([
    { distance: .4 }, { distance: 3 }, { distance: -.2 },
    { reranker_score: NaN, distance: .8 }, { distance: Infinity }, {},
  ]).map(hit => hit.score), [.8, 0, 1, .6, null, null]);
  assert.deepEqual(mapKbResults([]), []);
});
