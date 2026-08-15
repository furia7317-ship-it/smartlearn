export type PublicTracePayload = Record<string, unknown>;

interface ReasoningPresentationOptions {
  isActive: () => boolean;
  present: (event: PublicTracePayload) => void;
  wait?: (delayMs: number) => Promise<void>;
  chunkSize?: number;
  chunkDelayMs?: number;
  summaryGapMs?: number;
}

interface ReasoningPresentationQueue {
  enqueueEvent: (event: PublicTracePayload) => void;
  enqueueAction: (apply: () => void, delayMs?: number) => void;
  drain: () => Promise<void>;
}

const defaultWait = (delayMs: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, delayMs);
});

const MAIN_REASONING_AGENTS = new Set(["orchestrator", "supervisor", "tutor"]);

export function isMainAgentReasoning(event: PublicTracePayload): boolean {
  if (event.event_type !== "reasoning") return false;
  const agent = String(event.agent_id ?? event.agent ?? "").trim();
  return MAIN_REASONING_AGENTS.has(agent);
}

function publicSummary(event: PublicTracePayload): string {
  for (const key of ["reasoning_text", "decision_summary", "detail"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Serializes public reasoning summaries while the underlying tasks keep running
 * concurrently. Each summary is revealed before the next task summary starts,
 * so a batch of completed workers cannot flood the conversation in one render.
 */
export function createReasoningPresentationQueue({
  isActive,
  present,
  wait = defaultWait,
  chunkSize = 8,
  chunkDelayMs = 36,
  summaryGapMs = 600,
}: ReasoningPresentationOptions): ReasoningPresentationQueue {
  let queue = Promise.resolve();
  const presentedBySpan = new Map<string, string>();

  const enqueueAction = (apply: () => void, delayMs = 0) => {
    queue = queue.then(async () => {
      if (!isActive()) return;
      apply();
      if (delayMs > 0) await wait(delayMs);
    });
  };

  const enqueueEvent = (event: PublicTracePayload) => {
    // Subagents remain visible as auditable operation cards in the side
    // panel, but only the main agent may narrate reasoning in the conversation.
    if (!isMainAgentReasoning(event)) return;
    const spanKey = String(event.span_id ?? event.event_id ?? "reasoning");
    const previous = presentedBySpan.get(spanKey) ?? "";
    const target = publicSummary(event);

    // LangGraph may revisit the same conditional route with an identical
    // stable span. Do not replay an already completed batch summary.
    if (target && target === previous) return;

    if (!target || !target.startsWith(previous)) {
      presentedBySpan.set(spanKey, target);
      enqueueAction(() => present(event), summaryGapMs);
      return;
    }

    const remaining = target.slice(previous.length);
    let visible = previous;
    for (let index = 0; index < remaining.length; index += chunkSize) {
      const piece = remaining.slice(index, index + chunkSize);
      visible += piece;
      const visibleSummary = visible;
      enqueueAction(
        () => present({
          ...event,
          event_id: `${String(event.event_id ?? spanKey)}:presentation:${visibleSummary.length}`,
          status: event.status === "completed" ? "running" : event.status,
          reasoning_text: undefined,
          reasoning_delta: piece,
          decision_summary: visibleSummary,
        }),
        chunkDelayMs,
      );
    }
    presentedBySpan.set(spanKey, target);

    if (event.status === "completed") {
      enqueueAction(() => present(event), summaryGapMs);
    }
  };

  return {
    enqueueEvent,
    enqueueAction,
    drain: () => queue,
  };
}
