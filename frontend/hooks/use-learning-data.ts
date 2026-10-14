"use client";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { readLearningData, type LearningDataStatus } from "@/lib/learning-data";

export function useLearningData(enabled: boolean) {
  const { user } = useAuth();
  const owner = user?.id;
  const [value, setValue] = useState<{ owner: string; data: LearningDataStatus } | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!enabled || !owner) return;
    let active = true;
    let request: AbortController | null = null;
    const read = async () => {
      if (request) return;
      const controller = new AbortController(); request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      try {
        const data = await readLearningData(controller.signal);
        if (active) { setValue((previous) => previous?.owner === owner && previous.data.revision > data.revision ? previous : { owner, data }); setError(""); }
      } catch { if (active) setError("学情摘要暂未同步，稍后会自动重试。"); }
      finally { window.clearTimeout(timeout); request = null; }
    };
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void read(); }, 60000);
    const focus = () => { void read(); };
    window.addEventListener("focus", focus);
    return () => { active = false; request?.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [enabled, owner]);
  const refresh = useCallback(async () => {
    if (!owner || refreshing || !enabled) return;
    setRefreshing(true);
    try { const data = await readLearningData(AbortSignal.timeout(30000), true); setValue({ owner, data }); setError(""); }
    catch { setError("本次整理未完成，请稍后重试。"); }
    finally { setRefreshing(false); }
  }, [owner, refreshing, enabled]);
  return { data: enabled && value && value.owner === user?.id ? value.data : null, error: enabled ? error : "", refreshing, refresh };
}
