import assert from "node:assert/strict";
import test from "node:test";
import { filterTeacherConversations, switchConversationDraft } from "../lib/teacher-conversations.ts";

const conversation = (id, overrides = {}) => ({
  id, title: id, updatedAt: 1, active: false, running: false,
  teacher: "raccoon", kind: "general", resourceId: "", resourceTitle: "", ...overrides,
});
const empty = () => ({ text: "", attachments: [] });

test("session search matches all keywords across title and material, keeping the current session first", () => {
  const entries = [
    conversation("old", { title: "RAG 复习", updatedAt: 2 }),
    conversation("current", { title: "当前问答", active: true }),
    conversation("new", { title: "RAG 检索", updatedAt: 3, kind: "resource_qa", resourceTitle: "数据结构讲义" }),
  ];
  assert.deepEqual(filterTeacherConversations(entries, "", "all").map((item) => item.id), ["current", "new", "old"]);
  assert.deepEqual(filterTeacherConversations(entries, " rag   数据结构 ", "all").map((item) => item.id), ["new"]);
  assert.deepEqual(filterTeacherConversations(entries, "RAG", "general").map((item) => item.id), ["old"]);
  assert.deepEqual(filterTeacherConversations(entries, "问答", "resource_qa"), []);
  assert.deepEqual(entries.map((item) => item.id), ["old", "current", "new"], "display sorting must not reorder the source history");
});

test("switching conversations restores each unsent draft and its attachments without copying them into a new conversation", () => {
  const drafts = new Map();
  const a = { text: "讲解二叉树", attachments: [{ id: "pdf-a", name: "树.pdf" }] };
  const b = { text: "比较排序算法", attachments: [{ id: "image-b", name: "排序.png" }] };
  assert.deepEqual(switchConversationDraft(drafts, "a", "b", a, ["a", "b"]), empty());
  assert.deepEqual(switchConversationDraft(drafts, "b", "a", b, ["a", "b"]), a);
  assert.deepEqual(switchConversationDraft(drafts, "a", "b", a, ["a", "b"]), b);
  assert.deepEqual(switchConversationDraft(drafts, "b", "c", b, ["a", "b", "c"]), empty());
});

test("a submitted draft stays empty when the conversation is reopened", () => {
  const drafts = new Map();
  const input = { text: "待发送问题", attachments: [{ id: "a" }] };
  switchConversationDraft(drafts, "a", "b", input, ["a", "b"]);
  switchConversationDraft(drafts, "b", "a", empty(), ["a", "b"]);
  switchConversationDraft(drafts, "a", "b", empty(), ["a", "b"]);
  assert.deepEqual(switchConversationDraft(drafts, "b", "a", empty(), ["a", "b"]), empty());
});

test("deleting a session or clearing the account removes its cached input and attachments", () => {
  const drafts = new Map([
    ["deleted", { text: "已删除", attachments: [{ id: "old-file" }] }],
    ["other", { text: "保留", attachments: [] }],
  ]);
  assert.deepEqual(switchConversationDraft(drafts, "deleted", "next", { text: "不能复活", attachments: [] }, ["other", "next"]), empty());
  assert.equal(drafts.has("deleted"), false);
  assert.equal(drafts.get("other").text, "保留");
  assert.deepEqual(switchConversationDraft(drafts, "next", "fresh", empty(), ["fresh"]), empty());
  assert.equal(drafts.size, 0);
});
