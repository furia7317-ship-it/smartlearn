import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcilePlanFailureConversations,
  reconcilePlanFailureMessages,
  resourcePlanCompletionMessage,
  resourcePlanTerminalMessage,
} from "../lib/resource-plan-completion.ts";

function recordWith(status, taskStatuses) {
  return {
    plan: {
      plan_id: "plan-1",
      status,
      tasks: taskStatuses.map((taskStatus, index) => ({
        task_id: `task-${index + 1}`,
        title: `资料 ${index + 1}`,
        status: taskStatus,
      })),
    },
    execution: {},
  };
}

test("completed plan reports when every resource is ready", () => {
  assert.equal(
    resourcePlanCompletionMessage(recordWith("completed", ["ready", "ready", "ready"])),
    "全部 3 份资料生成完成，已更新到学习路径和资源中心。",
  );
});

test("failed and partial terminal plans do not emit a delivery message", () => {
  assert.equal(
    resourcePlanCompletionMessage(recordWith("failed", ["ready", "failed", "failed"])),
    null,
  );
  assert.equal(
    resourcePlanCompletionMessage(recordWith("completed", ["ready", "failed"])),
    null,
  );
});

test("failed plan with no ready tasks does not emit a delivery message", () => {
  assert.equal(resourcePlanCompletionMessage(recordWith("failed", ["failed", "failed", "failed"])), null);
});

test("running, approved, and empty plans do not produce a false completion message", () => {
  assert.equal(resourcePlanCompletionMessage(recordWith("running", ["ready"])), null);
  assert.equal(resourcePlanCompletionMessage(recordWith("approved", ["ready"])), null);
  assert.equal(resourcePlanCompletionMessage(recordWith("completed", [])), null);
});

test("a completed server plan replaces its persisted failure placeholder with the result", () => {
  const failedMessage = {
    id: "m1",
    role: "assistant",
    kind: "text",
    content: "学习路径规划暂未完成：部分资料仍需服务端继续修复",
    streaming: false,
    planId: "plan-1",
  };
  const ordinaryMessage = {
    id: "m2",
    role: "assistant",
    kind: "text",
    content: "今天先学习线性表。",
    streaming: false,
  };

  assert.deepEqual(
    reconcilePlanFailureMessages(
      [failedMessage, ordinaryMessage],
      [recordWith("completed", ["ready"])],
    ),
    [{
      ...failedMessage,
      content: "全部 1 份资料生成完成，已更新到学习路径和资源中心。",
    }, ordinaryMessage],
  );
});

test("legacy unbound failure text becomes a completed delivery result", () => {
  const legacyFailure = {
    id: "m1",
    role: "assistant",
    kind: "text",
    content: "学习路径规划暂未完成：仍在修复",
    streaming: false,
  };

  assert.deepEqual(
    reconcilePlanFailureMessages(
      [legacyFailure],
      [recordWith("completed", ["ready"])],
    ),
    [{
      ...legacyFailure,
      content: "全部 1 份资料生成完成，已更新到学习路径和资源中心。",
    }],
  );
});

test("completed delivery also repairs inactive conversation snapshots", () => {
  const stale = {
    id: "m1",
    role: "assistant",
    kind: "text",
    content: "学习路径规划暂未完成：部分资料仍需服务端继续修复",
    streaming: false,
    planId: "plan-1",
  };
  const sessions = [
    { id: "old", teacher: "raccoon", messages: [stale] },
    {
      id: "other",
      teacher: "alligator",
      messages: [{ ...stale, id: "m2", planId: "plan-2" }],
    },
  ];

  assert.deepEqual(
    reconcilePlanFailureConversations(
      sessions,
      [recordWith("completed", ["ready"])],
    ),
    [
      {
        id: "old",
        teacher: "raccoon",
        messages: [{
          ...stale,
          content: "全部 1 份资料生成完成，已更新到学习路径和资源中心。",
        }],
      },
      sessions[1],
    ],
  );
});

test("completed delivery collapses an old plan-bound resource dump to one result", () => {
  const oldDump = {
    id: "m9",
    role: "assistant",
    kind: "text",
    content: "### D1 讲义\n完整正文……\n### D1 练习题\n完整题目……".repeat(40),
    streaming: false,
    planId: "plan-1",
  };

  assert.deepEqual(
    reconcilePlanFailureMessages(
      [oldDump],
      [recordWith("completed", ["ready", "ready"])],
    ),
    [{
      ...oldDump,
      content: "全部 2 份资料生成完成，已更新到学习路径和资源中心。",
    }],
  );
});

test("legacy unbound multi-resource dump is also collapsed", () => {
  const marker = "完整内容已生成，可在资料中继续阅读。";
  const oldDump = {
    id: "m10",
    role: "assistant",
    kind: "text",
    content: (`### 讲义\n${"正文".repeat(180)}\n${marker}\n`).repeat(3),
    streaming: false,
  };

  assert.deepEqual(
    reconcilePlanFailureMessages(
      [oldDump],
      [recordWith("completed", ["ready"])],
    ),
    [{
      ...oldDump,
      content: "全部 1 份资料生成完成，已更新到学习路径和资源中心。",
    }],
  );
});

test("failed plan reports exact delivered count and a sanitized hard cause", () => {
  const failed = recordWith("failed", ["ready", "failed"]);
  failed.plan.tasks[1].review = {
    approved: false,
    score: 0,
    issues: ["Error code: 402 - Insufficient Balance"],
    fixes: [],
  };
  const stale = {
    id: "m11",
    role: "assistant",
    kind: "text",
    content: "学习路径规划暂未完成：部分资料仍需服务端继续修复",
    streaming: false,
    planId: "plan-1",
  };

  assert.deepEqual(
    reconcilePlanFailureMessages([stale], [failed]),
    [{
      ...stale,
      content: "学习路径生成未全部完成：已完成 1/2 份。《资料 2》因模型服务账户额度不足。已成功内容已更新到学习路径和资源中心。",
    }],
  );
});

test("failed plan explains run-time budget exhaustion and offers a fresh retry", () => {
  const failed = recordWith("failed", ["ready", "failed", "failed"]);
  for (const task of failed.plan.tasks.slice(1)) {
    task.review = {
      approved: false,
      score: 0,
      issues: ["本次运行已达到 300 秒时限，未启动后续审核模型调用；候选资料未发布"],
      fixes: [],
      failure_kind: "budget",
      error_code: "run_time_budget_exhausted",
      retryable: true,
    };
  }

  assert.equal(
    resourcePlanTerminalMessage(failed),
    "学习路径生成未全部完成：已完成 1/3 份。《资料 2》、《资料 3》因本次运行时限已到，审核未执行，因此未发布。已成功内容已更新到学习路径和资源中心。可重新运行失败项。",
  );
});

test("ordinary plan-bound tutor text is not replaced by a terminal summary", () => {
  const ordinary = {
    id: "m14",
    role: "assistant",
    kind: "text",
    content: "我先解释栈与队列的区别。",
    streaming: false,
    planId: "plan-1",
  };

  assert.deepEqual(
    reconcilePlanFailureMessages([ordinary], [recordWith("completed", ["ready"])]),
    [ordinary],
  );
});
