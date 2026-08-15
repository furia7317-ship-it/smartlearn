import type { PathStep, PathTask, ResourceType } from "./types";
import { pathScheduleCurrentIndex } from "./path-schedule-clock.ts";

export interface DailyTaskItem {
  key: string;
  kind?: PathTask["kind"];
  action: string;
  title: string;
  detail: string;
  minutes: number;
  resourceTypes: ResourceType[];
  resourceTargets: DailyTaskResource[];
  resourceTarget?: DailyTaskResource;
  resourceLabel: string;
  href: string;
  standard: string;
  completed: boolean;
  prompts: string[];
  completionKind: "resource_read" | "quiz_submission" | "written_response";
}

export interface DailyTaskResource {
  key: string;
  taskKey: string;
  id?: string;
  type: ResourceType;
  title?: string;
  taskTitle: string;
  taskAction: string;
  completed: boolean;
}

export interface DailyTaskPlan {
  objective: string;
  totalMinutes: number;
  taskCount: number;
  resourceCount: number;
  completedTaskCount: number;
  progressLabel: string;
  tasks: DailyTaskItem[];
}

export interface PathStageSummary {
  index: number;
  day: string;
  title: string;
  desc: string;
  totalMinutes: number;
  taskCount: number;
  resourceCount: number;
  completedTaskCount: number;
  progressLabel: string;
  current: boolean;
}

export interface PathDashboardPlan {
  today?: {
    index: number;
    step: PathStep;
    plan: DailyTaskPlan;
  };
  todayResources: DailyTaskResource[];
  stages: PathStageSummary[];
  upcoming: PathStageSummary[];
}

export const QUIZ_PASS_SCORE = 60;

const RESOURCE_ACTIONS: Record<ResourceType, { label: string; href: string }> = {
  explainer: { label: "打开讲义", href: "/resources" },
  mindmap: { label: "打开导图", href: "/resources" },
  quiz: { label: "开始练习", href: "/practice" },
  solution: { label: "查看题目解析", href: "/resources" },
  reading: { label: "打开阅读", href: "/resources" },
  code: { label: "开始代码挑战", href: "/code-lab" },
  video: { label: "打开视频", href: "/resources" },
  courseware: { label: "打开课件", href: "/resources" },
  interactive: { label: "打开交互演示", href: "/resources" },
};

export function getDailyTaskResourceAction(
  type: ResourceType
): { label: string; href: string } {
  return RESOURCE_ACTIONS[type] ?? { label: "打开资料", href: "/resources" };
}

export function taskCompletionKey(stageIndex: number, taskIndex: number): string {
  return `${stageIndex}:task:${taskIndex}`;
}

export function materialCompletionKey(stageIndex: number, type: ResourceType): string {
  return `${stageIndex}:${type}`;
}

export function resourceCompletionKey(id: string): string {
  return `resource:${id}`;
}

function resolvedTaskCompletionKey(
  task: PathTask,
  stageIndex: number,
  taskIndex: number,
): string {
  return task.completion_key ?? taskCompletionKey(stageIndex, taskIndex);
}

function actionFromTask(task: PathTask): string {
  if (task.kind === "practice") return "练习";
  if (task.kind === "review") return "复盘";
  if (task.resource_types.includes("quiz")) return "练习";
  const title = task.title.trim();
  const separator = title.search(/[：:]/);
  if (separator > 0) return title.slice(0, separator).trim();
  if (title.includes("练习") || title.includes("题")) return "练习";
  if (title.includes("复盘") || title.includes("输出")) return "复盘";
  return "学习";
}

function shortTitle(task: PathTask, action: string): string {
  const title = task.title.trim();
  return title.replace(new RegExp(`^${action}[：:]?\\s*`), "") || title;
}

function actionResource(task: PathTask, action: string): { label: string; href: string } {
  if (action.includes("复盘")) return { label: "写复盘", href: "/resources" };
  if (task.resource_types.includes("quiz")) return RESOURCE_ACTIONS.quiz;
  const first = task.resource_types[0];
  return first ? RESOURCE_ACTIONS[first] : { label: "打开资料", href: "/resources" };
}

function completionKind(
  task: PathTask,
  action: string
): "resource_read" | "quiz_submission" | "written_response" {
  if (task.completion_kind) return task.completion_kind;
  if (action.includes("练习") || task.resource_types.includes("quiz")) {
    return "quiz_submission";
  }
  if (action.includes("复盘") || action.includes("输出") || task.resource_types.length === 0) {
    return "written_response";
  }
  return "resource_read";
}

function completionStandard(kind: DailyTaskItem["completionKind"]): string {
  if (kind === "quiz_submission") return "提交答案后自动记录";
  if (kind === "written_response") return "提交学习产出后自动记录";
  return `读完资料并在配套练习达到 ${QUIZ_PASS_SCORE} 分后自动记录`;
}

function taskIsCompleted(
  stageIndex: number,
  taskIndex: number,
  task: PathTask,
  completed: Set<string>
): boolean {
  if (
    completed.has(resolvedTaskCompletionKey(task, stageIndex, taskIndex)) ||
    completed.has(taskCompletionKey(stageIndex, taskIndex))
  ) return true;
  const action = actionFromTask(task);
  if (completionKind(task, action) !== "resource_read") return false;
  if (task.resources?.length) {
    return task.resources.every((resource) =>
      completed.has(resourceCompletionKey(resource.id)) ||
      completed.has(materialCompletionKey(stageIndex, resource.type))
    );
  }
  return (
    task.resource_types.length > 0 &&
    task.resource_types.every((type) => completed.has(materialCompletionKey(stageIndex, type)))
  );
}

function fallbackTasks(step: PathStep): PathTask[] {
  if (step.steps?.length) return step.steps;
  if (step.types.length === 0) {
    return [
      {
        title: `学习：${step.title}`,
        detail: step.desc,
        minutes: step.minutes ?? 30,
        resource_types: [],
      },
    ];
  }
  return step.types.map((type) => ({
    title: type === "quiz" ? `练习：${step.title}` : `学习：${step.title}`,
    detail: step.desc,
    minutes: Math.max(15, Math.round((step.minutes ?? 60) / step.types.length)),
    resource_types: [type],
  }));
}

function buildTaskResourceTargets(
  task: PathTask,
  resourceTypes: ResourceType[],
  stageIndex: number,
  taskIndex: number,
  action: string,
  completed: Set<string>
): DailyTaskResource[] {
  const completionKey = resolvedTaskCompletionKey(task, stageIndex, taskIndex);
  const taskCompleted = completed.has(completionKey) || completed.has(taskCompletionKey(stageIndex, taskIndex));
  const taskTitle = shortTitle(task, action);

  if (task.resources?.length) {
    return task.resources.map((resource) => {
      const key = resourceCompletionKey(resource.id);
      return {
        key,
        taskKey: completionKey,
        id: resource.id,
        type: resource.type,
        title: resource.title,
        taskTitle,
        taskAction: action,
        completed:
          completed.has(key) ||
          completed.has(materialCompletionKey(stageIndex, resource.type)) ||
          taskCompleted,
      };
    });
  }

  return resourceTypes.map((type) => {
    const key = materialCompletionKey(stageIndex, type);
    return {
      key,
      taskKey: completionKey,
      type,
      taskTitle,
      taskAction: action,
      completed: completed.has(key) || taskCompleted,
    };
  });
}

export function buildDailyTaskPlan(
  step: PathStep,
  stageIndex: number,
  completedKeys: string[] = []
): DailyTaskPlan {
  const completed = new Set(completedKeys);
  const tasks = fallbackTasks(step).map((task, taskIndex) => {
    const action = actionFromTask(task);
    const effectiveResourceTypes: ResourceType[] =
      task.resource_types.length > 0
        ? task.resource_types
        : action.includes("练习")
          ? ["quiz"]
          : [];
    const effectiveTask = { ...task, resource_types: effectiveResourceTypes };
    const resource = actionResource(effectiveTask, action);
    const resourceTargets = buildTaskResourceTargets(
      task,
      effectiveResourceTypes,
      stageIndex,
      taskIndex,
      action,
      completed
    );
    const preferredType = effectiveResourceTypes.includes("quiz")
      ? "quiz"
      : effectiveResourceTypes[0];
    const resourceTarget = preferredType
      ? resourceTargets.find((target) => target.type === preferredType) ?? resourceTargets[0]
      : resourceTargets[0];
    const kind = completionKind(task, action);
    return {
      key: resolvedTaskCompletionKey(task, stageIndex, taskIndex),
      kind: task.kind,
      action,
      title: shortTitle(task, action),
      detail: task.detail,
      minutes: task.minutes,
      resourceTypes: effectiveResourceTypes,
      resourceTargets,
      resourceTarget,
      resourceLabel: resource.label,
      href: resource.href,
      standard: completionStandard(kind),
      completed: taskIsCompleted(stageIndex, taskIndex, task, completed),
      prompts: Array.isArray(task.prompts) ? task.prompts.filter(Boolean).slice(0, 3) : [],
      completionKind: kind,
    };
  });
  const concreteResources = new Set<string>();
  const fallbackResourceTypes = new Set<ResourceType>();
  for (const task of fallbackTasks(step)) {
    if (task.resources?.length) {
      for (const resource of task.resources) concreteResources.add(resource.id);
    } else {
      for (const type of task.resource_types) fallbackResourceTypes.add(type);
    }
  }
  if (concreteResources.size === 0) {
    for (const type of step.types) fallbackResourceTypes.add(type);
  }
  const completedTaskCount = tasks.filter((task) => task.completed).length;

  return {
    objective: `掌握${step.title}`,
    totalMinutes: step.minutes ?? tasks.reduce((sum, task) => sum + task.minutes, 0),
    taskCount: tasks.length,
    resourceCount: concreteResources.size + fallbackResourceTypes.size,
    completedTaskCount,
    progressLabel: `${completedTaskCount}/${tasks.length}`,
    tasks,
  };
}

export function buildDailyTaskResources(
  step: PathStep,
  stageIndex: number,
  completedKeys: string[] = []
): DailyTaskResource[] {
  const completed = new Set(completedKeys);
  const seen = new Set<ResourceType>();
  const seenResources = new Set<string>();
  const resources: DailyTaskResource[] = [];

  fallbackTasks(step).forEach((task, taskIndex) => {
    const action = actionFromTask(task);
    const taskTitle = shortTitle(task, action);
    const completionKey = resolvedTaskCompletionKey(task, stageIndex, taskIndex);
    const taskCompleted = completed.has(completionKey) || completed.has(taskCompletionKey(stageIndex, taskIndex));
    const effectiveResourceTypes: ResourceType[] =
      task.resource_types.length > 0
        ? task.resource_types
        : action.includes("练习")
          ? ["quiz"]
          : [];

    if (task.resources?.length) {
      task.resources.forEach((resource) => {
        if (seenResources.has(resource.id)) return;
        seenResources.add(resource.id);
        const key = resourceCompletionKey(resource.id);
        resources.push({
          key,
          taskKey: completionKey,
          id: resource.id,
          type: resource.type,
          title: resource.title,
          taskTitle,
          taskAction: action,
          completed:
            completed.has(key) ||
            completed.has(materialCompletionKey(stageIndex, resource.type)) ||
            taskCompleted,
        });
      });
      return;
    }

    effectiveResourceTypes.forEach((type) => {
      if (seen.has(type)) return;
      seen.add(type);
      const key = materialCompletionKey(stageIndex, type);
      resources.push({
        key,
        taskKey: completionKey,
        type,
        taskTitle,
        taskAction: action,
        completed: completed.has(key) || taskCompleted,
      });
    });
  });

  return resources;
}

export function buildPathDashboardPlan(
  path: PathStep[],
  completedKeys: string[] = [],
  options: { anchorDate?: string; today?: Date } = {},
): PathDashboardPlan {
  const currentIndex = pathScheduleCurrentIndex(path, options.anchorDate, options.today);
  const stages = path.map((step, index) => {
    const plan = buildDailyTaskPlan(step, index, completedKeys);
    return {
      index,
      day: step.day,
      title: step.title,
      desc: step.desc,
      totalMinutes: plan.totalMinutes,
      taskCount: plan.taskCount,
      resourceCount: plan.resourceCount,
      completedTaskCount: plan.completedTaskCount,
      progressLabel: plan.progressLabel,
      current: index === currentIndex,
    };
  });
  const currentStep = currentIndex >= 0 ? path[currentIndex] : undefined;

  return {
    today: currentStep
      ? {
          index: currentIndex,
          step: currentStep,
          plan: buildDailyTaskPlan(currentStep, currentIndex, completedKeys),
        }
      : undefined,
    todayResources: currentStep
      ? buildDailyTaskResources(currentStep, currentIndex, completedKeys)
      : [],
    stages,
    upcoming: currentIndex >= 0 ? stages.slice(currentIndex + 1) : [],
  };
}
