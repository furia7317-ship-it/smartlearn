import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackResourceAction,
  hasResourceTypeHint,
  isResourceOpenIntent,
  wantsResourceGeneration,
} from "../lib/agent-action.ts";

const resources = [
  { id: "video-1", type: "video", title: "数组与链表动画讲解", status: "ready" },
  { id: "lecture-1", type: "explainer", title: "数据结构完整讲义", status: "ready" },
  { id: "pending-1", type: "explainer", title: "未审核讲义", status: "review" },
];

test("opening existing material takes precedence over generation intent", () => {
  assert.equal(isResourceOpenIntent("打开资料"), true);
  assert.equal(isResourceOpenIntent("帮我查看数据结构讲义"), true);
  assert.equal(isResourceOpenIntent("在资源中心里的东西啊，你不能打开吗？"), true);
  assert.equal(wantsResourceGeneration("打开学习资料"), false);
  assert.equal(wantsResourceGeneration("帮我生成学习资料"), true);
  assert.equal(isResourceOpenIntent("请解释怎么打开资料"), false);
  assert.equal(hasResourceTypeHint("打开数据结构入门学习视频"), true);
  assert.equal(hasResourceTypeHint("打开资源中心里的东西"), false);
});

test("fallback action only selects a real ready resource", () => {
  assert.deepEqual(
    fallbackResourceAction("打开一份视频资料", resources),
    {
      action: "open_resource",
      resource_id: "video-1",
      label: "打开《数组与链表动画讲解》",
      reply: "好的，已经为你打开《数组与链表动画讲解》。",
    },
  );
  assert.equal(fallbackResourceAction("打开未审核讲义", resources).resource_id, "lecture-1");
  assert.deepEqual(fallbackResourceAction("数组和链表有什么区别", resources), { action: "none" });
});
