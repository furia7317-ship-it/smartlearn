import assert from "node:assert/strict";
import test from "node:test";
import { currentAgentActivity, normalizeAgentProgress, tracePublicSummary, visibleTraceEvents } from "../lib/agent-progress.ts";
import { agentRunStoreReducer, bindNestedRunEventData, createAgentRunStore, normalizeAgentRunEvent, selectRunSpans } from "../lib/agent-run-store.ts";

const span = (overrides = {}) => ({
  run_id: "chat-current", span_id: "tool", event_type: "tool", action_type: "generate_learning_material",
  title: "生成学习资料", status: "running", visibility: "normal", started_at: "2026-09-08T01:00:00Z",
  ...overrides,
});

test("tool, generation and review records remain visible without any reasoning summary", () => {
  const records = [span({ action_type: "run" }), span(), span({ span_id: "writer", event_type: "delegate", action_type: "generate" }), span({ span_id: "review", event_type: "verification", action_type: "review" })];
  assert.deepEqual(visibleTraceEvents(records).map(item => item.span_id), ["tool", "writer", "review"]);
  assert.equal(currentAgentActivity(records), "生成学习资料");
});

test("verbose records never leak through the empty public history fallback", () => {
  assert.deepEqual(visibleTraceEvents([span({ visibility: "verbose" })]), []);
  const root = span({ action_type: "run", title: "开始处理请求" });
  assert.deepEqual(visibleTraceEvents([root]), [root]);
  assert.equal(currentAgentActivity([]), "请求已发送，等待服务响应");
});

test("public progress is bounded, translated and independent of private payload fields", () => {
  assert.equal(normalizeAgentProgress({ status: "started", raw_response: "internal" }), undefined);
  const progress = normalizeAgentProgress({ agent: "reviewer", detail: " 核对概念和练习答案 ", status: "started", raw_response: "internal" }, 1000);
  assert.deepEqual(progress, { title: "审核资料", detail: "核对概念和练习答案", status: "running", receivedAt: 1000 });
  assert.equal(normalizeAgentProgress({ agent: "unknown", detail: "字".repeat(700) }).detail.length, 500);
  for (const [input, output] of [["done", "completed"], ["error", "failed"], ["blocked", "blocked"], ["cancelled", "cancelled"], ["queued", "pending"]]) {
    assert.equal(normalizeAgentProgress({ agent: "tool", status: input }).status, output);
  }
});

test("latest progress replaces stale activity and a newer tool event takes over", () => {
  const progress = normalizeAgentProgress({ agent: "reviewer", detail: "正在审核讲义" }, Date.parse("2026-09-08T01:00:02Z"));
  assert.equal(currentAgentActivity([span()], progress), "正在审核讲义");
  assert.equal(currentAgentActivity([span({ title: "保存资料", started_at: "2026-09-08T01:00:03Z" })], progress), "保存资料");
});

test("only public summary fields are displayed", () => {
  assert.equal(tracePublicSummary(span({ raw_arguments: "private", raw_response: "private" })), undefined);
  assert.equal(tracePublicSummary(span({ observation_summary: "已检索到 3 份资料", input_summary: "查资料" })), "已检索到 3 份资料");
  assert.equal(tracePublicSummary(span({ event_type: "reasoning", reasoning_text: "先依据已学知识确定难度。", detail: "摘要" })), "先依据已学知识确定难度。");
});

test("child generation appears inside its owning teacher answer while unrelated runs stay separate", () => {
  let store = createAgentRunStore();
  const child = normalizeAgentRunEvent(bindNestedRunEventData("chat-current", {
    schema_version: "agent-run/v1", run_id: "resource-child", parent_run_id: "chat-current",
    linked_parent_span_id: "tool", event_id: "child-start", span_id: "writer", sequence: 1,
    agent_id: "explainer", event_type: "delegate", action_type: "generate", title: "正在编写讲义", status: "running",
  }, 2));
  assert.ok(child);
  store = agentRunStoreReducer(store, { type: "ingest", event: child });
  const unrelated = normalizeAgentRunEvent({ ...child, run_id: "chat-other", event_id: "other", span_id: "other", title: "其他会话" });
  store = agentRunStoreReducer(store, { type: "ingest", event: unrelated });
  const visible = visibleTraceEvents(selectRunSpans(store.runs["chat-current"]));
  assert.deepEqual(visible.map(item => item.title), ["正在编写讲义"]);
  assert.equal(visible[0].parent_span_id, "tool");
});
