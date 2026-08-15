export type ResourceType =
  | "explainer"
  | "mindmap"
  | "quiz"
  | "solution"
  | "reading"
  | "code"
  | "video"
  | "courseware"
  | "interactive";

export const MAX_PLAN_TASKS = 210;

export type PlanStatus =
  | "draft"
  | "awaiting_confirmation"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface PlanComplexity {
  level: "simple" | "complex";
  reasons: string[];
  auto_execute: boolean;
}

export interface PlanConstraints {
  days: number;
  daily_minutes: number;
  deadline?: string | null;
  difficulty: string;
  material_types: ResourceType[];
}

export interface OutlineSection {
  title: string;
  goal: string;
  must_cover: string[];
  target_words: number;
}

export interface ResourceOutline {
  objective: string;
  sections: OutlineSection[];
}

export interface TaskReview {
  approved: boolean;
  score: number;
  issues: string[];
  fixes: string[];
  failure_kind?: string | null;
  error_code?: string | null;
  gate_status?: string;
  retryable?: boolean;
  terminal?: boolean;
  service_recoverable?: boolean;
}

export interface PlannedResourceTask {
  task_id: string;
  day: string;
  /**
   * 执行者：内置执行者就是 ResourceType 本身；自建智能体是 `custom:<uuid>`
   * （见 lib/custom-agents.ts）。`type` 始终是既有 9 种资料类型之一，
   * 所以资源查看器的渲染分支不受影响。
   */
  agent: ResourceType | (string & {});
  type: ResourceType;
  title: string;
  knowledge_points: string[];
  difficulty: string;
  audience: string;
  outline: ResourceOutline;
  quality_criteria: string[];
  source_ids: string[];
  depends_on: string[];
  status: "pending" | "running" | "generated" | "review" | "ready" | "failed";
  review?: TaskReview | null;
  retry_count: number;
}

export interface PlannedDay {
  day: string;
  title: string;
  knowledge_points: string[];
  objective: string;
  minutes: number;
  prerequisites: string[];
  task_ids: string[];
  actions: string[];
}

export interface PlanValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ResourcePlan {
  plan_id: string;
  student_id: string;
  version: number;
  status: PlanStatus;
  request_summary: string;
  complexity: PlanComplexity;
  constraints: PlanConstraints;
  days: PlannedDay[];
  tasks: PlannedResourceTask[];
  validation: PlanValidation;
  learner_context?: { source: string; level: string; summary?: string } | null;
}

export interface ResourcePlanExecution {
  resources: Record<string, unknown>[];
  schedule: Record<string, unknown>[];
  task_progress: Record<string, Record<string, unknown>>;
  coverage: Record<string, unknown>;
  integration: Record<string, unknown>;
  reviews?: Record<string, Record<string, unknown>>;
  repair_task_ids?: string[];
  retry_round?: number;
  trace_run_id?: string;
}

export interface ResourcePlanRecord {
  plan: ResourcePlan;
  execution: ResourcePlanExecution;
}

export interface ResourceExecutionEvent extends Record<string, unknown> {
  event: string;
}

function clonePlan(plan: ResourcePlan): ResourcePlan {
  return structuredClone(plan);
}

export function updatePlanDay(
  plan: ResourcePlan,
  dayId: string,
  patch: Partial<PlannedDay>,
): ResourcePlan {
  const next = clonePlan(plan);
  next.days = next.days.map((day) => (day.day === dayId ? { ...day, ...patch, day: day.day } : day));
  return next;
}

export function movePlanDay(plan: ResourcePlan, fromIndex: number, toIndex: number): ResourcePlan {
  const next = clonePlan(plan);
  if (
    fromIndex < 0 ||
    fromIndex >= next.days.length ||
    toIndex < 0 ||
    toIndex >= next.days.length ||
    fromIndex === toIndex
  ) {
    return next;
  }
  const [moved] = next.days.splice(fromIndex, 1);
  next.days.splice(toIndex, 0, moved);
  const dayMap = new Map(next.days.map((day, index) => [day.day, `D${index + 1}`]));
  next.days = next.days.map((day, index) => ({ ...day, day: `D${index + 1}` }));
  next.tasks = next.tasks.map((task) => ({ ...task, day: dayMap.get(task.day) ?? task.day }));
  next.constraints.days = next.days.length;
  return next;
}

export function addPlanTask(
  plan: ResourcePlan,
  dayId: string,
  type: ResourceType,
): ResourcePlan {
  const next = clonePlan(plan);
  const day = next.days.find((item) => item.day === dayId);
  if (!day || next.tasks.length >= MAX_PLAN_TASKS) return next;
  const prefix = `${type}-${dayId.toLowerCase()}`;
  let suffix = 1;
  let taskId = `${prefix}-${suffix}`;
  while (next.tasks.some((task) => task.task_id === taskId)) {
    suffix += 1;
    taskId = `${prefix}-${suffix}`;
  }
  const labels: Record<ResourceType, string> = {
    explainer: "讲义",
    mindmap: "思维导图",
    quiz: "测验",
    solution: "题目解析",
    reading: "延伸阅读",
    code: "代码示例",
    video: "视频脚本",
    courseware: "课件",
    interactive: "交互演示",
  };
  next.tasks.push({
    task_id: taskId,
    day: dayId,
    agent: type === "solution" ? "quiz" : type,
    type,
    title: `${day.title}${labels[type]}`,
    knowledge_points: [...day.knowledge_points],
    difficulty: next.constraints.difficulty || "适中",
    audience: "当前学习者",
    outline: {
      objective: day.objective,
      sections: [
        {
          title: day.title,
          goal: day.objective,
          must_cover: [...day.knowledge_points],
          target_words: 300,
        },
      ],
    },
    quality_criteria: ["完整覆盖大纲必须点", "内容可直接用于学习"],
    source_ids: [],
    depends_on: [],
    status: "pending",
    review: null,
    retry_count: 0,
  });
  day.task_ids.push(taskId);
  return next;
}

export function updatePlanTask(
  plan: ResourcePlan,
  taskId: string,
  patch: Partial<PlannedResourceTask>,
): ResourcePlan {
  const next = clonePlan(plan);
  const previous = next.tasks.find((task) => task.task_id === taskId);
  if (!previous) return next;
  const targetDay = patch.day ?? previous.day;
  next.tasks = next.tasks.map((task) =>
    task.task_id === taskId ? { ...task, ...patch, task_id: task.task_id } : task,
  );
  if (targetDay !== previous.day) {
    next.days = next.days.map((day) => ({
      ...day,
      task_ids:
        day.day === previous.day
          ? day.task_ids.filter((id) => id !== taskId)
          : day.day === targetDay && !day.task_ids.includes(taskId)
            ? [...day.task_ids, taskId]
            : day.task_ids,
    }));
  }
  return next;
}

export function removePlanTask(plan: ResourcePlan, taskId: string): ResourcePlan {
  const next = clonePlan(plan);
  next.tasks = next.tasks
    .filter((task) => task.task_id !== taskId)
    .map((task) => ({
      ...task,
      depends_on: task.depends_on.filter((dependency) => dependency !== taskId),
    }));
  next.days = next.days.map((day) => ({
    ...day,
    task_ids: day.task_ids.filter((id) => id !== taskId),
  }));
  return next;
}

export function addOutlineSection(plan: ResourcePlan, taskId: string): ResourcePlan {
  const task = plan.tasks.find((item) => item.task_id === taskId);
  if (!task || task.outline.sections.length >= 10) return clonePlan(plan);
  return updatePlanTask(plan, taskId, {
    outline: {
      ...task.outline,
      sections: [
        ...task.outline.sections,
        { title: "新增章节", goal: "补充本章节学习目标", must_cover: ["待补充"], target_words: 300 },
      ],
    },
  });
}

export function updateOutlineSection(
  plan: ResourcePlan,
  taskId: string,
  index: number,
  patch: Partial<OutlineSection>,
): ResourcePlan {
  const task = plan.tasks.find((item) => item.task_id === taskId);
  if (!task || !task.outline.sections[index]) return clonePlan(plan);
  const sections = task.outline.sections.map((section, sectionIndex) =>
    sectionIndex === index ? { ...section, ...patch } : section,
  );
  return updatePlanTask(plan, taskId, { outline: { ...task.outline, sections } });
}

export function removeOutlineSection(
  plan: ResourcePlan,
  taskId: string,
  index: number,
): ResourcePlan {
  const task = plan.tasks.find((item) => item.task_id === taskId);
  if (!task) return clonePlan(plan);
  return updatePlanTask(plan, taskId, {
    outline: {
      ...task.outline,
      sections: task.outline.sections.filter((_, sectionIndex) => sectionIndex !== index),
    },
  });
}

export function validatePlanDraft(plan: ResourcePlan): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (plan.days.length < 1 || plan.days.length > 30) errors.push("学习日必须为 1 到 30 天");
  if (plan.tasks.length < 1 || plan.tasks.length > MAX_PLAN_TASKS) {
    errors.push(`资料任务必须为 1 到 ${MAX_PLAN_TASKS} 项`);
  }
  const dayIds = new Set(plan.days.map((day) => day.day));
  const taskIds = new Set(plan.tasks.map((task) => task.task_id));
  const dayIndex = new Map(plan.days.map((day, index) => [day.day, index]));
  const mounts = new Map(plan.tasks.map((task) => [task.task_id, [] as string[]]));
  if (dayIds.size !== plan.days.length) errors.push("学习日编号不能重复");
  if (taskIds.size !== plan.tasks.length) errors.push("资料任务 ID 不能重复");

  for (const day of plan.days) {
    if (!day.title.trim() || !day.objective.trim()) errors.push(`${day.day} 缺少主题或目标`);
    if (day.minutes < 15 || day.minutes > plan.constraints.daily_minutes + 15) {
      errors.push(`${day.day} 学习时长不符合每日约束`);
    }
    if (day.task_ids.some((taskId) => !taskIds.has(taskId))) {
      errors.push(`${day.day} 引用了不存在的资料任务`);
    }
    for (const taskId of day.task_ids) mounts.get(taskId)?.push(day.day);
    if (day.task_ids.length === 0) warnings.push(`${day.day} 尚未安排资料`);
  }

  const titles = new Set<string>();
  for (const task of plan.tasks) {
    if (!dayIds.has(task.day)) errors.push(`${task.title} 未绑定有效学习日`);
    if (titles.has(task.title)) errors.push(`资料标题重复：${task.title}`);
    titles.add(task.title);
    if (!task.title.trim() || task.knowledge_points.length === 0) errors.push(`${task.task_id} 缺少标题或知识点`);
    if (!task.outline.objective.trim() || task.outline.sections.length === 0) {
      errors.push(`${task.title} 缺少完整资料大纲`);
    }
    if (
      task.outline.sections.some(
        (section) => !section.title.trim() || !section.goal.trim() || section.must_cover.length === 0,
      )
    ) {
      errors.push(`${task.title} 的大纲章节不完整`);
    }
    if (task.quality_criteria.length === 0) errors.push(`${task.title} 缺少验收标准`);
    if (task.depends_on.some((dependency) => !taskIds.has(dependency) || dependency === task.task_id)) {
      errors.push(`${task.title} 存在无效依赖`);
    }
    const mountedDays = mounts.get(task.task_id) ?? [];
    if (mountedDays.length === 0) {
      errors.push(`${task.title} 未挂载到任何学习日`);
    } else if (mountedDays.length !== 1 || mountedDays[0] !== task.day) {
      errors.push(`${task.title} 的挂载学习日与任务绑定不一致`);
    }
    for (const dependencyId of task.depends_on) {
      const dependency = plan.tasks.find((item) => item.task_id === dependencyId);
      if (
        dependency &&
        (dayIndex.get(dependency.day) ?? 0) > (dayIndex.get(task.day) ?? 0)
      ) {
        errors.push(`${task.title} 依赖了更晚学习日的任务`);
      }
    }
  }

  const remaining = new Map(plan.tasks.map((task) => [task.task_id, task.depends_on.length]));
  const ready = [...remaining.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const completed = ready.pop()!;
    visited += 1;
    for (const task of plan.tasks) {
      if (!task.depends_on.includes(completed)) continue;
      const next = (remaining.get(task.task_id) ?? 0) - 1;
      remaining.set(task.task_id, next);
      if (next === 0) ready.push(task.task_id);
    }
  }
  if (visited !== plan.tasks.length) errors.push("资料任务存在依赖环");
  return { valid: errors.length === 0, errors, warnings };
}
