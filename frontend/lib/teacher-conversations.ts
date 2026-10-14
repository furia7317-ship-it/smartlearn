import type { ConversationSummary } from "../hooks/use-orchestrator";
import type { TutorAttachment } from "./types";

export type ConversationFilter = "all" | "general" | "resource_qa";
export type ConversationDraft = { text: string; attachments: TutorAttachment[] };

export function filterTeacherConversations(
  conversations: ConversationSummary[],
  query: string,
  filter: ConversationFilter,
): ConversationSummary[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return conversations
    .filter((conversation) => {
      const text = `${conversation.title} ${conversation.resourceTitle}`.toLocaleLowerCase();
      return (filter === "all" || conversation.kind === filter) && words.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt);
}

/** Keep unsent input with its conversation, and discard drafts of deleted sessions. */
export function switchConversationDraft(
  drafts: Map<string, ConversationDraft>,
  previousId: string,
  nextId: string,
  current: ConversationDraft,
  retainedIds: Iterable<string>,
): ConversationDraft {
  const retained = new Set(retainedIds);
  if (retained.has(previousId)) drafts.set(previousId, current);
  for (const id of drafts.keys()) {
    if (!retained.has(id)) drafts.delete(id);
  }
  return drafts.get(nextId) ?? { text: "", attachments: [] };
}
