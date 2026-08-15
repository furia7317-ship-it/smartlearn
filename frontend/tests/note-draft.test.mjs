import assert from "node:assert/strict";
import test from "node:test";

import { createNoteSourceDraft } from "../lib/note-draft.ts";

test("note draft normalizes a selected paragraph and preserves its source", () => {
  const draft = createNoteSourceDraft({
    resourceId: "resource-1",
    resourceTitle: " 链表入门 ",
    resourceType: "reading",
    selectedText: "头指针   保存\n链表入口。",
  });

  assert.equal(draft.resourceId, "resource-1");
  assert.equal(draft.resourceTitle, "链表入门");
  assert.equal(draft.selectedText, "头指针 保存 链表入口。");
  assert.ok(draft.createdAt > 0);
});
