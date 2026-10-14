"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { requireOk } from "@/lib/api-error";
import { parseTrainingState, serializeTrainingState, type TrainingState } from "@/lib/training";

export function useTrainingArchive(owner: string | undefined, ready: boolean, state: TrainingState, receive: (remote: TrainingState) => void) {
  const [status, setStatus] = useState("正在同步学习档案…");
  const receiveRef = useRef(receive);
  const schedule = useRef<((value: TrainingState) => void) | null>(null);
  const stateRef = useRef(state);
  useEffect(() => { receiveRef.current = receive; stateRef.current = state; }, [receive, state]);

  useEffect(() => {
    if (!owner || !ready) return;
    let active = true;
    let pending = "";
    let saved = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initialized = false;
    const url = `${API_BASE}/api/learning-data/training-archive`;
    const send = async () => {
      if (!pending || pending === saved) return;
      const body = pending;
      try {
        await requireOk(await fetch(url, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(20000) }));
        // A late response for an older draft must not claim the new draft is saved.
        if (pending === body) { saved = body; if (active) setStatus("已同步到学习档案"); }
      } catch { if (active) setStatus("学习档案同步未完成，将自动重试；本机草稿仍保留"); }
    };
    schedule.current = (value) => {
      try { pending = JSON.stringify({ student_id: owner, state: JSON.parse(serializeTrainingState(value)) }); }
      catch { setStatus("实训记录超过同步容量，请先导出代码"); return; }
      if (!initialized || pending === saved) return;
      setStatus("正在同步学习档案…");
      clearTimeout(timer);
      timer = setTimeout(() => { void send(); }, 750);
    };
    setStatus("正在同步学习档案…");
    void (async () => {
      try {
        const response = await requireOk(await fetch(url, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) }));
        const data = await response.json();
        if (active) receiveRef.current(parseTrainingState(JSON.stringify(data.state ?? {})));
      } catch { if (active) setStatus("学习档案暂未读取，先使用本机记录"); }
      finally {
        if (active) { initialized = true; schedule.current?.(stateRef.current); }
      }
    })();
    const retry = window.setInterval(() => { if (initialized) void send(); }, 30000);
    return () => {
      active = false; schedule.current = null;
      clearTimeout(timer); window.clearInterval(retry);
      // SPA navigation flushes the last edit. The owner in the payload prevents
      // an account switch from saving the previous learner's data to a new account.
      if (initialized) void send();
    };
  }, [owner, ready]);

  useEffect(() => { if (ready) schedule.current?.(state); }, [state, ready]);
  return status;
}
