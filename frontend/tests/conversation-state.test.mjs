import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredMessages } from "../lib/conversation-state.ts";
import { createSelectorStore, createSelectedSnapshot, shallowEqual } from "../lib/selector-store.ts";

test("restoring messages strips transient output while preserving run links and original input", () => {
  const input = [
    { id: "run", role: "assistant", kind: "text", content: "", runId: "r1", streaming: true, reasoning: "partial", trace: {} },
    { id: "plan", role: "assistant", kind: "text", content: "", planId: "p1" },
    { id: "empty", role: "assistant", kind: "text", content: " " },
    { id: "result", role: "assistant", kind: "text", content: "本轮协同完成：生成一份讲义" },
  ];
  const restored = normalizeStoredMessages(input);
  assert.deepEqual(restored.map((m) => m.id), ["run", "plan", "result"]);
  assert.equal(restored[0].runId, "r1");
  assert.equal(restored[1].planId, "p1");
  assert.equal(restored[0].streaming, false);
  assert.equal(restored[0].reasoning, undefined);
  assert.equal(restored[0].trace, undefined);
  assert.match(restored[2].content, /学习路径和资源中心/);
  assert.equal(input[0].streaming, true);
});

test("selector comparisons ignore unrelated streaming changes and subscriptions can detach", () => {
  const resources = [];
  const initial = { resources, text: "one" };
  const store = createSelectorStore(initial);
  const selected = createSelectedSnapshot(store.getSnapshot, (state) => ({ resources: state.resources }));
  const before = selected();
  let calls = 0;
  const unsubscribe = store.subscribe(() => { calls += 1; });
  store.set(initial);
  assert.equal(calls, 0);
  store.set({ resources, text: "two" });
  assert.equal(calls, 1);
  assert.strictEqual(selected(), before);
  assert.ok(shallowEqual({ resources }, { resources: store.getSnapshot().resources }));
  assert.equal(shallowEqual({ resources }, { resources: [] }), false);
  unsubscribe();
  store.set({ resources: [], text: "three" });
  assert.notStrictEqual(selected(), before);
  assert.equal(calls, 1);
});
