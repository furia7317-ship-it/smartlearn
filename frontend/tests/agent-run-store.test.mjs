import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptsBoundRun,
  agentRunStoreReducer,
  bindNestedRunEventData,
  buildAgentSpanTree,
  createAgentRunStore,
  normalizeAgentRunEvent,
  runHasOpenSpans,
  selectActiveRun,
  selectRunParticipants,
  selectRunSpans,
} from "../lib/agent-run-store.ts";

function event(overrides = {}) {
  return normalizeAgentRunEvent({
    schema_version: "agent-run/v1",
    run_id: "run-a",
    event_id: "event-1",
    sequence: 1,
    span_id: "span-1",
    parent_span_id: "run-a",
    agent_id: "tutor",
    attempt: 1,
    action_type: "tool",
    status: "running",
    input_summary: "检索查询",
    observation_summary: "等待结果",
    decision_summary: "需要课程证据",
    evidence_ids: [],
    ...overrides,
  });
}

test("three calls to the same tool remain three independent spans", () => {
  let store = createAgentRunStore();
  for (let index = 1; index <= 3; index += 1) {
    const next = event({
      event_id: `event-${index}`,
      sequence: index,
      span_id: `tool-span-${index}`,
      action_type: "search_knowledge_base",
      input_summary: `query-${index}`,
    });
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }

  const spans = selectRunSpans(selectActiveRun(store));
  assert.equal(spans.length, 3);
  assert.deepEqual(spans.map((span) => span.span_id), [
    "tool-span-1",
    "tool-span-2",
    "tool-span-3",
  ]);
});

test("new events update their span while event ids remain auditable", () => {
  let store = createAgentRunStore();
  for (const next of [
    event(),
    event({ event_id: "event-2", sequence: 2, status: "completed", ended_at: "2026-07-13T10:00:02Z" }),
  ]) {
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }
  const run = selectActiveRun(store);
  assert.equal(run?.eventOrder.length, 2);
  assert.equal(selectRunSpans(run)[0].status, "completed");
  assert.equal(runHasOpenSpans(run), false);
});

test("span tree preserves supervisor to tool to reviewer causality", () => {
  let store = createAgentRunStore();
  const events = [
    event({ event_id: "supervisor", span_id: "supervisor", parent_span_id: "run-a", sequence: 1, action_type: "delegate" }),
    event({ event_id: "tool", span_id: "tool", parent_span_id: "supervisor", sequence: 2, agent_id: "tutor", action_type: "tool" }),
    event({ event_id: "review", span_id: "review", parent_span_id: "tool", sequence: 3, agent_id: "reviewer", action_type: "review" }),
  ];
  for (const next of events) {
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }
  const tree = buildAgentSpanTree(selectActiveRun(store));
  assert.equal(tree[0].span.span_id, "supervisor");
  assert.equal(tree[0].children[0].span.span_id, "tool");
  assert.equal(tree[0].children[0].children[0].span.span_id, "review");
});

test("active run participants and spans never include a previous run", () => {
  let store = createAgentRunStore();
  const oldEvent = event({ run_id: "run-old", event_id: "old", span_id: "old", agent_id: "reviewer" });
  const newEvent = event({ run_id: "run-new", event_id: "new", span_id: "new", agent_id: "tutor" });
  assert.ok(oldEvent && newEvent);
  store = agentRunStoreReducer(store, { type: "ingest", event: oldEvent });
  store = agentRunStoreReducer(store, { type: "ingest", event: newEvent });

  const active = selectActiveRun(store);
  assert.equal(active?.runId, "run-new");
  assert.deepEqual(selectRunParticipants(active), ["tutor"]);
  assert.deepEqual(selectRunSpans(active).map((span) => span.span_id), ["new"]);
  assert.equal(acceptsBoundRun("run-new", "run-old"), false);
});

test("a declared child resource run is mounted into its bound tutor run", () => {
  const mounted = bindNestedRunEventData(
    "chat-run",
    {
      run_id: "resource-child",
      parent_run_id: "chat-run",
      linked_parent_span_id: "tool-span",
      event_id: "child-root-start",
      span_id: "child-root",
      parent_span_id: null,
      action_type: "run",
      sequence: 1,
    },
    8,
  );
  assert.equal(mounted.run_id, "chat-run");
  assert.equal(mounted.event_id, "resource-child:child-root-start");
  assert.equal(mounted.parent_span_id, "tool-span");
  assert.equal(mounted.action_type, "subrun");
  assert.equal(mounted.sequence, 8);

  const resumedParent = bindNestedRunEventData(
    "chat-run",
    { run_id: "chat-run", event_id: "parent-resume", sequence: 3 },
    9,
  );
  assert.equal(resumedParent.sequence, 9);

  const unrelated = bindNestedRunEventData(
    "chat-run",
    { run_id: "other-run", parent_run_id: "someone-else" },
    9,
  );
  assert.equal(unrelated.run_id, "other-run");
});

test("root terminal event records an explicit cancelled run terminal", () => {
  let store = createAgentRunStore();
  const started = event({ event_id: "root-start", span_id: "run-a", parent_span_id: null, action_type: "run" });
  const cancelled = event({
    event_id: "root-stop",
    sequence: 9,
    span_id: "run-a",
    parent_span_id: null,
    action_type: "run",
    status: "cancelled",
    ended_at: "2026-07-13T10:00:09Z",
  });
  assert.ok(started && cancelled);
  store = agentRunStoreReducer(store, { type: "ingest", event: started });
  store = agentRunStoreReducer(store, { type: "ingest", event: cancelled });
  assert.equal(selectActiveRun(store)?.status, "cancelled");
});

test("a finished run has no non-terminal spans when the backend closes children first", () => {
  let store = createAgentRunStore();
  const events = [
    event({ event_id: "child-start", span_id: "child", parent_span_id: "root", sequence: 1 }),
    event({ event_id: "child-end", span_id: "child", parent_span_id: "root", sequence: 2, status: "completed" }),
    event({ event_id: "root-end", span_id: "root", parent_span_id: null, sequence: 3, action_type: "run", status: "completed" }),
  ];
  for (const next of events) {
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }
  const run = selectActiveRun(store);
  assert.equal(run?.status, "completed");
  assert.equal(runHasOpenSpans(run), false);
  assert.equal(selectRunSpans(run).every((span) => ["completed", "failed", "blocked", "cancelled"].includes(span.status)), true);
});

test("legacy error normalizes to failed and raw tool data is not retained", () => {
  const normalized = normalizeAgentRunEvent({
    run_id: "legacy",
    id: "legacy-tool-1",
    agent: "tutor",
    kind: "tool",
    title: "工具调用",
    status: "error",
    observation: "请求失败",
    raw_tool_json: { secret: true },
  });
  assert.ok(normalized);
  assert.equal(normalized.status, "failed");
  assert.equal(normalized.observation_summary, "请求失败");
  assert.equal("raw_tool_json" in normalized, false);
});

test("streamed public reasoning deltas merge into one readable span", () => {
  let store = createAgentRunStore();
  for (const next of [
    event({
      event_id: "reasoning-1",
      sequence: 1,
      span_id: "reasoning-span",
      event_type: "reasoning",
      action_type: "reasoning",
      reasoning_delta: "先确认目标，",
    }),
    event({
      event_id: "reasoning-2",
      sequence: 2,
      span_id: "reasoning-span",
      event_type: "reasoning",
      action_type: "reasoning",
      reasoning_delta: "再检索课程依据。",
    }),
    event({
      event_id: "reasoning-3",
      sequence: 3,
      span_id: "reasoning-span",
      event_type: "reasoning",
      action_type: "reasoning",
      status: "completed",
      reasoning_text: "先确认目标，再检索课程依据。",
    }),
  ]) {
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }

  const [span] = selectRunSpans(selectActiveRun(store));
  assert.equal(span.event_type, "reasoning");
  assert.equal(span.reasoning_text, "先确认目标，再检索课程依据。");
  assert.equal(span.status, "completed");
});

test("legacy fixed tutor scaffolding is hidden while real reasoning and tools remain", () => {
  let store = createAgentRunStore();
  for (const next of [
    event({
      run_id: "chat_legacy",
      event_id: "legacy-plan",
      span_id: "legacy-plan",
      sequence: 1,
      action_type: "plan",
      title: "理解问题",
    }),
    event({
      run_id: "chat_legacy",
      event_id: "reasoning",
      span_id: "reasoning",
      sequence: 2,
      event_type: "reasoning",
      action_type: "reasoning",
      title: "需要课程依据",
      reasoning_text: "这个问题需要先核对课程资料。",
    }),
    event({
      run_id: "chat_legacy",
      event_id: "tool",
      span_id: "tool",
      sequence: 3,
      event_type: "tool",
      action_type: "tool_call",
      title: "检索知识库",
    }),
  ]) {
    assert.ok(next);
    store = agentRunStoreReducer(store, { type: "ingest", event: next });
  }

  assert.deepEqual(
    selectRunSpans(selectActiveRun(store)).map((span) => span.title),
    ["需要课程依据", "检索知识库"],
  );
});
