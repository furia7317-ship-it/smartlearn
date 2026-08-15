import { normalizePathSteps } from "./path-normalize.ts";
import {
  createResourcePhaseState,
  reduceResourceExecutionEvent,
} from "./resource-phase-reducer.ts";
import { planResourceId } from "./resource-plan-identity.ts";
import type { ResourcePlanRecord } from "./resource-plan.ts";
import type {
  PathStep,
  PathTask,
  ResourceData,
  ResourceItem,
  ResourcePhaseId,
  ResourcePhaseState,
  ResourceStatus,
  ResourceType,
} from "./types.ts";

const RESOURCE_TYPES = new Set<ResourceType>([
  "explainer",
  "mindmap",
  "quiz",
  "solution",
  "reading",
  "code",
  "video",
  "courseware",
  "interactive",
]);

const TERMINAL_PLAN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PRE_EXECUTION_PLAN_STATUSES = new Set(["draft", "awaiting_confirmation"]);

export interface ResourcePlanRecoveryContext {
  taskOwnerCounts?: ReadonlyMap<string, number>;
}

export function resourcePlanTaskOwnerCounts(
  records: readonly ResourcePlanRecord[],
): Map<string, number> {
  const taskIdsByPlan = new Map<string, Set<string>>();
  for (const record of records) {
    taskIdsByPlan.set(
      record.plan.plan_id,
      new Set(record.plan.tasks.map((task) => task.task_id)),
    );
  }
  const counts = new Map<string, number>();
  for (const taskIds of taskIdsByPlan.values()) {
    for (const taskId of taskIds) {
      counts.set(taskId, (counts.get(taskId) ?? 0) + 1);
    }
  }
  return counts;
}

export function metaFromResourceData(data: Record<string, unknown>): string[] {
  const meta: string[] = [];
  const count = (key: string) => (Array.isArray(data[key]) ? data[key].length : 0);
  if (count("questions")) meta.push(`${count("questions")} 题`);
  if (count("key_points")) meta.push(`${count("key_points")} 个要点`);
  if (count("scenes")) meta.push(`${count("scenes")} 个章节内容`);
  if (count("articles")) meta.push(`${count("articles")} 篇`);
  if (count("nodes")) meta.push(`${count("nodes")} 节点`);
  if (count("slides")) meta.push(`${count("slides")} 页`);
  if (count("interactions")) meta.push(`${count("interactions")} 个交互点`);
  if (typeof data.language === "string") meta.push(data.language);
  return meta.slice(0, 3);
}

export function scheduleSnapshotToPath(schedule: unknown[], planId?: string): PathStep[] {
  const mapped = schedule.map((value, index) => {
    const day = (value ?? {}) as Record<string, unknown>;
    const rawSteps = Array.isArray(day.steps) ? day.steps : [];
    const steps = rawSteps.map((raw) => {
      const step = (raw ?? {}) as Record<string, unknown>;
      const stepId = String(step.id ?? "");
      const title = String(step.title ?? "学习任务");
      const resourceTypes = Array.isArray(step.resource_types)
        ? step.resource_types
            .map(String)
            .filter((type): type is ResourceType => RESOURCE_TYPES.has(type as ResourceType))
        : [];
      const mappedResources = Array.isArray(step.resources)
        ? step.resources.map((resource) => {
            const item = (resource ?? {}) as Record<string, unknown>;
            const taskId = String(item.id ?? "");
            return {
              id: planId && taskId ? planResourceId(planId, taskId) : taskId,
              type: String(item.type ?? "explainer") as ResourceType,
              title: String(item.title ?? "学习资料"),
            };
          })
        : [];
      const resources =
        mappedResources.length > 0
          ? mappedResources
          : planId && stepId && resourceTypes.length > 0
            ? [{ id: planResourceId(planId, stepId), type: resourceTypes[0], title }]
            : [];
      const kind: PathTask["kind"] =
        step.type === "resource" ||
        step.type === "study" ||
        step.type === "practice" ||
        step.type === "review"
          ? step.type
          : undefined;
      const completionKind: PathTask["completion_kind"] =
        step.completion_kind === "resource_read" ||
        step.completion_kind === "quiz_submission" ||
        step.completion_kind === "written_response"
          ? step.completion_kind
          : undefined;
      return {
        title,
        detail: String(step.detail ?? ""),
        minutes: Number(step.minutes ?? 10),
        resource_types: resourceTypes,
        resources,
        kind,
        prompts: Array.isArray(step.prompts)
          ? step.prompts.map(String).map((prompt) => prompt.trim()).filter(Boolean).slice(0, 3)
          : [],
        completion_kind: completionKind,
      };
    });
    return {
      day: String(day.day ?? `D${index + 1}`),
      title: String(day.title ?? `第 ${index + 1} 天`),
      desc: String(day.objective ?? "按规划完成当天学习任务"),
      objective: String(day.objective ?? ""),
      minutes: Number(day.minutes ?? 60),
      types: Array.from(new Set(steps.flatMap((step) => step.resource_types))),
      state: index === 0 ? ("current" as const) : ("todo" as const),
      steps,
    };
  });
  return normalizePathSteps(mapped);
}

/**
 * Recover a usable learning path from the durable plan when an older backend
 * completed every resource but failed to persist the integration schedule.
 */
export function resourcePlanRecordToPath(record: ResourcePlanRecord): PathStep[] {
  const scheduled = scheduleSnapshotToPath(
    record.execution.schedule ?? [],
    record.plan.plan_id,
  );
  if (scheduled.length > 0) return scheduled;
  if (record.plan.days.length === 0 || record.plan.status === "cancelled") return [];

  const tasksById = new Map(
    record.plan.tasks.map((task) => [task.task_id, task]),
  );
  const recoveredSchedule = record.plan.days.map((day) => {
    const tasks = day.task_ids
      .map((taskId) => tasksById.get(taskId))
      .filter((task): task is NonNullable<typeof task> => Boolean(task));
    const taskMinutes = Math.max(
      1,
      Math.round(Math.max(1, day.minutes) / Math.max(1, tasks.length)),
    );
    return {
      day: day.day,
      title: day.title,
      objective: day.objective,
      minutes: day.minutes,
      steps: tasks.map((task) => ({
        id: task.task_id,
        type: task.type === "quiz" ? "practice" : "study",
        title: task.title,
        detail: task.outline.objective || day.objective,
        minutes: taskMinutes,
        resource_types: [task.type],
        resources: [{
          id: task.task_id,
          type: task.type,
          title: task.title,
        }],
        completion_kind: task.type === "quiz"
          ? "quiz_submission"
          : "resource_read",
      })),
    };
  });
  return scheduleSnapshotToPath(recoveredSchedule, record.plan.plan_id);
}

function resourceStatus(
  review: Record<string, unknown> | undefined,
  progress: Record<string, unknown> | undefined,
): ResourceStatus {
  if (progress?.status === "rework") return "rejected";
  if (!review) return "review";
  if (review.approved) return "ready";
  return review.terminal === true ? "failed" : "rejected";
}

function recoverPhaseState(record: ResourcePlanRecord): ResourcePhaseState {
  const preExecution = PRE_EXECUTION_PLAN_STATUSES.has(record.plan.status);
  let state = reduceResourceExecutionEvent(createResourcePhaseState(), {
    event: "plan_ready",
    task_total: record.plan.tasks.length,
    auto_execute: preExecution ? false : record.plan.complexity.auto_execute,
  });
  if (preExecution) return state;
  const reviews = record.execution.reviews ?? {};
  for (const task of record.plan.tasks) {
    const progress = record.execution.task_progress?.[task.task_id];
    if (progress) {
      state = reduceResourceExecutionEvent(state, {
        event: "task_progress",
        task_id: task.task_id,
        title: task.title,
        agent: task.agent,
        ...progress,
      });
    }
    const review = reviews[task.task_id] ?? task.review;
    if (review) {
      state = reduceResourceExecutionEvent(state, {
        event: "task_review",
        task_id: task.task_id,
        ...review,
      });
    }
  }
  if (record.plan.status === "completed") {
    for (const phase of [
      "understanding",
      "planning",
      "generation",
      "review",
      "integration",
      "delivery",
    ] as ResourcePhaseId[]) {
      state = reduceResourceExecutionEvent(state, {
        event: "phase",
        phase,
        status: "completed",
        progress: 100,
      });
    }
  } else if (record.plan.status === "failed") {
    for (const phase of ["understanding", "planning", "generation"] as ResourcePhaseId[]) {
      state = reduceResourceExecutionEvent(state, {
        event: "phase",
        phase,
        status: "completed",
        progress: 100,
      });
    }
    state = reduceResourceExecutionEvent(state, {
      event: "phase",
      phase: "review",
      status: "error",
      progress: 100,
      detail: "部分资料未通过质量审核",
    });
    state = reduceResourceExecutionEvent(state, {
      event: "phase",
      phase: "integration",
      status: (record.execution.schedule ?? []).length > 0 ? "completed" : "error",
      progress: 100,
      detail:
        (record.execution.schedule ?? []).length > 0
          ? "已整合审核通过的资料"
          : "没有可交付的审核通过资料",
    });
    state = reduceResourceExecutionEvent(state, {
      event: "phase",
      phase: "delivery",
      status: "error",
      progress: 100,
      detail: "本轮未形成完整交付，系统已保留诊断记录",
    });
  } else if (record.plan.status === "cancelled") {
    for (const phase of ["understanding", "planning"] as ResourcePhaseId[]) {
      state = reduceResourceExecutionEvent(state, {
        event: "phase",
        phase,
        status: "completed",
        progress: 100,
        detail: "计划已取消",
      });
    }
    for (const phase of ["generation", "review", "integration", "delivery"] as ResourcePhaseId[]) {
      state = reduceResourceExecutionEvent(state, {
        event: "phase",
        phase,
        status: "error",
        progress: 100,
        detail: "计划已取消",
      });
    }
  }
  return state;
}

export function recoverResourcePlanRecord(
  record: ResourcePlanRecord,
  previous: ResourceItem[],
  context: ResourcePlanRecoveryContext = {},
): { resources: ResourceItem[]; path: PathStep[]; execution: ResourcePhaseState } {
  const planId = record.plan.plan_id;
  const rawTaskIds = new Set(record.plan.tasks.map((task) => task.task_id));
  if (PRE_EXECUTION_PLAN_STATUSES.has(record.plan.status)) {
    const planResourcePrefix = `${planId}:`;
    const resources = previous.filter((item) => {
      if (item.status !== "pending" && item.status !== "review") return true;
      const explicitlyOwned =
        item.id.startsWith(planResourcePrefix) || item.data?.plan_id === planId;
      return !explicitlyOwned;
    });
    return {
      resources,
      path: scheduleSnapshotToPath(record.execution.schedule ?? [], planId),
      execution: recoverPhaseState(record),
    };
  }
  const migratedLegacyById = new Map<string, ResourceItem>();
  const byId = new Map<string, ResourceItem>();
  for (const item of previous) {
    const itemPlanId =
      typeof item.data?.plan_id === "string" ? item.data.plan_id : undefined;
    const explicitlyOwned = itemPlanId === planId;
    const ownerCount = context.taskOwnerCounts?.get(item.id) ?? 1;
    const ownerlessPlaceholder =
      itemPlanId === undefined &&
      ownerCount <= 1 &&
      (item.status === "pending" || item.status === "review");
    if (
      rawTaskIds.has(item.id) &&
      (explicitlyOwned || ownerlessPlaceholder)
    ) {
      migratedLegacyById.set(planResourceId(planId, item.id), item);
      continue;
    }
    byId.set(item.id, item);
  }
  const taskById = new Map(
    record.plan.tasks.map((task) => [planResourceId(planId, task.task_id), task]),
  );
  const reviews = record.execution.reviews ?? {};
  const taskProgress = record.execution.task_progress ?? {};
  const terminal = TERMINAL_PLAN_STATUSES.has(record.plan.status);
  const resourcesByTaskId = new Map<string, Record<string, unknown>>();
  for (const raw of record.execution.resources ?? []) {
    const taskId = String(raw.task_id ?? raw.id ?? "");
    const resourceId = planResourceId(planId, taskId);
    if (!taskId || !taskById.has(resourceId)) continue;
    resourcesByTaskId.set(resourceId, raw);
  }
  for (const task of record.plan.tasks) {
    const taskId = task.task_id;
    const resourceId = planResourceId(planId, taskId);
    const raw = resourcesByTaskId.get(resourceId);
    const review = reviews[taskId] ?? (task?.review as unknown as Record<string, unknown> | undefined);
    const progress = taskProgress[taskId] as Record<string, unknown> | undefined;
    const existing = byId.get(resourceId) ?? migratedLegacyById.get(resourceId);
    const type = String(raw?.type ?? task.type ?? existing?.type ?? "explainer") as ResourceType;
    const issues = Array.isArray(review?.issues)
      ? review.issues.map(String).filter(Boolean).join("；")
      : "";
    const status: ResourceStatus = terminal
      ? review?.approved === true
        ? "ready"
        : "failed"
      : raw
        ? resourceStatus(review, progress)
        : existing?.status ?? "pending";
    const subtitle = review?.approved
      ? "质量审核通过"
      : issues
        ? status === "rejected"
          ? `正在根据审核意见返工：${issues}`
          : issues
        : terminal
          ? "任务未产生可审核资料"
          : raw
            ? String(raw.overview ?? raw.summary ?? existing?.subtitle ?? "已生成，等待审核")
            : existing?.subtitle ?? "等待按已确认大纲生成…";
    byId.set(resourceId, {
      id: resourceId,
      type,
      title: String(raw?.title ?? task.title ?? existing?.title ?? "学习资料"),
      subtitle,
      meta: raw ? metaFromResourceData(raw) : existing?.meta ?? task.knowledge_points.slice(0, 3),
      status,
      version: raw
        ? Math.max(existing?.version ?? 1, Number(raw.retry_count ?? task.retry_count ?? 0) + 1)
        : existing?.version ?? Math.max(1, Number(task.retry_count ?? 0) + 1),
      sources: Array.isArray(raw?.sources)
        ? raw.sources.length
        : existing?.sources ?? task.source_ids.length,
      data: raw ? (raw as ResourceData) : existing?.data,
    });
  }
  return {
    resources: Array.from(byId.values()),
    path: scheduleSnapshotToPath(record.execution.schedule ?? [], planId),
    execution: recoverPhaseState(record),
  };
}
