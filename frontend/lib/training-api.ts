import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import type { CodeExercise } from "./code-lab";
import { exerciseToTrainingTask } from "./training-generation";
import type { TrainingKind, TrainingSource } from "./training";

export async function loadTrainingTasks(signal: AbortSignal) {
  const response = await requireOk(await fetch(`${API_BASE}/api/training`, { credentials: "include", cache: "no-store", signal }));
  const body = await response.json() as CodeExercise[];
  if (!Array.isArray(body)) throw new Error("任务库返回的数据无法识别");
  return body.map(exerciseToTrainingTask);
}

export async function generateTrainingTask(input: { learning_date: string; learning_context: string; exercise_kind: TrainingKind; source: TrainingSource }, signal: AbortSignal) {
  const response = await requireOk(await fetch(`${API_BASE}/api/training`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal,
  }));
  return exerciseToTrainingTask(await response.json() as CodeExercise);
}
