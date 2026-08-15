import type { ResourceItem, ResourceType } from "./types.ts";

export const LEARNING_ACTIVITY_STORAGE_PREFIX = "sl_learning_activity_v1:";
export const LEARNING_ACTIVITY_UPDATED_EVENT = "smartlearn:learning-activity-updated";

const MAX_STORED_EVENTS = 1_500;
const MAX_ACTIVE_DELTA_SECONDS = 60 * 10;

export interface LearningActivityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LearningActivityInteractions {
  scrolls: number;
  questions: number;
  selections: number;
  practiceSubmissions: number;
}

export type LearningActivityInteraction = keyof LearningActivityInteractions;

export interface LearningActivityEvent {
  id: string;
  learnerId: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: ResourceType;
  topic: string;
  knowledgePoints: string[];
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  activeSeconds: number;
  interactions: LearningActivityInteractions;
}

export interface LearningActivityInput {
  learnerId: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: ResourceType;
  topic?: string;
  knowledgePoints?: string[];
}

export interface LearningActivitySummary {
  totalActiveSeconds: number;
  totalInteractions: number;
  byResourceType: Partial<Record<ResourceType, number>>;
  byTopic: Record<string, number>;
  byKnowledgePoint: Record<string, number>;
  byDay: Record<string, number>;
}

export interface PersistedUsageDay {
  date: string;
  route: string;
  minutes: number;
  questions: number;
  correct: number;
  feedback_count: number;
}

type PersistedRouteActivity = {
  resourceTitle: string;
  resourceType: ResourceType;
  topic: string;
  knowledgePoints: string[];
};

const ROUTE_ACTIVITY: Record<string, PersistedRouteActivity> = {
  "/desktop": { resourceTitle: "学习总览", resourceType: "reading", topic: "综合学习", knowledgePoints: ["学习规划"] },
  "/desktop/path": { resourceTitle: "学习路径", resourceType: "reading", topic: "学习规划", knowledgePoints: ["路径跟进"] },
  "/desktop/resources": { resourceTitle: "资源中心", resourceType: "explainer", topic: "资料学习", knowledgePoints: ["资料阅读"] },
  "/desktop/studio": { resourceTitle: "智能教师", resourceType: "interactive", topic: "AI 答疑", knowledgePoints: ["个性化辅导"] },
  "/desktop/practice": { resourceTitle: "练习与错题", resourceType: "quiz", topic: "阶段练习", knowledgePoints: ["测验", "错题复盘"] },
  "/desktop/code-lab": { resourceTitle: "代码挑战", resourceType: "code", topic: "编程实践", knowledgePoints: ["算法实现"] },
  "/desktop/kb": { resourceTitle: "课程知识库", resourceType: "reading", topic: "知识检索", knowledgePoints: ["课程知识"] },
  "/desktop/market": { resourceTitle: "学习市场", resourceType: "explainer", topic: "资源发现", knowledgePoints: ["学习资源"] },
  "/desktop/video-learning": { resourceTitle: "视频学习", resourceType: "video", topic: "视频学习", knowledgePoints: ["视频理解"] },
  "/desktop/profile": { resourceTitle: "学习画像", resourceType: "reading", topic: "学习反思", knowledgePoints: ["能力画像"] },
};

export function learningActivityFromPersistedUsage(
  day: PersistedUsageDay,
  learnerId: string,
): LearningActivityEvent | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) return null;
  const descriptor = ROUTE_ACTIVITY[day.route] ?? ROUTE_ACTIVITY["/desktop"];
  const startedAt = new Date(`${day.date}T10:00:00.000Z`);
  if (!Number.isFinite(startedAt.getTime())) return null;
  const minutes = Math.max(0, finiteNonNegative(day.minutes));
  const updatedAt = new Date(startedAt.getTime() + minutes * 60_000).toISOString();
  return {
    id: `persisted_usage:${day.date}`,
    learnerId,
    resourceId: `usage:${day.route}:${day.date}`,
    ...descriptor,
    startedAt: startedAt.toISOString(),
    updatedAt,
    endedAt: updatedAt,
    activeSeconds: Math.round(minutes * 60),
    interactions: {
      scrolls: minutes > 0 ? Math.max(1, Math.round(minutes / 15)) : 0,
      questions: Math.round(finiteNonNegative(day.questions)),
      selections: Math.round(finiteNonNegative(day.feedback_count)),
      practiceSubmissions: finiteNonNegative(day.questions) > 0 ? 1 : 0,
    },
  };
}

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizedText(value: unknown, maxLength = 160): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，;；/|]/)
      : [];
  return Array.from(new Set(values.map((item) => normalizedText(item, 80)).filter(Boolean))).slice(0, 16);
}

function isResourceType(value: unknown): value is ResourceType {
  return [
    "explainer",
    "mindmap",
    "quiz",
    "solution",
    "reading",
    "code",
    "video",
    "courseware",
    "interactive",
  ].includes(String(value));
}

function safeTimestamp(value: unknown): string {
  if (typeof value !== "string") return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function normalizedInteractions(value: unknown): LearningActivityInteractions {
  const source = value && typeof value === "object"
    ? value as Partial<LearningActivityInteractions>
    : {};
  return {
    scrolls: Math.round(finiteNonNegative(source.scrolls)),
    questions: Math.round(finiteNonNegative(source.questions)),
    selections: Math.round(finiteNonNegative(source.selections)),
    practiceSubmissions: Math.round(finiteNonNegative(source.practiceSubmissions)),
  };
}

function normalizedEvent(value: unknown, learnerId: string): LearningActivityEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LearningActivityEvent>;
  const id = normalizedText(candidate.id, 180);
  const resourceId = normalizedText(candidate.resourceId, 180);
  const resourceTitle = normalizedText(candidate.resourceTitle, 240);
  const startedAt = safeTimestamp(candidate.startedAt);
  const updatedAt = safeTimestamp(candidate.updatedAt) || startedAt;
  if (!id || !resourceId || !resourceTitle || !startedAt || !isResourceType(candidate.resourceType)) return null;
  const endedAt = safeTimestamp(candidate.endedAt);
  return {
    id,
    learnerId,
    resourceId,
    resourceTitle,
    resourceType: candidate.resourceType,
    topic: normalizedText(candidate.topic, 160) || resourceTitle,
    knowledgePoints: stringList(candidate.knowledgePoints),
    startedAt,
    updatedAt,
    ...(endedAt ? { endedAt } : {}),
    activeSeconds: Math.round(finiteNonNegative(candidate.activeSeconds) * 1000) / 1000,
    interactions: normalizedInteractions(candidate.interactions),
  };
}

export function learningActivityStorageKey(learnerId: string): string {
  return `${LEARNING_ACTIVITY_STORAGE_PREFIX}${encodeURIComponent(learnerId)}`;
}

export function readLearningActivityEvents(
  storage: LearningActivityStorage,
  learnerId: string,
): LearningActivityEvent[] {
  try {
    const raw = storage.getItem(learningActivityStorageKey(learnerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizedEvent(item, learnerId))
      .filter((item): item is LearningActivityEvent => Boolean(item))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, MAX_STORED_EVENTS);
  } catch {
    return [];
  }
}

export function persistLearningActivityEvent(
  storage: LearningActivityStorage,
  event: LearningActivityEvent,
): LearningActivityEvent {
  const normalized = normalizedEvent(event, event.learnerId);
  if (!normalized) throw new Error("learning activity event is invalid");
  const events = readLearningActivityEvents(storage, normalized.learnerId);
  const next = [normalized, ...events.filter((item) => item.id !== normalized.id)]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_STORED_EVENTS);
  try {
    storage.setItem(learningActivityStorageKey(normalized.learnerId), JSON.stringify(next));
  } catch {
    // Learning telemetry must never prevent the resource viewer from working.
  }
  return normalized;
}

function randomActivityId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLearningActivityEvent(
  input: LearningActivityInput,
  now = new Date(),
  id = randomActivityId(),
): LearningActivityEvent {
  const timestamp = now.toISOString();
  return {
    id: `learning_${id}`,
    learnerId: input.learnerId,
    resourceId: input.resourceId,
    resourceTitle: input.resourceTitle,
    resourceType: input.resourceType,
    topic: normalizedText(input.topic, 160) || input.resourceTitle,
    knowledgePoints: stringList(input.knowledgePoints),
    startedAt: timestamp,
    updatedAt: timestamp,
    activeSeconds: 0,
    interactions: normalizedInteractions(undefined),
  };
}

export function addLearningActivityDuration(
  event: LearningActivityEvent,
  deltaSeconds: number,
  now = new Date(),
): LearningActivityEvent {
  const safeDelta = Math.min(MAX_ACTIVE_DELTA_SECONDS, finiteNonNegative(deltaSeconds));
  return {
    ...event,
    activeSeconds: Math.round((event.activeSeconds + safeDelta) * 1000) / 1000,
    updatedAt: now.toISOString(),
    endedAt: undefined,
  };
}

export function addLearningActivityInteraction(
  event: LearningActivityEvent,
  interaction: LearningActivityInteraction,
  amount = 1,
  now = new Date(),
): LearningActivityEvent {
  return {
    ...event,
    updatedAt: now.toISOString(),
    interactions: {
      ...event.interactions,
      [interaction]: event.interactions[interaction] + Math.round(finiteNonNegative(amount)),
    },
  };
}

export function finishLearningActivityEvent(
  event: LearningActivityEvent,
  now = new Date(),
): LearningActivityEvent {
  const timestamp = now.toISOString();
  return { ...event, updatedAt: timestamp, endedAt: timestamp };
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizedText(value, 160);
    if (text) return text;
  }
  return "";
}

export function learningActivityInputFromResource(
  resource: ResourceItem,
  learnerId: string,
): LearningActivityInput {
  const data = resource.data ?? {};
  const topic = firstText(
    data.subject_title,
    data.subject,
    data.topic,
    data.chapter_title,
    data.title,
    resource.meta[0],
    resource.title,
  );
  const knowledgePoints = Array.from(new Set([
    ...stringList(data.knowledge_points),
    ...stringList(data.key_points),
    ...stringList(data.focus_terms),
  ])).slice(0, 16);
  return {
    learnerId,
    resourceId: resource.id,
    resourceTitle: resource.title,
    resourceType: resource.type,
    topic,
    knowledgePoints: knowledgePoints.length ? knowledgePoints : stringList(resource.meta),
  };
}

export function summarizeLearningActivities(events: LearningActivityEvent[]): LearningActivitySummary {
  const summary: LearningActivitySummary = {
    totalActiveSeconds: 0,
    totalInteractions: 0,
    byResourceType: {},
    byTopic: {},
    byKnowledgePoint: {},
    byDay: {},
  };
  for (const event of events) {
    const seconds = finiteNonNegative(event.activeSeconds);
    summary.totalActiveSeconds += seconds;
    summary.byResourceType[event.resourceType] = (summary.byResourceType[event.resourceType] ?? 0) + seconds;
    summary.byTopic[event.topic] = (summary.byTopic[event.topic] ?? 0) + seconds;
    for (const point of event.knowledgePoints) {
      summary.byKnowledgePoint[point] = (summary.byKnowledgePoint[point] ?? 0) + seconds;
    }
    const day = event.startedAt.slice(0, 10);
    summary.byDay[day] = (summary.byDay[day] ?? 0) + seconds;
    summary.totalInteractions += Object.values(event.interactions)
      .reduce((total, count) => total + finiteNonNegative(count), 0);
  }
  summary.totalActiveSeconds = Math.round(summary.totalActiveSeconds * 1000) / 1000;
  summary.totalInteractions = Math.round(summary.totalInteractions);
  return summary;
}
