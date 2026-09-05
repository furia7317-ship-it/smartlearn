import { inferResourceTitle, type ConversationKind } from "./conversation-sessions.ts";
import type { StoredConversationState, StoredConversationSession } from "./conversation-store";
import type { TeacherPersona } from "./teacher-persona";
import type { ChatMessage } from "./types";

type ConversationSession = StoredConversationSession;

export function normalizeStoredMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    let next = message;
    if (
      message.role === "assistant" &&
      message.kind === "text" &&
      message.content.startsWith("本轮协同完成：生成")
    ) {
      next = {
        ...message,
        content: message.content
          .replace("本轮协同完成：", "生成资料已更新到学习路径和资源中心：")
          .replace(
            "右侧「协同」页有完整事件流，继续追问可进入即时辅导。",
            "你可以去「学习路径」按每天任务学习，或在「资源中心」查看具体资料。"
          ),
      };
    }
    if (
      message.role === "assistant" &&
      message.kind === "text" &&
      /error code:\s*402/i.test(message.content) &&
      /insufficient balance/i.test(message.content)
    ) {
      next = {
        ...message,
        content: "模型服务额度不足，当前无法完成需要模型推理的问答。请补充额度后重试。",
      };
    }
    return {
      ...next,
      streaming: false,
      reasoning: undefined,
      trace: undefined,
    };
  }).filter(
    (message) =>
      message.kind !== "text" ||
      message.content.trim().length > 0 ||
      Boolean(message.runId || message.planId),
  );
}

export function conversationTitle(
  messages: ChatMessage[],
  kind: ConversationKind = "general",
  resourceTitle = "",
): string {
  if (kind === "resource_qa") {
    const title = resourceTitle.trim() || inferResourceTitle(messages) || "学习资料";
    return `资料问答 · ${title}`;
  }
  const title = messages.find((message) => message.role === "user")?.content.trim();
  if (!title) return "新会话";
  return title.length > 26 ? `${title.slice(0, 26)}…` : title;
}

export function createConversationId(): string {
  return `conversation_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertConversation(
  history: ConversationSession[],
  session: ConversationSession,
): ConversationSession[] {
  return [session, ...history.filter((item) => item.id !== session.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);
}

export function buildConversationStateSnapshot({
  messages,
  conversationHistory,
  activeConversationId,
  activeConversationTitle,
  activeConversationUpdatedAt,
  activeTeacher,
  activeConversationKind,
  activeResourceId,
  activeResourceTitle,
  activeResourceContext,
}: {
  messages: ChatMessage[];
  conversationHistory: ConversationSession[];
  activeConversationId: string;
  activeConversationTitle: string;
  activeConversationUpdatedAt: number;
  activeTeacher: TeacherPersona;
  activeConversationKind: ConversationKind;
  activeResourceId: string;
  activeResourceTitle: string;
  activeResourceContext: string;
}): StoredConversationState {
  const active: ConversationSession = {
    id: activeConversationId,
    title:
      activeConversationTitle.trim() ||
      conversationTitle(messages, activeConversationKind, activeResourceTitle),
    updatedAt: activeConversationUpdatedAt,
    messages: normalizeStoredMessages(messages),
    teacher: activeTeacher,
    kind: activeConversationKind,
    resourceId: activeResourceId,
    resourceTitle: activeResourceTitle,
    resourceContext: activeResourceContext,
  };
  return {
    activeConversationId,
    sessions: [active, ...conversationHistory.filter((session) => session.id !== activeConversationId)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100),
  };
}
