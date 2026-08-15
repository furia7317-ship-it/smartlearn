"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LEARNER_PREFERENCES,
  getLearnerPreferences,
  onLearnerPreferencesChanged,
  saveLearnerPreferences,
  type LearnerPreferences,
} from "@/lib/learner-preferences";

export function useLearnerPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_LEARNER_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const currentRef = useRef(DEFAULT_LEARNER_PREFERENCES);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await getLearnerPreferences();
      currentRef.current = loaded;
      setPreferences(loaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取个性化设置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onLearnerPreferencesChanged((next) => {
      currentRef.current = next;
      setPreferences(next);
      setError("");
    });
  }, [refresh]);

  const updatePreferences = useCallback(async (patch: Partial<LearnerPreferences>) => {
    if (savingRef.current) return false;
    const previous = currentRef.current;
    const next = { ...previous, ...patch };
    savingRef.current = true;
    currentRef.current = next;
    setPreferences(next);
    setSaving(true);
    setError("");
    try {
      const saved = await saveLearnerPreferences(next);
      currentRef.current = saved;
      setPreferences(saved);
      return true;
    } catch (cause) {
      currentRef.current = previous;
      setPreferences(previous);
      setError(cause instanceof Error ? cause.message : "保存个性化设置失败");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  return { preferences, loading, saving, error, refresh, updatePreferences };
}
