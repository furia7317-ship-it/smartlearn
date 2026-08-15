export type ConversationKind = "general" | "resource_qa";

export interface ConversationMessageLike {
  role: string;
  kind?: string;
  content: string;
}

export interface ResourceConversationMetadata {
  resourceId: string;
  resourceTitle: string;
  resourceContext: string;
}

const RESOURCE_TITLE_PATTERNS = [
  /我(?:正在学习|在学习)资料「([^」]+)」/,
  /我在资料「([^」]+)」/,
  /请结合下面这份「([^」]+)」/,
  /请讲解课件「([^」]+)」/,
];

export function resourceTitleFromQuestion(content: string): string {
  for (const pattern of RESOURCE_TITLE_PATTERNS) {
    const title = content.match(pattern)?.[1]?.trim();
    if (title) return title;
  }
  return "";
}

export function isResourceQuestionMessage(message: ConversationMessageLike): boolean {
  return message.role === "user" && Boolean(resourceTitleFromQuestion(message.content));
}

export function inferConversationKind(
  messages: ConversationMessageLike[],
  storedKind?: string,
): ConversationKind {
  if (storedKind === "resource_qa") return "resource_qa";
  return messages.some(isResourceQuestionMessage) ? "resource_qa" : "general";
}

export function inferResourceTitle(messages: ConversationMessageLike[]): string {
  const resourceQuestion = messages.find(isResourceQuestionMessage);
  return resourceQuestion ? resourceTitleFromQuestion(resourceQuestion.content) : "";
}

export function splitLegacyResourceConversation<T extends ConversationMessageLike>(
  messages: T[],
): { generalMessages: T[]; resourceMessages: T[]; resourceTitle: string } | null {
  const resourceStart = messages.findIndex(isResourceQuestionMessage);
  if (resourceStart <= 0) return null;

  const resourceMessages = messages.slice(resourceStart);
  return {
    generalMessages: messages.slice(0, resourceStart),
    resourceMessages,
    resourceTitle: inferResourceTitle(resourceMessages),
  };
}
