import { API_BASE, streamSSE } from "./api.ts";
import { requireOk } from "./api-error.ts";
import type {
  ResourceExecutionEvent,
  ResourcePlan,
  ResourcePlanRecord,
} from "./resource-plan.ts";
import { getStudentId } from "./student-identity.ts";
import type { LearningBaseline } from "./learning-baseline.ts";
import type { LearningPathPreferences } from "./learning-path-confirmation.ts";

async function jsonRequest(path: string, init?: RequestInit): Promise<ResourcePlanRecord> {
  const response = await requireOk(
    await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      cache: "no-store",
      credentials: "include",
    }),
  );
  return (await response.json()) as ResourcePlanRecord;
}

export async function createResourcePlan(request: {
  topic: string;
  requirements?: string;
  planning_mode?: "resource" | "learning_path";
  learning_baseline?: LearningBaseline;
  learning_path_preferences?: LearningPathPreferences;
}): Promise<ResourcePlanRecord> {
  return jsonRequest("/api/agents/resource-plans", {
    method: "POST",
    body: JSON.stringify({
      topic: request.topic,
      requirements: request.requirements ?? "",
      planning_mode: request.planning_mode ?? "resource",
      learning_baseline: request.learning_baseline,
      learning_path_preferences: request.learning_path_preferences,
      student_id: getStudentId(),
    }),
  });
}

export async function getResourcePlan(planId: string): Promise<ResourcePlanRecord> {
  const query = new URLSearchParams({ student_id: getStudentId() });
  return jsonRequest(`/api/agents/resource-plans/${encodeURIComponent(planId)}?${query}`);
}

export async function saveResourcePlan(plan: ResourcePlan): Promise<ResourcePlanRecord> {
  return jsonRequest(`/api/agents/resource-plans/${encodeURIComponent(plan.plan_id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      student_id: getStudentId(),
      version: plan.version,
      constraints: plan.constraints,
      days: plan.days,
      tasks: plan.tasks,
    }),
  });
}

export async function replanResourcePlan(
  plan: ResourcePlan,
  feedback: string,
): Promise<ResourcePlanRecord> {
  return jsonRequest(`/api/agents/resource-plans/${encodeURIComponent(plan.plan_id)}/replan`, {
    method: "POST",
    body: JSON.stringify({
      student_id: getStudentId(),
      version: plan.version,
      feedback,
    }),
  });
}

export async function cancelResourcePlan(plan: ResourcePlan): Promise<ResourcePlanRecord> {
  return jsonRequest(`/api/agents/resource-plans/${encodeURIComponent(plan.plan_id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ student_id: getStudentId(), version: plan.version }),
  });
}

export async function streamResourcePlanExecution(
  plan: ResourcePlan,
  onEvent: (event: ResourceExecutionEvent) => void,
  options?: { signal?: AbortSignal; confirm?: boolean },
): Promise<void> {
  await streamSSE(
    `/api/agents/resource-plans/${encodeURIComponent(plan.plan_id)}/execute`,
    {
      student_id: getStudentId(),
      version: plan.version,
      confirm: options?.confirm ?? false,
    },
    ({ event, data }) => onEvent({ event, ...data }),
    options?.signal,
  );
}
