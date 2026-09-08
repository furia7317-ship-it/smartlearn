import { buildPathDashboardPlan } from "./daily-task-plan.ts";
import { normalizePathTitle } from "./path-normalize.ts";
import { addLocalDays, localDateKey, pathScheduleSignature } from "./path-schedule-clock.ts";
import { resourcePlanRecordToPath } from "./resource-plan-recovery.ts";
import type { ResourcePlanRecord } from "./resource-plan.ts";
import type { PathStep, PathTask, ResourceType } from "./types.ts";

export type SubjectPathControlStatus = "ready" | "scheduled" | "active" | "paused" | "deleted";
export type VisibleSubjectPathControlStatus = Exclude<SubjectPathControlStatus, "deleted">;
export type SubjectPathStatus = VisibleSubjectPathControlStatus | "completed";

export interface SubjectPathControl {
  status: SubjectPathControlStatus;
  activationDate?: string;
  dailyMinutes?: number;
  updatedAt: number;
}

type VisibleSubjectPathControl = Omit<SubjectPathControl, "status"> & {
  status: VisibleSubjectPathControlStatus;
};

export interface SubjectLearningPath {
  id: string;
  title: string;
  requestSummary: string;
  status: SubjectPathStatus;
  controlStatus: VisibleSubjectPathControlStatus;
  activationDate?: string;
  dailyMinutes: number;
  path: PathStep[];
  sourcePlanIds: string[];
  completedTasks: number;
  totalTasks: number;
  progress: number;
  sourceStatus: ResourcePlanRecord["plan"]["status"] | "legacy";
}

export interface ResourcePathAttachment {
  resourceId: string;
  resourceType: ResourceType;
  resourceTitle: string;
  subjectId: string;
  taskKey: string;
  attachedAt: number;
}

export interface MasterLearningPath {
  path: PathStep[];
  anchorDate: string;
  activeSubjects: SubjectLearningPath[];
  scheduledSubjects: SubjectLearningPath[];
  readySubjects: SubjectLearningPath[];
  pausedSubjects: SubjectLearningPath[];
}

const SUBJECT_SUFFIXES = /(基础定位|核心框架|方法拆解|实战应用|综合检测|入门|基础|进阶)$/;
const SUPPLEMENT_TARGET_PATTERN = /补充到科目路径ID[：:]\s*([^\s\n；;]+)/;

export function subjectIdentityKey(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^(?:请为我|请帮我|帮我|给我|一个|一份|一条)+/, "")
    .replace(/\d+\s*(?:天|日|周|个月)(?:的)?/g, "")
    .replace(/(?:学习路径|学习计划|课程)/g, "")
    .replace(/(?:概述|概论|入门|基础|进阶)/g, "")
    .replace(/[\s，。；;：:、·\-_（）()【】\[\]]/g, "");
}

function identityMatches(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function supplementTargetId(record: ResourcePlanRecord): string | undefined {
  return SUPPLEMENT_TARGET_PATTERN.exec(record.plan.request_summary)?.[1]?.trim();
}

function marketListingId(record: ResourcePlanRecord): string | undefined {
  return /来源：学习市场\s+([^\s\n]+)/.exec(record.plan.request_summary)?.[1]?.trim();
}

function requestSubjectTitle(request: string): string | undefined {
  return /学习主题[：:]\s*([^\n；;]+)/.exec(request)?.[1]?.trim();
}

export function bindSubjectSupplementRequest(
  request: string,
  subjects: SubjectLearningPath[],
): string {
  if (SUPPLEMENT_TARGET_PATTERN.test(request)) return request;
  const explicitTitle = requestSubjectTitle(request);
  const requestKey = subjectIdentityKey(explicitTitle || request);
  const subject = [...subjects]
    .sort((left, right) => right.title.length - left.title.length)
    .find((item) => {
      const subjectKey = subjectIdentityKey(item.title);
      return identityMatches(subjectKey, requestKey) || request.includes(item.title);
    });
  const shouldBind = Boolean(
    subject && (
      /补充|追加|扩展|增加|加入|完善|更新/.test(request)
    )
  );
  if (!subject || !shouldBind) return request;
  return [
    request,
    "",
    `补充到科目路径ID：${subject.id}`,
    `既有科目：${subject.title}`,
    "合并要求：追加到既有科目学习路径，不创建新的科目路径；只为新增内容生成必要资源。",
  ].join("\n");
}

function dateNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

function dayDifference(from: string, to: string): number {
  const start = dateNumber(from);
  const end = dateNumber(to);
  return start === null || end === null ? 0 : Math.max(0, end - start);
}

function subjectTitle(record: ResourcePlanRecord, path: PathStep[]): string {
  const request = record.plan.request_summary.trim();
  const explicit = request.match(/学习主题[：:]\s*([^\n；;]+)/);
  if (explicit?.[1]?.trim()) return explicit[1].trim().slice(0, 36);

  const requestTopic = request.match(
    /(?:生成|制定|创建|做|一份|一条)?\s*([^，。；;\n]{2,32}?)(?:的)?(?:学习路径|学习计划)/,
  );
  if (requestTopic?.[1]?.trim()) {
    return requestTopic[1].replace(/^(请为我|请帮我|帮我|给我)/, "").trim().slice(0, 36);
  }

  const firstTitle = path[0]?.title ?? request ?? "未命名科目";
  return normalizePathTitle(firstTitle, request || firstTitle)
    .replace(SUBJECT_SUFFIXES, "")
    .trim()
    .slice(0, 36) || "未命名科目";
}

function isLearningPathRecord(record: ResourcePlanRecord, path: PathStep[]): boolean {
  if (path.length === 0 || record.plan.status === "cancelled") return false;
  return /学习路径|学习计划|每日|每天/.test(record.plan.request_summary) || path.length > 1;
}

function stableTask(task: PathTask, subjectId: string, subjectTitleValue: string, stageIndex: number, taskIndex: number): PathTask {
  return {
    ...task,
    completion_key: task.completion_key ?? `${subjectId}:${stageIndex}:task:${taskIndex}`,
    subject_id: subjectId,
    subject_title: subjectTitleValue,
  };
}

function annotateSubjectPath(path: PathStep[], subjectId: string, title: string): PathStep[] {
  return path.map((step, stageIndex) => ({
    ...step,
    subject_ids: [subjectId],
    subject_titles: [title],
    steps: step.steps?.map((task, taskIndex) =>
      stableTask(task, subjectId, title, stageIndex, taskIndex),
    ),
  }));
}

function appendSubjectPaths(paths: PathStep[][]): PathStep[] {
  return paths.flat().map((step, index) => ({
    ...step,
    day: `D${index + 1}`,
    state: index === 0 ? "current" : "todo",
  }));
}

export function reflowSubjectPath(path: PathStep[], dailyMinutes: number): PathStep[] {
  const limit = Math.max(10, Math.min(240, Math.round(dailyMinutes)));
  const entries = path.flatMap((step) =>
    (step.steps ?? []).map((task) => ({ task, step })),
  );
  if (entries.length === 0) return path;

  const buckets: Array<typeof entries> = [];
  let current: typeof entries = [];
  let currentMinutes = 0;
  for (const entry of entries) {
    const taskMinutes = Math.max(1, entry.task.minutes || 0);
    if (current.length > 0 && currentMinutes + taskMinutes > limit) {
      buckets.push(current);
      current = [];
      currentMinutes = 0;
    }
    current.push(entry);
    currentMinutes += taskMinutes;
  }
  if (current.length > 0) buckets.push(current);

  return buckets.map((bucket, index) => {
    const sourceSteps = Array.from(new Set(bucket.map(({ step }) => step)));
    const objectives = Array.from(new Set(sourceSteps.map((step) => step.objective || step.title)));
    const links = sourceSteps.flatMap((step) => step.links ?? []);
    const types = Array.from(new Set([
      ...sourceSteps.flatMap((step) => step.types),
      ...bucket.flatMap(({ task }) => task.resource_types),
    ]));
    const minutes = bucket.reduce((total, { task }) => total + Math.max(1, task.minutes || 0), 0);
    const firstTitle = sourceSteps[0]?.title || `第 ${index + 1} 阶段`;
    return {
      day: `D${index + 1}`,
      title: sourceSteps.length === 1 ? firstTitle : `${firstTitle}等 ${sourceSteps.length} 个阶段`,
      desc: objectives.join("；"),
      objective: objectives.join("；"),
      minutes,
      types,
      state: index === 0 ? "current" : "todo",
      subject_ids: path[0]?.subject_ids,
      subject_titles: path[0]?.subject_titles,
      steps: bucket.map(({ task }) => task),
      links: links.length > 0 ? links : undefined,
    } satisfies PathStep;
  });
}

/**
 * 把用户手动选择的资料引用合并到科目路径。只修改路径视图，不复制资料，
 * 也不改变任务数量、时长、完成键或已有学习证据。
 */
export function applyResourcePathAttachments(
  subjects: SubjectLearningPath[],
  attachments: Record<string, ResourcePathAttachment>,
): SubjectLearningPath[] {
  const bySubject = new Map<string, ResourcePathAttachment[]>();
  for (const attachment of Object.values(attachments)) {
    if (!attachment.resourceId || !attachment.subjectId || !attachment.taskKey) continue;
    bySubject.set(attachment.subjectId, [
      ...(bySubject.get(attachment.subjectId) ?? []),
      attachment,
    ]);
  }

  return subjects.map((subject) => {
    const subjectAttachments = bySubject.get(subject.id);
    if (!subjectAttachments?.length) return subject;
    const attachmentByTask = new Map<string, ResourcePathAttachment[]>();
    for (const attachment of subjectAttachments) {
      attachmentByTask.set(attachment.taskKey, [
        ...(attachmentByTask.get(attachment.taskKey) ?? []),
        attachment,
      ]);
    }

    let changed = false;
    const path = subject.path.map((step) => {
      let stepChanged = false;
      const steps = step.steps?.map((task) => {
        const taskKey = task.completion_key ?? "";
        const taskAttachments = attachmentByTask.get(taskKey);
        if (!taskAttachments?.length) return task;
        stepChanged = true;
        changed = true;
        const resources = new Map((task.resources ?? []).map((resource) => [resource.id, resource]));
        const resourceTypes = new Set(task.resource_types);
        for (const attachment of taskAttachments) {
          resources.set(attachment.resourceId, {
            id: attachment.resourceId,
            type: attachment.resourceType,
            title: attachment.resourceTitle,
          });
          resourceTypes.add(attachment.resourceType);
        }
        return {
          ...task,
          resource_types: Array.from(resourceTypes),
          resources: Array.from(resources.values()),
        };
      });
      if (!stepChanged) return step;
      return {
        ...step,
        types: Array.from(new Set([
          ...step.types,
          ...(steps ?? []).flatMap((task) => task.resource_types),
        ])),
        steps,
      };
    });
    return changed ? { ...subject, path } : subject;
  });
}

function effectiveStatus(
  control: VisibleSubjectPathControl,
  progress: number,
  todayKey: string,
): SubjectPathStatus {
  if (progress >= 100) return "completed";
  if (
    control.status === "scheduled" &&
    control.activationDate &&
    control.activationDate <= todayKey
  ) {
    return "active";
  }
  return control.status;
}

export function buildSubjectLearningPaths(options: {
  plans: Record<string, ResourcePlanRecord>;
  fallbackPath: PathStep[];
  fallbackAnchor?: string;
  controls: Record<string, SubjectPathControl>;
  completedKeys?: string[];
  today?: Date;
}): SubjectLearningPath[] {
  const todayKey = localDateKey(options.today);
  const fallbackSignature = pathScheduleSignature(options.fallbackPath);
  const candidates = Object.values(options.plans)
    .map((record) => ({
      record,
      path: resourcePlanRecordToPath(record),
    }))
    .filter(({ record, path }) => isLearningPathRecord(record, path));
  const fallbackPlanId = [...candidates]
    .reverse()
    .find(({ path }) => pathScheduleSignature(path) === fallbackSignature)
    ?.record.plan.plan_id;

  type Candidate = (typeof candidates)[number];
  const supplements = new Map<string, Candidate[]>();
  const grouped = new Map<string, { title: string; candidates: Candidate[] }>();
  for (const candidate of candidates) {
    const targetId = supplementTargetId(candidate.record);
    if (targetId) {
      supplements.set(targetId, [...(supplements.get(targetId) ?? []), candidate]);
      continue;
    }
    if (options.controls[candidate.record.plan.plan_id]?.status === "deleted") continue;
    const title = subjectTitle(candidate.record, candidate.path);
    const marketId = marketListingId(candidate.record);
    const identity = marketId ? `market:${marketId}` : subjectIdentityKey(title) || title;
    // Full-path replacement is intentionally stricter than supplement routing.
    // A prefix match would merge distinct subjects such as “数据结构” and
    // “数据结构与算法”, allowing a later plan to overwrite the wrong schedule.
    // Normalization still collapses harmless variants such as “Python 基础”
    // and “Python 进阶”, but the resulting identity must be exactly equal.
    const current = grouped.get(identity);
    if (current) current.candidates.push(candidate);
    else grouped.set(identity, { title, candidates: [candidate] });
  }

  const subjects: SubjectLearningPath[] = Array.from(grouped.values()).flatMap((group) => {
    const primary = [...group.candidates].reverse().find(
      (candidate) => candidate.record.plan.status === "completed",
    ) ?? [...group.candidates].reverse().find(
      (candidate) => candidate.record.plan.status !== "cancelled",
    );
    if (!primary) return [];
    const controlled = [...group.candidates]
      .filter((candidate) => Boolean(options.controls[candidate.record.plan.plan_id]))
      .sort((left, right) =>
        (options.controls[right.record.plan.plan_id]?.updatedAt ?? 0) -
        (options.controls[left.record.plan.plan_id]?.updatedAt ?? 0),
      )[0];
    const fallbackCandidate = group.candidates.find(
      (candidate) => candidate.record.plan.plan_id === fallbackPlanId,
    );
    const id = (controlled ?? fallbackCandidate ?? primary).record.plan.plan_id;
    const title = group.candidates
      .map((candidate) => subjectTitle(candidate.record, candidate.path))
      .sort((left, right) => left.length - right.length)[0] || group.title;
    const explicitControl = options.controls[id];
    if (explicitControl?.status === "deleted") return [];
    const visibleExplicitControl: VisibleSubjectPathControl | undefined = explicitControl
      ? { ...explicitControl, status: explicitControl.status }
      : undefined;
    const control: VisibleSubjectPathControl = visibleExplicitControl ?? {
      status: id === fallbackPlanId ? "active" : "ready",
      activationDate: id === fallbackPlanId ? options.fallbackAnchor || todayKey : undefined,
      updatedAt: 0,
    };
    const sourcePlanIds = group.candidates.map((candidate) => candidate.record.plan.plan_id);
    const supplementalCandidates = sourcePlanIds.flatMap((sourceId) => supplements.get(sourceId) ?? []);
    const rawPath = appendSubjectPaths([
      primary.path,
      ...supplementalCandidates.map((candidate) => candidate.path),
    ]);
    const annotatedPath = annotateSubjectPath(rawPath, id, title);
    const defaultDailyMinutes = Math.max(
      10,
      primary.record.plan.constraints.daily_minutes || annotatedPath[0]?.minutes || 30,
    );
    const dailyMinutes = control.dailyMinutes ?? defaultDailyMinutes;
    const scheduledPath = control.dailyMinutes
      ? reflowSubjectPath(annotatedPath, dailyMinutes)
      : annotatedPath;
    const dashboard = buildPathDashboardPlan(scheduledPath, options.completedKeys ?? [], {
      anchorDate: control.activationDate || todayKey,
      today: options.today,
    });
    const totalTasks = dashboard.stages.reduce((total, stage) => total + stage.taskCount, 0);
    const completedTasks = dashboard.stages.reduce((total, stage) => total + stage.completedTaskCount, 0);
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    return [{
      id,
      title,
      requestSummary: primary.record.plan.request_summary,
      status: effectiveStatus(control, progress, todayKey),
      controlStatus: control.status,
      activationDate: control.activationDate,
      dailyMinutes,
      path: scheduledPath,
      sourcePlanIds: [...sourcePlanIds, ...supplementalCandidates.map((candidate) => candidate.record.plan.plan_id)],
      completedTasks,
      totalTasks,
      progress,
      sourceStatus: primary.record.plan.status,
    } satisfies SubjectLearningPath];
  });

  if (subjects.length === 0 && options.fallbackPath.length > 0) {
    const id = "legacy-current-path";
    if (options.controls[id]?.status === "deleted") return subjects;
    const title = normalizePathTitle(options.fallbackPath[0]?.title ?? "当前科目")
      .replace(SUBJECT_SUFFIXES, "")
      .trim() || "当前科目";
    const explicitControl = options.controls[id];
    const visibleExplicitControl: VisibleSubjectPathControl | undefined = explicitControl
      ? { ...explicitControl, status: explicitControl.status as VisibleSubjectPathControlStatus }
      : undefined;
    const control: VisibleSubjectPathControl = visibleExplicitControl ?? {
      status: "active" as const,
      activationDate: options.fallbackAnchor || todayKey,
      updatedAt: 0,
    };
    const supplementalCandidates = supplements.get(id) ?? [];
    const rawPath = appendSubjectPaths([
      options.fallbackPath,
      ...supplementalCandidates.map((candidate) => candidate.path),
    ]);
    const annotatedPath = annotateSubjectPath(rawPath, id, title);
    const dailyMinutes = control.dailyMinutes ?? Math.max(10, annotatedPath[0]?.minutes || 30);
    const path = control.dailyMinutes ? reflowSubjectPath(annotatedPath, dailyMinutes) : annotatedPath;
    const dashboard = buildPathDashboardPlan(path, options.completedKeys ?? [], {
      anchorDate: control.activationDate || todayKey,
      today: options.today,
    });
    const totalTasks = dashboard.stages.reduce((total, stage) => total + stage.taskCount, 0);
    const completedTasks = dashboard.stages.reduce((total, stage) => total + stage.completedTaskCount, 0);
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    subjects.push({
      id,
      title,
      requestSummary: title,
      status: effectiveStatus(control, progress, todayKey),
      controlStatus: control.status,
      activationDate: control.activationDate,
      dailyMinutes,
      path,
      sourcePlanIds: [id, ...supplementalCandidates.map((candidate) => candidate.record.plan.plan_id)],
      completedTasks,
      totalTasks,
      progress,
      sourceStatus: "legacy",
    });
  }

  return subjects.sort((left, right) => {
    const order: Record<SubjectPathStatus, number> = { active: 0, scheduled: 1, ready: 2, paused: 3, completed: 4 };
    return order[left.status] - order[right.status] || left.title.localeCompare(right.title, "zh-CN");
  });
}

function mergeMasterStep(
  contributions: Array<{ subject: SubjectLearningPath; step: PathStep }>,
  dayIndex: number,
): PathStep {
  const subjectTitles = contributions.map(({ subject }) => subject.title);
  const tasks = contributions.flatMap(({ subject, step }) =>
    (step.steps ?? []).map((task) => ({
      ...task,
      title: `${subject.title} · ${task.title}`,
    })),
  );
  const title = contributions.length === 1
    ? `${contributions[0].subject.title} · ${contributions[0].step.title}`
    : `${contributions.length} 个科目协同学习`;
  return {
    day: `D${dayIndex + 1}`,
    title,
    desc: contributions
      .map(({ subject, step }) => `${subject.title}：${step.objective || step.desc}`)
      .join("；"),
    objective: contributions.map(({ subject, step }) => `${subject.title}：${step.objective || step.title}`).join("；"),
    minutes: contributions.reduce((total, { step }) => total + (step.minutes ?? 0), 0),
    types: Array.from(new Set(contributions.flatMap(({ step }) => step.types))),
    state: dayIndex === 0 ? "current" : "todo",
    subject_ids: contributions.map(({ subject }) => subject.id),
    subject_titles: subjectTitles,
    steps: tasks,
  };
}

export function buildMasterLearningPath(
  subjects: SubjectLearningPath[],
  today = new Date(),
): MasterLearningPath {
  const todayKey = localDateKey(today);
  const activeSubjects = subjects.filter((subject) => subject.status === "active");
  const scheduledSubjects = subjects.filter((subject) => subject.status === "scheduled");
  const readySubjects = subjects.filter((subject) => subject.status === "ready");
  const pausedSubjects = subjects.filter((subject) => subject.status === "paused");
  if (activeSubjects.length === 0) {
    return { path: [], anchorDate: todayKey, activeSubjects, scheduledSubjects, readySubjects, pausedSubjects };
  }

  const anchorDate = activeSubjects
    .map((subject) => subject.activationDate || todayKey)
    .sort()[0] || todayKey;
  const todayIndex = dayDifference(anchorDate, todayKey);
  const totalDays = Math.max(
    todayIndex + 1,
    ...activeSubjects.map((subject) =>
      dayDifference(anchorDate, subject.activationDate || todayKey) + subject.path.length,
    ),
  );
  const path: PathStep[] = [];
  for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
    const contributions = activeSubjects.flatMap((subject) => {
      const startIndex = dayDifference(anchorDate, subject.activationDate || todayKey);
      const step = subject.path[dayIndex - startIndex];
      return step ? [{ subject, step }] : [];
    });
    if (contributions.length === 0) continue;
    path.push(mergeMasterStep(contributions, dayIndex));
  }
  return { path, anchorDate, activeSubjects, scheduledSubjects, readySubjects, pausedSubjects };
}

export function subjectActivationLabel(subject: SubjectLearningPath): string {
  if (subject.status === "active") return "已启用";
  if (subject.status === "completed") return "已完成";
  if (subject.status === "paused") return "已暂停";
  if (subject.status === "scheduled" && subject.activationDate) return `${subject.activationDate} 启用`;
  return "待启用";
}

export function defaultActivationDate(today = new Date()): string {
  return localDateKey(addLocalDays(today, 0));
}
