"use client";

import { useSyncExternalStore } from "react";
import { getConversationSync } from "@/lib/conversation-store";
import type { ConversationSyncStatus as SyncStatus } from "@/lib/conversation-sync";

const serverStatus: SyncStatus = { phase: "idle", message: "" };

export function ConversationSyncStatus() {
  const client = getConversationSync();
  const status = useSyncExternalStore(client.subscribe, client.getStatus, () => serverStatus);
  if (!status.message) return null;
  return (
    <div role={status.phase === "error" ? "alert" : "status"}
      className="fixed bottom-4 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-xl border bg-background px-4 py-3 text-sm shadow-lg">
      <span>{status.message}</span>
      {status.phase === "error" && (
        <button className="shrink-0 underline" onClick={() => window.dispatchEvent(new Event("conversation-sync-retry"))}>
          重试保存
        </button>
      )}
    </div>
  );
}
