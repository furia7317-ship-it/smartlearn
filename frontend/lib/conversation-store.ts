import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import type { ConversationKind } from "./conversation-sessions";
import { getStudentId } from "./student-identity";
import type { TeacherPersona } from "./teacher-persona";
import type { ChatMessage } from "./types";
import { ConversationSyncController, type ConversationMutation, type ConversationOutbox } from "./conversation-sync";

export interface StoredConversationSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  teacher: TeacherPersona;
  kind: ConversationKind;
  resourceId: string;
  resourceTitle: string;
  resourceContext: string;
}

export interface StoredConversationState {
  revision?: number;
  activeConversationId: string;
  sessions: StoredConversationSession[];
}

interface ConversationStateResponse {
  revision?: unknown;
  active_conversation_id?: unknown;
  sessions?: unknown;
}

function normalizeSession(value: unknown): StoredConversationSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== "string" || !Array.isArray(session.messages)) return null;
  return {
    id: session.id,
    title: typeof session.title === "string" ? session.title : "新会话",
    updatedAt: typeof session.updated_at === "number" ? session.updated_at : 0,
    messages: session.messages as ChatMessage[],
    teacher: session.teacher === "alligator" ? "alligator" : "raccoon",
    kind: session.kind === "resource_qa" ? "resource_qa" : "general",
    resourceId: typeof session.resource_id === "string" ? session.resource_id : "",
    resourceTitle: typeof session.resource_title === "string" ? session.resource_title : "",
    resourceContext: typeof session.resource_context === "string" ? session.resource_context : "",
  };
}

async function readState(studentId: string): Promise<StoredConversationState> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/conversations/${encodeURIComponent(studentId)}`,
    { cache: "no-store", credentials: "include", signal: AbortSignal.timeout(15_000) },
  ));
  const payload = await response.json() as ConversationStateResponse;
  return normalizeState(payload);
}

function normalizeState(payload: ConversationStateResponse): StoredConversationState {
  if (typeof payload.revision !== "number") {
    throw new Error("会话服务需要更新，请重启后端后重试");
  }
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions.map(normalizeSession).filter((session): session is StoredConversationSession => Boolean(session))
    : [];
  return {
    revision: payload.revision,
    activeConversationId: typeof payload.active_conversation_id === "string"
      ? payload.active_conversation_id
      : "",
    sessions,
  };
}

async function writeState(studentId: string, state: ConversationMutation): Promise<StoredConversationState> {
  const response = await requireOk(await fetch(`${API_BASE}/api/conversations`, {
    method: "PUT",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      student_id: studentId,
      revision: state.revision,
      deleted_session_ids: state.deletedSessionIds,
      active_conversation_id: state.activeConversationId,
      sessions: state.sessions.map((session) => ({
        id: session.id,
        title: session.title,
        updated_at: session.updatedAt,
        messages: session.messages,
        teacher: session.teacher,
        kind: session.kind,
        resource_id: session.resourceId,
        resource_title: session.resourceTitle,
        resource_context: session.resourceContext,
      })),
    }),
  }));
  return normalizeState(await response.json() as ConversationStateResponse);
}

const clients = new Map<string, ConversationSyncController>();

export function getConversationSync(): ConversationSyncController {
  const studentId = getStudentId();
  const existing = clients.get(studentId);
  if (existing) return existing;
  const prefix = `sl_conversation_outbox_v1:${studentId}:`;
  let storageKey = "";
  const key = () => {
    if (!storageKey) {
      const windowId = sessionStorage.getItem("sl_conversation_window") ?? crypto.randomUUID();
      sessionStorage.setItem("sl_conversation_window", windowId);
      storageKey = `${prefix}${windowId}`;
    }
    return storageKey;
  };
  const client = new ConversationSyncController({
    read: () => readState(studentId),
    write: (state) => writeState(studentId, state),
  }, {
    read: () => {
      try {
        const value = localStorage.getItem(key());
        if (!value) return null;
        const outbox = JSON.parse(value) as ConversationOutbox;
        return Array.isArray(outbox.pending?.sessions) && Array.isArray(outbox.base?.sessions)
          && Array.isArray(outbox.accepted?.sessions) && Array.isArray(outbox.deletions)
          && outbox.aliases && typeof outbox.aliases === "object" ? outbox : null;
      } catch { return null; }
    },
    write: (value) => {
      if (value) localStorage.setItem(key(), JSON.stringify(value));
      else localStorage.removeItem(key());
    },
  });
  clients.set(studentId, client);
  return client;
}

export const getConversationState = (connected = true) => getConversationSync().load(connected);
export const saveConversationState = (state: StoredConversationState) => getConversationSync().save(state);
