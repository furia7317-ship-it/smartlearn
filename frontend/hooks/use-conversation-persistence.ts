"use client";

import { useCallback, useEffect, useRef } from "react";
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
    if (enabled && saved.current !== state) getConversationSync().stage(state);
  }, [enabled, connected, state, onSaved]);

  const flush = useCallback(async (force = false) => {
      const snapshot = current.current;
      if (!snapshot.enabled || (!snapshot.connected && !force) || busy.current || saved.current === snapshot.state) return;
      const client = getConversationSync();
      if (client.isClearing() || (!force && (client.getStatus().retryAt ?? 0) > Date.now())) return;
      busy.current = true;
      const clearVersion = client.getClearVersion();
      try {
        const result = await client.save(snapshot.state);
        saved.current = snapshot.state;
        if (client === getConversationSync() && clearVersion === client.getClearVersion() && !client.isClearing()) {
          snapshot.onSaved(result, client.getAliases());
        }
      } catch {
        // The controller keeps the outbox and exposes the failure to the UI.
      } finally {
        busy.current = false;
      }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void flush(), 500);
    return () => window.clearTimeout(timer);
  }, [enabled, connected, state, flush]);

  // Continuous answer updates must not restart the retry interval forever.
  useEffect(() => {
    const retry = window.setInterval(() => void flush(), 2000);
    const requestFlush = () => { void flush(true); };
    window.addEventListener("online", requestFlush);
    window.addEventListener("pagehide", requestFlush);
    window.addEventListener("conversation-sync-retry", requestFlush);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener("online", requestFlush);
      window.removeEventListener("pagehide", requestFlush);
      window.removeEventListener("conversation-sync-retry", requestFlush);
    };
  }, [flush]);
}
