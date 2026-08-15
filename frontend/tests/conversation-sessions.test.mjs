import assert from "node:assert/strict";
import test from "node:test";

import {
  inferConversationKind,
  inferResourceTitle,
  isResourceQuestionMessage,
  splitLegacyResourceConversation,
} from "../lib/conversation-sessions.ts";

const message = (role, content) => ({ role, kind: "text", content });

test("recognizes the resource prompts emitted by the learning material viewer", () => {
  const prompts = [
    "我正在学习资料「D1 数据结构讲义」。请结合资料回答：数组是什么？",
    "我在资料「D2 链表讲义」中选中了下面这段内容：结点通过指针连接。",
    "请结合下面这份「排序算法」（讲义），讲解核心内容。",
    "请讲解课件「时间复杂度」第 2 页的内容。",
  ];

  for (const content of prompts) {
    assert.equal(isResourceQuestionMessage(message("user", content)), true);
  }
  assert.equal(inferResourceTitle([message("user", prompts[1])]), "D2 链表讲义");
});

test("splits a legacy mixed chat without discarding either side", () => {
  const messages = [
    message("user", "帮我生成数据结构学习路径"),
    message("assistant", "学习路径已交付 82/84 份资料。"),
    message("user", "我正在学习资料「D1 完整讲义」。请结合资料回答：这是测试"),
    message("assistant", "这是资料问答的回答。"),
  ];

  const split = splitLegacyResourceConversation(messages);
  assert.ok(split);
  assert.equal(split.generalMessages.length, 2);
  assert.equal(split.resourceMessages.length, 2);
  assert.equal(split.resourceTitle, "D1 完整讲义");
  assert.equal(inferConversationKind(split.generalMessages), "general");
  assert.equal(inferConversationKind(split.resourceMessages), "resource_qa");
});

test("does not split a conversation that already starts as resource QA", () => {
  const messages = [
    message("user", "请结合下面这份「链表讲义」（讲义），讲解核心内容。"),
    message("assistant", "链表通过指针连接结点。"),
  ];

  assert.equal(splitLegacyResourceConversation(messages), null);
  assert.equal(inferConversationKind(messages), "resource_qa");
});
