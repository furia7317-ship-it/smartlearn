"use client";

import { useEffect, useState } from "react";
import { MessageCircleQuestion, MessageSquareText, Plus, Trash2 } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { cn } from "@/lib/utils";

type ConversationGroup = "general" | "resource_qa";

export function WebConversationSidebar() {
  const session = useOrchestratorContext();
  const [group, setGroup] = useState<ConversationGroup>(session.activeConversationKind);

  useEffect(() => setGroup(session.activeConversationKind), [session.activeConversationKind]);

  const visible = session.conversations.filter((conversation) => conversation.kind === group);
  const generalCount = session.conversations.filter((conversation) => conversation.kind === "general").length;
  const resourceCount = session.conversations.filter((conversation) => conversation.kind === "resource_qa").length;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-surface-2/35" aria-label="对话会话">
      <div className="border-b p-3">
        <button
          type="button"
          onClick={() => session.newConversation(session.activeTeacher)}
          disabled={session.conversationSwitchLocked}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          <Plus className="size-3.5" />新会话
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 border-b p-2" role="tablist" aria-label="会话分类">
        <button
          type="button"
          role="tab"
          aria-selected={group === "general"}
          onClick={() => setGroup("general")}
          className={cn("flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px]", group === "general" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60")}
        >
          <MessageSquareText className="size-3.5" />普通会话 <span>{generalCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={group === "resource_qa"}
          onClick={() => setGroup("resource_qa")}
          className={cn("flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px]", group === "resource_qa" ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60")}
        >
          <MessageCircleQuestion className="size-3.5" />资料问答 <span>{resourceCount}</span>
        </button>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {visible.length > 0 ? (
          <div className="space-y-1">
            {visible.map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "group relative rounded-lg border border-transparent",
                  conversation.active ? "border-border bg-card" : "hover:bg-card/65",
                )}
              >
                <button
                  type="button"
                  disabled={session.conversationSwitchLocked || conversation.active}
                  onClick={() => session.openConversation(conversation.id)}
                  className="w-full px-3 py-2 pr-8 text-left disabled:cursor-default"
                >
                  <span className="block truncate text-xs font-medium">{conversation.title}</span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {conversation.running
                      ? "处理中"
                      : conversation.kind === "resource_qa"
                      ? conversation.resourceTitle || "学习资料问答"
                      : new Date(conversation.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => session.deleteConversation(conversation.id)}
                  disabled={session.running}
                  aria-label={`删除会话${conversation.title}`}
                  title="删除会话"
                  className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-3 py-8 text-center text-[11px] leading-relaxed text-muted-foreground">
            {group === "general" ? "还没有普通会话" : "从学习资料发起提问后，会话会单独保存在这里"}
          </p>
        )}
      </div>
    </aside>
  );
}
