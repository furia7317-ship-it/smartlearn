"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { API_BASE } from "@/lib/api";
import { requireOk } from "@/lib/api-error";
import { normalizeTrainingEvidence, TRAINING_EVIDENCE_CHANGED, type TrainingEvidence } from "@/lib/training-evidence";
const EMPTY_EVIDENCE: TrainingEvidence[] = [];

export function useTrainingEvidence(enabled: boolean) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<{ owner: string; rows: TrainingEvidence[] }>({ owner: "", rows: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !user?.id) return;
    let active = true;
    let pending: AbortController | null = null;
    const refresh = async () => {
      pending?.abort();
      const controller = new AbortController(); pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await requireOk(await fetch(`${API_BASE}/api/training/evidence`, { credentials: "include", cache: "no-store", signal: controller.signal }));
        const rows = normalizeTrainingEvidence(await response.json());
        if (active && !controller.signal.aborted) { setSnapshot({ owner: user.id, rows }); setError(""); }
      } catch {
        if (active && pending === controller) setError("实训成绩暂未同步，请稍后重试。");
      } finally { window.clearTimeout(timeout); }
    };
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener(TRAINING_EVIDENCE_CHANGED, update);
    window.addEventListener("focus", update);
    return () => { active = false; pending?.abort(); window.removeEventListener(TRAINING_EVIDENCE_CHANGED, update); window.removeEventListener("focus", update); };
  }, [enabled, user?.id]);
  return { evidence: enabled && snapshot.owner === user?.id ? snapshot.rows : EMPTY_EVIDENCE, error: enabled ? error : "" };
}
