export type ConversationKnowledgeScope = "course" | "personal" | "all";
export type ConversationMemoryPolicy = "session" | "long_term" | "none";

export interface ConversationWorkflowSettings {
  conversationId: string;
  workflowId: string;
  knowledgeScope: ConversationKnowledgeScope;
  memoryPolicy: ConversationMemoryPolicy;
  updatedAt: number;
}

export const CONVERSATION_WORKFLOW_SETTINGS_KEY =
  "sl_conversation_workflow_settings_v1";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "getItem" | "setItem">;

function isKnowledgeScope(value: unknown): value is ConversationKnowledgeScope {
  return value === "course" || value === "personal" || value === "all";
}

function isMemoryPolicy(value: unknown): value is ConversationMemoryPolicy {
  return value === "session" || value === "long_term" || value === "none";
}

function normalizeSettings(
  value: unknown,
  conversationId: string,
): ConversationWorkflowSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConversationWorkflowSettings>;
  if (
    candidate.conversationId !== conversationId ||
    typeof candidate.workflowId !== "string" ||
    !isKnowledgeScope(candidate.knowledgeScope) ||
    !isMemoryPolicy(candidate.memoryPolicy)
  ) {
    return null;
  }
  return {
    conversationId,
    workflowId: candidate.workflowId,
    knowledgeScope: candidate.knowledgeScope,
    memoryPolicy: candidate.memoryPolicy,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
  };
}

export function loadConversationWorkflowSettings(
  storage: ReadStorage | undefined,
  conversationId: string,
): ConversationWorkflowSettings | null {
  if (!storage || !conversationId) return null;
  try {
    const raw = storage.getItem(CONVERSATION_WORKFLOW_SETTINGS_KEY);
    if (!raw) return null;
    const records = JSON.parse(raw) as unknown;
    if (!records || typeof records !== "object") return null;
    return normalizeSettings(
      (records as Record<string, unknown>)[conversationId],
      conversationId,
    );
  } catch {
    return null;
  }
}

export function saveConversationWorkflowSettings(
  storage: WriteStorage | undefined,
  input: Omit<ConversationWorkflowSettings, "updatedAt">,
): ConversationWorkflowSettings {
  const next: ConversationWorkflowSettings = {
    ...input,
    updatedAt: Date.now(),
  };
  if (!storage) return next;
  let records: Record<string, unknown> = {};
  try {
    const raw = storage.getItem(CONVERSATION_WORKFLOW_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      records = parsed as Record<string, unknown>;
    }
  } catch {
    records = {};
  }
  storage.setItem(
    CONVERSATION_WORKFLOW_SETTINGS_KEY,
    JSON.stringify({ ...records, [input.conversationId]: next }),
  );
  return next;
}
