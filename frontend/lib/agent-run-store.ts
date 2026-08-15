import type {
  AgentReasoningSource,
  AgentRunEventType,
  AgentRunStatus,
  AgentRunTerminalStatus,
  AgentTraceStep,
  AgentToolPolicy,
} from "@/lib/types";

export interface AgentRunRecord {
  runId: string;
  schemaVersion: string;
  status: AgentRunStatus;
  eventsById: Record<string, AgentTraceStep>;
  eventOrder: string[];
  spansById: Record<string, AgentTraceStep>;
  spanOrder: string[];
  lastSequence: number;
  startedAt?: string;
  endedAt?: string;
}

export interface AgentRunStore {
  runs: Record<string, AgentRunRecord>;
  activeRunId: string | null;
}

export interface AgentSpanTreeNode {
  span: AgentTraceStep;
  children: AgentSpanTreeNode[];
}

export type AgentRunStoreAction =
  | { type: "ingest"; event: AgentTraceStep }
  | { type: "focus"; runId: string | null }
  | { type: "clear" };

const TERMINAL = new Set<AgentRunTerminalStatus>([
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

const ROOT_ACTIONS = new Set(["run", "runtime", "orchestration"]);
const LEGACY_TUTOR_SCAFFOLD_TITLES = new Set([
  "理解问题",
  "学习画像已读取",
  "无需检索课程知识库",
  "检索课程知识库",
  "课程知识库检索完成",
  "直接回应",
  "直接回应完成",
  "组织回答",
  "回答生成完成",
  "模型调用配置检查失败",
  "答疑流程异常",
]);

export function createAgentRunStore(): AgentRunStore {
  return { runs: {}, activeRunId: null };
}

export function isTerminalRunStatus(status: AgentRunStatus): status is AgentRunTerminalStatus {
  return TERMINAL.has(status as AgentRunTerminalStatus);
}

function publicText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 500) : undefined;
}

function publicReasoning(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const readable = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return readable ? readable.slice(0, 12_000) : undefined;
}

function stringField(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = publicText(data[key]);
    if (value) return value;
  }
  return undefined;
}

function normalizeEventType(
  value: unknown,
  actionType: string,
): AgentRunEventType {
  const candidate = String(value ?? "").toLowerCase();
  if (
    candidate === "reasoning" ||
    candidate === "tool" ||
    candidate === "delegate" ||
    candidate === "verification" ||
    candidate === "result"
  ) {
    return candidate;
  }
  if (actionType === "reasoning") return "reasoning";
  if (actionType === "tool" || actionType === "tool_call") return "tool";
  if (["delegate", "subrun", "handoff"].includes(actionType)) return "delegate";
  if (["review", "verification"].includes(actionType)) return "verification";
  if (["result", "delivery"].includes(actionType)) return "result";
  return "operation";
}

function normalizeToolPolicy(value: unknown): AgentToolPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const policy = value as Record<string, unknown>;
  return {
    effect: typeof policy.effect === "string" ? policy.effect : undefined,
    destructive:
      typeof policy.destructive === "boolean" ? policy.destructive : undefined,
    open_world:
      typeof policy.open_world === "boolean" ? policy.open_world : undefined,
    approval: typeof policy.approval === "string" ? policy.approval : undefined,
  };
}

function normalizeStatus(value: unknown): AgentRunStatus {
  const status = String(value ?? "running").toLowerCase();
  if (status === "completed" || status === "done" || status === "success") return "completed";
  if (status === "failed" || status === "error" || status === "errored") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "pending" || status === "queued") return "pending";
  return "running";
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 把新版协议或旧 trace 负载归一成公开事件。没有 run_id 的负载会被拒绝，
 * 避免把无法归属的旧事件串入当前会话。
 */
export function normalizeAgentRunEvent(
  data: Record<string, unknown>,
  fallbackSequence = 1,
): AgentTraceStep | null {
  const runId = stringField(data, "run_id");
  if (!runId) return null;

  const sequence = Math.max(0, numberField(data.sequence, fallbackSequence));
  const legacyId = stringField(data, "id");
  const eventId =
    stringField(data, "event_id") ?? legacyId ?? `${runId}:legacy-event:${sequence}`;
  const spanId = stringField(data, "span_id") ?? legacyId ?? eventId;
  const agentId = stringField(data, "agent_id", "agent") ?? "runtime";
  const actionType = stringField(data, "action_type", "kind", "phase") ?? "action";
  const eventType = normalizeEventType(data.event_type, actionType);
  const title = stringField(data, "title") ?? actionType;
  const evidenceIds = Array.isArray(data.evidence_ids)
    ? data.evidence_ids.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 50)
    : [];
  const usage = data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)
    ? (data.usage as Record<string, unknown>)
    : undefined;

  return {
    schema_version: stringField(data, "schema_version") ?? "legacy-trace-v1",
    run_id: runId,
    event_id: eventId,
    sequence,
    span_id: spanId,
    parent_span_id: stringField(data, "parent_span_id") ?? null,
    agent_id: agentId,
    task_id: stringField(data, "task_id"),
    attempt: Math.max(1, numberField(data.attempt, 1)),
    event_type: eventType,
    action_type: actionType,
    status: normalizeStatus(data.status),
    input_summary: stringField(data, "input_summary", "inputSummary"),
    observation_summary: stringField(
      data,
      "observation_summary",
      "observation",
      "detail",
    ),
    decision_summary: stringField(
      data,
      "decision_summary",
      "decisionSummary",
      "narrative",
    ),
    evidence_ids: evidenceIds,
    started_at: stringField(data, "started_at", "startedAt"),
    ended_at: stringField(data, "ended_at", "endedAt"),
    usage,
    error_code: stringField(data, "error_code"),
    retryable: typeof data.retryable === "boolean" ? data.retryable : undefined,
    title,
    phase: stringField(data, "phase"),
    detail: stringField(data, "detail"),
    chapter_id: stringField(data, "chapter_id"),
    source_count: typeof data.source_count === "number" ? data.source_count : undefined,
    response_id: stringField(data, "response_id"),
    from_agent: stringField(data, "from_agent"),
    to_agent: stringField(data, "to_agent"),
    improvement_actions: Array.isArray(data.improvement_actions)
      ? data.improvement_actions.map(String).slice(0, 20)
      : undefined,
    acceptance_check: stringField(data, "acceptance_check"),
    reasoning_text: publicReasoning(data.reasoning_text),
    reasoning_delta: publicReasoning(data.reasoning_delta),
    reasoning_source: (
      [
        "provider_summary",
        "provider_reasoning",
        "model_narration",
        "runtime",
      ].includes(String(data.reasoning_source))
        ? String(data.reasoning_source)
        : undefined
    ) as AgentReasoningSource | undefined,
    segment_index:
      typeof data.segment_index === "number" && Number.isFinite(data.segment_index)
        ? Math.max(0, data.segment_index)
        : undefined,
    visibility: ["normal", "verbose", "summary"].includes(String(data.visibility))
      ? data.visibility as AgentTraceStep["visibility"]
      : "normal",
    tool_policy: normalizeToolPolicy(data.tool_policy),
  };
}

function newRun(event: AgentTraceStep): AgentRunRecord {
  return {
    runId: event.run_id,
    schemaVersion: event.schema_version,
    status: "running",
    eventsById: {},
    eventOrder: [],
    spansById: {},
    spanOrder: [],
    lastSequence: 0,
  };
}

function eventTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function earlierTimestamp(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return (eventTime(a) ?? Infinity) <= (eventTime(b) ?? Infinity) ? a : b;
}

function laterTimestamp(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return (eventTime(a) ?? -Infinity) >= (eventTime(b) ?? -Infinity) ? a : b;
}

function reduceEvent(state: AgentRunStore, event: AgentTraceStep): AgentRunStore {
  const previousRun = state.runs[event.run_id] ?? newRun(event);
  const previousEvent = previousRun.eventsById[event.event_id];
  const previousSpan = previousRun.spansById[event.span_id];
  const accumulatedReasoning = event.reasoning_text
    ?? (
      event.reasoning_delta
        ? `${previousSpan?.reasoning_text ?? ""}${event.reasoning_delta}`.slice(0, 12_000)
        : previousSpan?.reasoning_text
    );

  const storedEvent: AgentTraceStep = previousEvent
    ? {
        ...previousEvent,
        ...event,
        started_at: previousEvent.started_at ?? event.started_at,
      }
    : event;
  const storedSpan: AgentTraceStep = previousSpan
    ? {
        ...previousSpan,
        ...event,
        sequence: Math.min(previousSpan.sequence, event.sequence),
        parent_span_id: event.parent_span_id ?? previousSpan.parent_span_id,
        started_at: earlierTimestamp(previousSpan.started_at, event.started_at),
        ended_at: laterTimestamp(previousSpan.ended_at, event.ended_at),
        evidence_ids: Array.from(new Set([...previousSpan.evidence_ids, ...event.evidence_ids])),
        reasoning_text: accumulatedReasoning,
      }
    : {
        ...event,
        reasoning_text: accumulatedReasoning,
      };

  const isRootTerminal =
    isTerminalRunStatus(event.status) &&
    (event.span_id === event.run_id || ROOT_ACTIONS.has(event.action_type));
  const nextRun: AgentRunRecord = {
    ...previousRun,
    schemaVersion: event.schema_version,
    status: isRootTerminal ? event.status : previousRun.status,
    eventsById: { ...previousRun.eventsById, [event.event_id]: storedEvent },
    eventOrder: previousEvent
      ? previousRun.eventOrder
      : [...previousRun.eventOrder, event.event_id],
    spansById: { ...previousRun.spansById, [event.span_id]: storedSpan },
    spanOrder: previousSpan
      ? previousRun.spanOrder
      : [...previousRun.spanOrder, event.span_id],
    lastSequence: Math.max(previousRun.lastSequence, event.sequence),
    startedAt: earlierTimestamp(previousRun.startedAt, event.started_at),
    endedAt: isRootTerminal
      ? laterTimestamp(previousRun.endedAt, event.ended_at)
      : previousRun.endedAt,
  };

  return {
    runs: { ...state.runs, [event.run_id]: nextRun },
    activeRunId: event.run_id,
  };
}

export function agentRunStoreReducer(
  state: AgentRunStore,
  action: AgentRunStoreAction,
): AgentRunStore {
  if (action.type === "clear") return createAgentRunStore();
  if (action.type === "focus") {
    return action.runId && !state.runs[action.runId]
      ? state
      : { ...state, activeRunId: action.runId };
  }
  return reduceEvent(state, action.event);
}

export function selectActiveRun(store: AgentRunStore): AgentRunRecord | undefined {
  return store.activeRunId ? store.runs[store.activeRunId] : undefined;
}

export function selectRunSpans(run?: AgentRunRecord): AgentTraceStep[] {
  if (!run) return [];
  return run.spanOrder
    .map((spanId) => run.spansById[spanId])
    .filter(Boolean)
    .filter((span) => !(
      run.runId.startsWith("chat_")
      && span.agent_id === "tutor"
      && span.event_type === "operation"
      && LEGACY_TUTOR_SCAFFOLD_TITLES.has(span.title)
    ))
    .sort((a, b) => a.sequence - b.sequence || a.span_id.localeCompare(b.span_id));
}

export function selectRunParticipants(run?: AgentRunRecord): string[] {
  return Array.from(
    new Set(selectRunSpans(run).map((span) => span.agent_id).filter(Boolean)),
  );
}

export function buildAgentSpanTree(run?: AgentRunRecord): AgentSpanTreeNode[] {
  const spans = selectRunSpans(run);
  const nodes = new Map<string, AgentSpanTreeNode>(
    spans.map((span) => [span.span_id, { span, children: [] }]),
  );
  const roots: AgentSpanTreeNode[] = [];
  for (const span of spans) {
    const node = nodes.get(span.span_id)!;
    const parent = span.parent_span_id ? nodes.get(span.parent_span_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sortNodes = (items: AgentSpanTreeNode[]) => {
    items.sort((a, b) => a.span.sequence - b.span.sequence);
    for (const item of items) sortNodes(item.children);
  };
  sortNodes(roots);
  return roots;
}

export function runDurationMs(run?: AgentRunRecord): number | undefined {
  if (!run?.startedAt || !run.endedAt) return undefined;
  const start = eventTime(run.startedAt);
  const end = eventTime(run.endedAt);
  if (start === undefined || end === undefined) return undefined;
  return Math.max(0, end - start);
}

export function runHasOpenSpans(run?: AgentRunRecord): boolean {
  return selectRunSpans(run).some((span) => !isTerminalRunStatus(span.status));
}

export function acceptsBoundRun(boundRunId: string | undefined, incomingRunId: string): boolean {
  return !boundRunId || boundRunId === incomingRunId;
}

export function bindNestedRunEventData(
  boundRunId: string | undefined,
  data: Record<string, unknown>,
  fallbackSequence: number,
): Record<string, unknown> {
  const incomingRunId = typeof data.run_id === "string" ? data.run_id : "";
  const parentRunId = typeof data.parent_run_id === "string" ? data.parent_run_id : "";
  const nested = Boolean(
    boundRunId &&
    incomingRunId &&
    incomingRunId !== boundRunId &&
    parentRunId === boundRunId,
  );
  if (!nested) {
    if (boundRunId && incomingRunId === boundRunId) {
      const incomingSequence =
        typeof data.sequence === "number" && Number.isFinite(data.sequence)
          ? data.sequence
          : fallbackSequence;
      return {
        ...data,
        sequence: Math.max(fallbackSequence, incomingSequence),
      };
    }
    return data;
  }
  return {
    ...data,
    run_id: boundRunId,
    event_id: `${incomingRunId}:${String(data.event_id ?? data.id ?? fallbackSequence)}`,
    sequence: fallbackSequence,
    action_type: data.action_type === "run" ? "subrun" : data.action_type,
    parent_span_id: data.parent_span_id ?? data.linked_parent_span_id ?? null,
  };
}
