import type {
  ResourceExecutionPhase,
  ResourcePhaseId,
  ResourcePhaseState,
  ResourceTaskProgress,
} from "./types.ts";

const PHASE_LABELS: Record<ResourcePhaseId, string> = {
  understanding: "理解需求",
  planning: "制定规划",
  generation: "生成资料",
  review: "质量审核",
  integration: "统一整合",
  delivery: "交付学习路径",
};

const PHASE_IDS = Object.keys(PHASE_LABELS) as ResourcePhaseId[];

export function createResourcePhaseState(): ResourcePhaseState {
  return {
    phases: PHASE_IDS.map((id) => ({
      id,
      label: PHASE_LABELS[id],
      status: "pending",
      progress: 0,
    })),
    tasks: {},
    taskTotal: 0,
    autoExecute: false,
  };
}

function updatePhase(
  phases: ResourceExecutionPhase[],
  id: ResourcePhaseId,
  patch: Partial<ResourceExecutionPhase>,
): ResourceExecutionPhase[] {
  return phases.map((phase) =>
    phase.id === id
      ? {
          ...phase,
          ...patch,
          id,
          progress:
            patch.status === "completed"
              ? 100
              : Math.max(0, Math.min(100, patch.progress ?? phase.progress)),
        }
      : phase,
  );
}

function taskProgress(tasks: Record<string, ResourceTaskProgress>, total: number): number {
  if (total <= 0) return 0;
  const terminal = new Set(["completed", "generated", "review", "ready", "failed"]);
  const count = Object.values(tasks).filter((task) => terminal.has(task.status)).length;
  return Math.min(100, Math.round((count / total) * 100));
}

function reviewProgress(tasks: Record<string, ResourceTaskProgress>, total: number): number {
  if (total <= 0) return 0;
  const count = Object.values(tasks).filter(
    (task) => task.approved === true || task.status === "ready" || task.status === "failed",
  ).length;
  return Math.min(100, Math.round((count / total) * 100));
}

export function reduceResourceExecutionEvent(
  state: ResourcePhaseState,
  event: Record<string, unknown>,
): ResourcePhaseState {
  const eventName = String(event.event ?? "");

  if (eventName === "plan_ready") {
    const taskTotal = Math.max(0, Number(event.task_total ?? 0));
    const autoExecute = Boolean(event.auto_execute);
    let phases = updatePhase(state.phases, "understanding", {
      status: "completed",
      detail: "已提取学习目标、基础和时间约束",
    });
    phases = updatePhase(phases, "planning", {
      status: "completed",
      detail: `已规划 ${taskTotal} 份资料及各自大纲`,
    });
    if (autoExecute) {
      phases = updatePhase(phases, "generation", { status: "running" });
    }
    return { ...state, phases, taskTotal, autoExecute };
  }

  if (eventName === "phase") {
    const phase = String(event.phase ?? "") as ResourcePhaseId;
    if (!PHASE_IDS.includes(phase)) return state;
    return {
      ...state,
      phases: updatePhase(state.phases, phase, {
        status: String(event.status ?? "running") as ResourceExecutionPhase["status"],
        progress: typeof event.progress === "number" ? event.progress : undefined,
        detail: typeof event.detail === "string" ? event.detail : undefined,
      }),
    };
  }

  if (eventName === "task_progress" && event.task_id) {
    const taskId = String(event.task_id);
    const previous = state.tasks[taskId];
    const tasks = {
      ...state.tasks,
      [taskId]: {
        ...previous,
        task_id: taskId,
        title: typeof event.title === "string" ? event.title : previous?.title,
        agent: typeof event.agent === "string" ? event.agent : previous?.agent,
        status: String(event.status ?? previous?.status ?? "pending"),
        progress: typeof event.progress === "number" ? event.progress : previous?.progress,
      },
    };
    const progress = taskProgress(tasks, state.taskTotal);
    return {
      ...state,
      tasks,
      phases: updatePhase(state.phases, "generation", {
        status: progress >= 100 ? "completed" : "running",
        progress,
      }),
    };
  }

  if (eventName === "task_review" && event.task_id) {
    const taskId = String(event.task_id);
    const approved = Boolean(event.approved);
    const terminal = approved || event.terminal !== false;
    const previous = state.tasks[taskId];
    const tasks = {
      ...state.tasks,
      [taskId]: {
        ...previous,
        task_id: taskId,
        status: approved ? "ready" : terminal ? "failed" : "rework",
        approved,
        score: typeof event.score === "number" ? event.score : undefined,
        issues: Array.isArray(event.issues) ? event.issues.map(String) : [],
        retry_count: typeof event.retry_count === "number" ? event.retry_count : 0,
      },
    };
    const progress = reviewProgress(tasks, state.taskTotal);
    return {
      ...state,
      tasks,
      phases: updatePhase(state.phases, "review", {
        status: progress >= 100 ? "completed" : "running",
        progress,
      }),
    };
  }

  return state;
}
