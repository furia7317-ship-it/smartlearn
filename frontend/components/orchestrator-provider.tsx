"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useOrchestrator } from "@/hooks/use-orchestrator";
import { createSelectorStore, createSelectedSnapshot } from "@/lib/selector-store";
import { ConversationSyncStatus } from "@/components/conversation-sync-status";

type OrchestratorValue = ReturnType<typeof useOrchestrator>;

type OrchestratorStore = ReturnType<typeof createSelectorStore<OrchestratorValue>>;
const OrchestratorContext = createContext<OrchestratorStore | null>(null);

/**
 * 把协同编排引擎提升到路由之上。挂在根 layout 里，页面切换时不卸载，
 * 因此对话/资源/路径等会话状态跨页面常驻；SQLite 是刷新和跨端恢复的
 * 持久化事实源；浏览器保留未同步草稿，服务恢复后再提交。
 */
export function OrchestratorProvider({ children }: { children: React.ReactNode }) {
  const value = useOrchestrator();
  const [store] = useState(() => createSelectorStore(value));
  useLayoutEffect(() => { store.set(value); }, [store, value]);
  return (
    <OrchestratorContext.Provider value={store}>
      {children}
      <ConversationSyncStatus />
    </OrchestratorContext.Provider>
  );
}

export function useOrchestratorContext<Selected = OrchestratorValue>(
  select?: (state: OrchestratorValue) => Selected,
): Selected {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) {
    throw new Error("useOrchestratorContext 必须在 <OrchestratorProvider> 内使用");
  }
  const getSnapshot = useMemo(() => createSelectedSnapshot(
    ctx.getSnapshot,
    select ?? ((state) => state as unknown as Selected),
  ), [ctx, select]);
  return useSyncExternalStore(ctx.subscribe, getSnapshot, getSnapshot);
}
