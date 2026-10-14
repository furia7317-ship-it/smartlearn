"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { appendTrainingRun, mergeTrainingState, parseTrainingState, serializeTrainingState, trainingStorageKey, updateTrainingDraft, TRAINING_TASKS, type TrainingRun, type TrainingState, type TrainingTask } from "@/lib/training";
import { useTrainingArchive } from "@/hooks/use-training-archive";
import { loadTrainingTasks } from "@/lib/training-api";
import type { CodeLanguage } from "@/lib/code-languages";

interface TrainingContextValue {
  state: TrainingState;
  ready: boolean;
  storageError: string;
  syncStatus: string;
  saveDraft: (taskId: string, code: string, language?: CodeLanguage, stdin?: string) => void;
  saveRun: (run: TrainingRun) => void;
  tasks: TrainingTask[];
  tasksError: string;
  refreshTasks: () => void;
  addTask: (task: TrainingTask) => void;
}

const TrainingContext = createContext<TrainingContextValue | null>(null);

export function TrainingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const key = user ? trainingStorageKey(user.id) : null;
  const [state, setState] = useState<TrainingState>({});
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const current = useRef<TrainingState>({});
  const [generatedTasks, setGeneratedTasks] = useState<TrainingTask[]>([]);
  const [tasksError, setTasksError] = useState("");
  const [tasksLoadedKey, setTasksLoadedKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setGeneratedTasks([]);
    setTasksLoadedKey(null);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setTasksError("");
    loadTrainingTasks(controller.signal).then((tasks) => {
      if (active && !controller.signal.aborted) setGeneratedTasks((previous) => {
        const merged = new Map(previous.map((task) => [task.id, task]));
        tasks.forEach((task) => merged.set(task.id, task));
        return [...merged.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      });
    }).catch((error: unknown) => {
      if (!active) return;
      setTasksError(error instanceof Error && error.name !== "AbortError" ? error.message : "路径实训加载超时，请重试。");
    }).finally(() => { window.clearTimeout(timeout); if (active) setTasksLoadedKey(key); });
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [key, revision]);

  const addTask = useCallback((task: TrainingTask) => {
    setGeneratedTasks((previous) => [task, ...previous.filter((item) => item.id !== task.id)]);
  }, []);
  const refreshTasks = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    current.current = {};
    setState({});
    setStorageError("");
    if (!key) return;
    const read = () => {
      try {
        current.current = parseTrainingState(window.localStorage.getItem(key));
        setState(current.current);
      } catch {
        setStorageError("本机存储暂不可用，请留意学习档案同步状态；同步未完成时可下载代码留存。");
      }
      setLoadedKey(key);
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  const update = useCallback((mutate: (previous: TrainingState) => TrainingState) => {
    if (!key || loadedKey !== key) return;
    // Read before writing so another tab's different task is preserved.
    let base = current.current;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && !storageError) base = parseTrainingState(stored);
    } catch { /* Keep the in-memory draft when storage is unavailable. */ }
    const next = mutate(base);
    current.current = next;
    setState(next);
    try {
      window.localStorage.setItem(key, serializeTrainingState(next));
      setStorageError("");
    } catch {
      setStorageError("本机存储未能保存，请留意学习档案同步状态；同步未完成时可下载代码留存。");
    }
  }, [key, loadedKey, storageError]);

  const saveDraft = useCallback((taskId: string, code: string, language?: CodeLanguage, stdin?: string) => {
    update((previous) => updateTrainingDraft(previous, taskId, code, new Date().toISOString(), language, stdin));
  }, [update]);
  const saveRun = useCallback((run: TrainingRun) => {
    update((previous) => appendTrainingRun(previous, run));
  }, [update]);

  const receiveArchive = useCallback((remote: TrainingState) => {
    update((previous) => mergeTrainingState(previous, remote));
  }, [update]);
  const syncStatus = useTrainingArchive(user?.id, Boolean(key && loadedKey === key), state, receiveArchive);

  return <TrainingContext.Provider value={{ state: loadedKey === key ? state : {}, ready: Boolean(key && loadedKey === key && tasksLoadedKey === key), storageError, syncStatus, saveDraft, saveRun, tasks: [...(tasksLoadedKey === key ? generatedTasks : []), ...TRAINING_TASKS], tasksError, refreshTasks, addTask }}>{children}</TrainingContext.Provider>;
}

export function useTraining() {
  const value = useContext(TrainingContext);
  if (!value) throw new Error("TrainingProvider is required");
  return value;
}
