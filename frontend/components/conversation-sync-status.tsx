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
      className="flex shrink-0 items-center gap-2 border-b border-[#ddceb8] bg-[#faf0df] px-3 py-2 text-xs leading-5 text-[#6b4c2e]">
      <span>{status.message}</span>
      {status.phase === "error" && (
        <button type="button" className="shrink-0 rounded border border-[#cbb89b] px-2 py-1 transition-colors hover:bg-[#eddfc6]" onClick={() => window.dispatchEvent(new Event("conversation-sync-retry"))}>
          重试保存
        </button>
      )}
    </div>
  );
}
