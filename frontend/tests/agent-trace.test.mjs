import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("frontend defines and renders structured agent trace steps", async () => {
  const types = await read("../lib/types.ts");
  const orchestrator = await read("../hooks/use-orchestrator.ts");
  const chat = await read("../components/chat.tsx");
  const store = await read("../lib/agent-run-store.ts");
  const inspector = await read("../components/agent-run-inspector.tsx");
  const desktop = await read("../components/desktop/desktop-studio.tsx");
  const panels = await read("../hooks/use-studio-panels.ts");

  assert.match(types, /export interface AgentTraceStep/);
  assert.match(types, /export type ResourcePhaseId/);
  assert.match(types, /export interface ResourceExecutionPhase/);
  assert.match(types, /export interface ResourceTaskProgress/);
  assert.match(types, /trace\?: AgentTraceStep\[\]/);
  for (const field of [
    "schema_version", "run_id", "event_id", "sequence", "span_id",
    "parent_span_id", "agent_id", "task_id", "attempt", "action_type",
    "status", "input_summary", "observation_summary", "decision_summary",
    "evidence_ids", "started_at", "ended_at", "usage", "error_code", "retryable",
    "event_type", "reasoning_text", "reasoning_delta", "reasoning_source",
    "segment_index", "visibility", "tool_policy",
  ]) {
    assert.match(types, new RegExp(`${field}`));
  }
  assert.match(store, /eventsById/);
  assert.match(store, /spansById/);
  assert.match(store, /buildAgentSpanTree/);
  assert.match(store, /selectRunParticipants/);
  assert.match(orchestrator, /event === "trace" \|\| event === "run_event"/);
  assert.match(orchestrator, /ingestRunEvent/);
  assert.match(orchestrator, /acceptsBoundRun/);
  assert.doesNotMatch(orchestrator, /appendTraceStep/);
  assert.doesNotMatch(orchestrator, /for \(const phaseEntry/);
  assert.doesNotMatch(orchestrator, /appendReasoning\(msgId/);
  assert.doesNotMatch(orchestrator, /patchMessage\(sid, \{ reasoning/);
  assert.match(chat, /function AgentTracePanel/);
  assert.match(chat, /function TraceProcessEntry/);
  assert.match(chat, /function tracePublicSummary/);
  assert.match(chat, /visibleTraceEvents/);
  assert.match(chat, /\.filter\(\(step\) => step\.event_type === "reasoning"/);
  assert.match(chat, /const events = reasoningEvents/);
  assert.match(chat, /m\.streaming \|\| \(running && m\.id === activeTraceMessageId\)/);
  assert.match(chat, /step\.reasoning_text/);
  assert.match(chat, /step\.observation_summary/);
  assert.match(chat, /step\.input_summary/);
  assert.doesNotMatch(chat, /未记录推理摘要/);
  assert.doesNotMatch(chat, /正在生成推理摘要/);
  assert.doesNotMatch(chat, /<Brain/);
  assert.match(chat, /if \(!hasReasoningSummary\) return null/);
  assert.match(chat, /决策摘要/);
  assert.match(chat, /观察/);
  assert.match(chat, /已处理/);
  assert.match(chat, /处理中/);
  assert.match(chat, /aria-expanded=\{open\}/);
  assert.match(chat, /aria-live=\{step\.status === "running"/);
  assert.match(chat, /animate-pulse text-primary/);
  assert.doesNotMatch(chat, /正在思考/);
  assert.doesNotMatch(chat, /正在查看处理过程/);
  assert.match(chat, /messageTrace/);
  assert.match(inspector, /AgentRunInspector/);
  assert.match(store, /parent_span_id/);
  assert.match(inspector, /公开事件/);
  assert.match(inspector, /过程/);
  assert.match(inspector, /详细/);
  assert.match(inspector, /结果/);
  assert.match(inspector, /selectRunParticipants/);
  assert.match(inspector, /aria-live=\{span\.status === "running"/);
  assert.doesNotMatch(inspector, /正在思考/);
  assert.doesNotMatch(inspector, /aria-label="本轮参与者"/);
  assert.match(orchestrator, /fetchAgentRunEvents/);
  assert.match(orchestrator, /event === "answer_reset"/);
  assert.doesNotMatch(desktop, /\{ id: "participants"/);
  assert.match(desktop, /gridTemplateColumns/);
  assert.match(desktop, /toggleLeft/);
  assert.match(desktop, /toggleRight/);
  assert.match(desktop, /startResize\(event, "left"\)/);
  assert.match(desktop, /startResize\(event, "right"\)/);
  assert.match(panels, /defaultLeft: DEFAULT_LEFT_W/);
  assert.match(panels, /minLeft: MIN_LEFT_W/);
  assert.match(panels, /maxLeft: MAX_LEFT_W/);
  assert.match(panels, /defaultRight: DEFAULT_RIGHT_W/);
  assert.match(panels, /minRight: MIN_RIGHT_W/);
  assert.match(panels, /maxRight: MAX_RIGHT_W/);
  assert.match(panels, /MIN_CENTER_W/);
  assert.match(desktop, /ArrowLeft|ArrowRight/);
  assert.match(panels, /STATE_KEY/);
  assert.doesNotMatch(desktop, /grid-cols-\[minmax\(180px,220px\)/);
  assert.match(desktop, /showInlineTrace=\{false\}/);
  assert.doesNotMatch(desktop, /在线 14/);
  assert.doesNotMatch(chat, /总控调度官 · 任务分诊/);
});

test("resource generation chat result stays concise instead of rendering cards", async () => {
  const orchestrator = await read("../hooks/use-orchestrator.ts");
  const chat = await read("../components/chat.tsx");

  assert.doesNotMatch(orchestrator, /addMessage\("assistant", "resources"\)/);
  assert.match(orchestrator, /已更新到学习路径/);
  assert.match(orchestrator, /资源中心/);
  assert.match(orchestrator, /normalizeStoredMessages/);
  assert.match(orchestrator, /本轮协同完成：/);
  assert.doesNotMatch(chat, /m\.kind === "resources"[\s\S]*?<ResourceCard/);
  assert.doesNotMatch(chat, /m\.kind === "path"[\s\S]*?<PathBlock/);
  assert.match(chat, /生成资料已更新/);
  assert.match(chat, /学习路径已更新/);
});
