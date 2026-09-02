import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import type { ConversationKind } from "./conversation-sessions";
import { getStudentId } from "./student-identity";
import type { TeacherPersona } from "./teacher-persona";
import type { ChatMessage } from "./types";

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
  activeConversationId: string;
  sessions: StoredConversationSession[];
}

interface ConversationStateResponse {
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

export async function getConversationState(): Promise<StoredConversationState> {
  const studentId = getStudentId();
  const response = await requireOk(await fetch(
    `${API_BASE}/api/conversations/${encodeURIComponent(studentId)}`,
    { cache: "no-store", credentials: "include" },
  ));
  const payload = await response.json() as ConversationStateResponse;
  const sessions = Array.isArray(payload.sessions)
    ? payload.sessions.map(normalizeSession).filter((session): session is StoredConversationSession => Boolean(session))
    : [];
  return {
    activeConversationId: typeof payload.active_conversation_id === "string"
      ? payload.active_conversation_id
      : "",
    sessions,
  };
}

export async function saveConversationState(state: StoredConversationState): Promise<void> {
  await requireOk(await fetch(`${API_BASE}/api/conversations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      student_id: getStudentId(),
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
}
