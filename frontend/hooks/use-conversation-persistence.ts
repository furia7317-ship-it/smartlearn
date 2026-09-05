"use client";

import { useEffect, useRef } from "react";
import { getConversationSync, type StoredConversationState } from "@/lib/conversation-store";

/** UI snapshots are staged synchronously after each committed change. Network
 * writes are debounced and retried independently of streaming/agent lifetimes. */
export function useConversationPersistence(
  enabled: boolean,
  state: StoredConversationState,
  onSaved: (state: StoredConversationState, aliases: Record<string, string>) => void,
  connected = true,
) {
  const current = useRef({ enabled, connected, state, onSaved });
  const busy = useRef(false);
  const saved = useRef<StoredConversationState | null>(null);

  useEffect(() => {
    current.current = { enabled, connected, state, onSaved };
    if (enabled) getConversationSync().stage(state);
  }, [enabled, connected, state, onSaved]);

  useEffect(() => {
    async function flush() {
      const snapshot = current.current;
      if (!snapshot.enabled || !snapshot.connected || busy.current || saved.current === snapshot.state) return;
      busy.current = true;
      const client = getConversationSync();
      try {
        const result = await client.save(snapshot.state);
        saved.current = snapshot.state;
        if (client === getConversationSync()) snapshot.onSaved(result, client.getAliases());
      } catch {
        // The controller keeps the outbox and exposes the failure to the UI.
      } finally {
        busy.current = false;
      }
    }
    const timer = window.setTimeout(() => void flush(), 500);
    const retry = window.setInterval(() => void flush(), 5000);
    const requestFlush = () => { void flush(); };
    window.addEventListener("online", requestFlush);
    window.addEventListener("pagehide", requestFlush);
    window.addEventListener("conversation-sync-retry", requestFlush);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(retry);
      window.removeEventListener("online", requestFlush);
      window.removeEventListener("pagehide", requestFlush);
      window.removeEventListener("conversation-sync-retry", requestFlush);
    };
  }, [enabled, connected, state]);
}
