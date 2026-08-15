import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");


test("complex plans render an editable confirmation card", async () => {
  const [card, chat, types] = await Promise.all([
    read("../components/resource-plan-card.tsx"),
    read("../components/chat.tsx"),
    read("../lib/types.ts"),
  ]);
  for (const label of [
    "保存修改",
    "确认并生成",
    "让规划智能体重新规划",
    "取消本次任务",
    "添加资料",
    "添加大纲章节",
  ]) {
    assert.match(card, new RegExp(label));
  }
  assert.match(card, /updatePlanDay/);
  assert.match(card, /updatePlanTask/);
  assert.match(card, /validatePlanDraft/);
  assert.match(chat, /ResourcePlanCard/);
  assert.match(types, /"plan_review"/);
  assert.match(types, /planId\?: string/);
});


test("confirmation is blocked for dirty or invalid drafts", async () => {
  const card = await read("../components/resource-plan-card.tsx");
  assert.match(card, /dirty/);
  assert.match(card, /validation\.valid/);
  assert.match(card, /disabled=.*dirty/s);
  assert.match(card, /plan\.version/);
  assert.match(card, /展开编辑规划/);
  assert.match(card, /role="dialog"/);
  assert.match(card, /max-w-\[900px\]/);
  assert.match(card, /min-h-0 flex-1 space-y-3 overflow-y-auto/);
  assert.doesNotMatch(card, /max-h-\[620px\]/);
});

test("chat keeps the main message viewport stable while streaming and exposes a return-to-bottom action", async () => {
  const chat = await read("../components/chat.tsx");
  assert.match(chat, /nearBottomRef/);
  assert.match(chat, /showNewMessages/);
  assert.match(chat, /有新消息 · 回到底部/);
  assert.match(chat, /PageUp/);
  assert.match(chat, /PageDown/);
  assert.match(chat, /scrollToBottom/);
  assert.doesNotMatch(chat, /if \(el\) el\.scrollTop = el\.scrollHeight/);
});
