import assert from "node:assert/strict";
import test from "node:test";

import {
  createReasoningPresentationQueue,
  isMainAgentReasoning,
} from "../lib/reasoning-presentation.ts";

test("only main-agent batch summaries are presented serially before final delivery", async () => {
  const presented = [];
  const queue = createReasoningPresentationQueue({
    isActive: () => true,
    present: (event) => presented.push(event),
    wait: async () => {},
    chunkSize: 4,
    chunkDelayMs: 1,
    summaryGapMs: 1,
  });

  queue.enqueueEvent({
    event_id: "worker-summary",
    span_id: "task-a-summary",
    event_type: "reasoning",
    agent_id: "explainer",
    status: "completed",
    reasoning_text: "任务 A 已完成候选稿，等待审核。",
  });
  queue.enqueueEvent({
    event_id: "batch-before",
    span_id: "batch-before",
    event_type: "reasoning",
    agent_id: "orchestrator",
    status: "completed",
    reasoning_text: "我将并行调用两个生成工具，拿到结果后统一判断。",
  });
  queue.enqueueEvent({
    event_id: "batch-after",
    span_id: "batch-after",
    event_type: "reasoning",
    agent_id: "orchestrator",
    status: "completed",
    reasoning_text: "这一批工具结果已返回：一份通过，一份需要返工。",
  });
  queue.enqueueAction(() => presented.push({ event: "result" }));

  await queue.drain();

  const firstAfter = presented.findIndex((event) => event.span_id === "batch-after");
  const lastBefore = presented.findLastIndex((event) => event.span_id === "batch-before");
  const finalResult = presented.findIndex((event) => event.event === "result");

  assert.equal(
    presented.some((event) => event.span_id === "task-a-summary"),
    false,
    "worker reasoning must not be shown",
  );
  assert.ok(firstAfter > lastBefore, "the result summary must wait for the call summary");
  assert.ok(finalResult > firstAfter, "final delivery must wait for queued summaries");
  assert.equal(
    presented.filter((event) => event.span_id === "batch-before").at(-1).status,
    "completed",
  );
});

test("a repeated stable batch summary is not replayed", async () => {
  const presented = [];
  const queue = createReasoningPresentationQueue({
    isActive: () => true,
    present: (event) => presented.push(event),
    wait: async () => {},
  });
  const summary = {
    event_id: "one",
    span_id: "stable-batch",
    event_type: "reasoning",
    agent_id: "orchestrator",
    status: "completed",
    reasoning_text: "工具结果已返回。",
  };
  queue.enqueueEvent(summary);
  queue.enqueueEvent({ ...summary, event_id: "two" });
  await queue.drain();

  assert.equal(
    presented.filter((event) => event.span_id === "stable-batch" && event.status === "completed").length,
    1,
  );
});

test("main-agent reasoning identity is explicit", () => {
  assert.equal(isMainAgentReasoning({ event_type: "reasoning", agent_id: "orchestrator" }), true);
  assert.equal(isMainAgentReasoning({ event_type: "reasoning", agent_id: "reviewer" }), false);
  assert.equal(isMainAgentReasoning({ event_type: "tool", agent_id: "orchestrator" }), false);
});
