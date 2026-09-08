"use client";

import { createContext, useContext } from "react";

import { useOrchestrator } from "@/hooks/use-orchestrator";

type OrchestratorValue = ReturnType<typeof useOrchestrator>;

const OrchestratorContext = createContext<OrchestratorValue | null>(null);

/**
 * 把协同编排引擎提升到路由之上。挂在根 layout 里，页面切换时不卸载，
 * 因此对话/资源/路径等会话状态跨页面常驻；SQLite 是刷新和跨端恢复的
 * 唯一持久化事实源，浏览器只负责一次性迁移旧版本存档。
 */
export function OrchestratorProvider({ children }: { children: React.ReactNode }) {
  const value = useOrchestrator();
  return (
    <OrchestratorContext.Provider value={value}>
      {children}
    </OrchestratorContext.Provider>
  );
}

export function useOrchestratorContext(): OrchestratorValue {
  const ctx = useContext(OrchestratorContext);
  if (!ctx) {
    throw new Error("useOrchestratorContext 必须在 <OrchestratorProvider> 内使用");
  }
  return ctx;
}
