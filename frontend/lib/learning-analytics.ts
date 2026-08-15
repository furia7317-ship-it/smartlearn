import type { LearningActivityEvent } from "./learning-activity.ts";
import type { SubjectLearningPath } from "./master-learning-path.ts";
import type { PracticeAttempt } from "./practice-feedback.ts";

export type { LearningActivityEvent } from "./learning-activity.ts";

export type AnalyticsAvailability = "ready" | "insufficient";

export interface MasteryEvidence {
  knowledgePoint: string;
  subject?: string;
  score: number;
  measuredAt: string;
  source: "diagnostic" | "practice" | "review";
}

export interface LearningConversationRecord {
  id: string;
  occurredAt: string;
  kind: "question" | "answer" | "task";
  subject?: string;
  knowledgePoints?: string[];
  resolved?: boolean;
}

export interface LearningTaskRecord {
  id: string;
  occurredAt: string;
  subject?: string;
  knowledgePoints?: string[];
  completed: boolean;
  passed?: boolean;
}

export interface PracticeTopic {
  subject?: string;
  knowledgePoints?: string[];
}

/** 同阶段数据必须由真实群体统计产生；未传入时不生成任何比较结论。 */
export interface PeerBenchmark {
  subject: string;
  mastery: number;
  studyShare?: number;
  sampleSize: number;
  stage?: string;
}

export interface BuildLearningAnalyticsInput {
  activities?: LearningActivityEvent[];
  masteryEvidence?: MasteryEvidence[];
  practiceAttempts?: PracticeAttempt[];
  practiceTopics?: Record<string, PracticeTopic>;
  subjectPaths?: SubjectLearningPath[];
  conversations?: LearningConversationRecord[];
  tasks?: LearningTaskRecord[];
  /** 0..1 或 0..100；未提供时优先使用路径计划时长计算目标投入占比。 */
  subjectTargets?: Record<string, number>;
  peerBenchmarks?: PeerBenchmark[];
  now?: Date;
  rangeDays?: number;
}

export interface AnalyticsEvidenceSummary {
  activityEvents: number;
  activeMinutes: number;
  masteryMeasurements: number;
  practiceAttempts: number;
  conversationRecords: number;
  taskRecords: number;
  subjectPaths: number;
}

export interface HealthFactor {
  id: "continuity" | "practice" | "mastery" | "completion" | "review";
  label: string;
  score: number | null;
  evidence: number;
}

export interface LearningHealthInsight {
  availability: AnalyticsAvailability;
  score: number | null;
  confidence: number;
  factors: HealthFactor[];
  strengths: string[];
  risks: string[];
}

export type SubjectBalanceState =
  | "high_effort_low_mastery"
  | "underinvested"
  | "strong"
  | "balanced"
  | "unknown";

export interface SubjectBalanceItem {
  subject: string;
  activeMinutes: number;
  investmentShare: number;
  targetShare: number | null;
  mastery: number | null;
  state: SubjectBalanceState;
  evidence: number;
}

export interface SubjectBalanceInsight {
  availability: AnalyticsAvailability;
  items: SubjectBalanceItem[];
  findings: string[];
}

export interface DailySummaryInsight {
  availability: AnalyticsAvailability;
  date: string;
  activeMinutes: number;
  topics: string[];
  questions: number;
  completedTasks: number;
  practiceAttempts: number;
  narrative: string | null;
}

export type LearningStyleChannel = "visual" | "code" | "practice" | "text" | "dialogue";

export interface LearningStyleItem {
  channel: LearningStyleChannel;
  label: string;
  share: number;
  evidence: number;
}

export interface LearningStyleInsight {
  availability: AnalyticsAvailability;
  basis: "active_time" | "event_count" | null;
  dominant: LearningStyleChannel | null;
  items: LearningStyleItem[];
}

export interface ForgettingRiskItem {
  knowledgePoint: string;
  subject: string | null;
  mastery: number;
  lastStudiedAt: string;
  daysSinceStudy: number;
  reviewCount: number;
  risk: number;
  level: "low" | "medium" | "high";
}

export interface ForgettingInsight {
  availability: AnalyticsAvailability;
  items: ForgettingRiskItem[];
}

export interface PathProgressItem {
  id: string;
  title: string;
  status: SubjectLearningPath["status"];
  progress: number;
  completedTasks: number;
  totalTasks: number;
  remainingMinutes: number;
}

export interface PathProgressInsight {
  availability: AnalyticsAvailability;
  items: PathProgressItem[];
  currentPathId: string | null;
}

export interface LearningBottleneck {
  topic: string;
  subject: string | null;
  activeMinutes: number;
  mastery: number | null;
  practiceScore: number | null;
  questionCount: number;
  severity: number;
  reasons: string[];
}

export interface BottleneckInsight {
  availability: AnalyticsAvailability;
  items: LearningBottleneck[];
}

export interface EfficiencyHour {
  hour: number;
  activeMinutes: number;
  outcomeScore: number | null;
  sessions: number;
}

export interface LearningEfficiencyInsight {
  availability: AnalyticsAvailability;
  goldenHour: number | null;
  basis: "outcomes" | "active_time" | null;
  hours: EfficiencyHour[];
}

export interface TeacherObservation {
  id: string;
  tone: "positive" | "risk" | "suggestion";
  title: string;
  detail: string;
  evidence: number;
}

export interface TeacherObservationInsight {
  availability: AnalyticsAvailability;
  items: TeacherObservation[];
}

export interface PeerComparisonItem {
  subject: string;
  learnerMastery: number;
  peerMastery: number;
  delta: number;
  learnerStudyShare: number | null;
  peerStudyShare: number | null;
  sampleSize: number;
  stage: string | null;
}

export interface PeerComparisonInsight {
  availability: AnalyticsAvailability;
  items: PeerComparisonItem[];
}

export interface LearningAnalytics {
  generatedAt: string;
  rangeDays: number;
  evidence: AnalyticsEvidenceSummary;
  health: LearningHealthInsight;
  subjectBalance: SubjectBalanceInsight;
  dailySummary: DailySummaryInsight;
  learningStyle: LearningStyleInsight;
  forgetting: ForgettingInsight;
  pathProgress: PathProgressInsight;
  bottlenecks: BottleneckInsight;
  efficiency: LearningEfficiencyInsight;
  teacherObservations: TeacherObservationInsight;
  peerComparison: PeerComparisonInsight;
}

const DAY_MS = 86_400_000;
const STYLE_LABELS: Record<LearningStyleChannel, string> = {
  visual: "图示与视频",
  code: "代码实践",
  practice: "练习测验",
  text: "文字阅读",
  dialogue: "问答互动",
};

function parsedDate(value?: string): Date | null {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function percent(value: number): number {
  return clamp(value >= 0 && value <= 1 ? value * 100 : value);
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function inRange(value: string, start: Date, now: Date): boolean {
  const date = parsedDate(value);
  return Boolean(date && date >= start && date <= now);
}

function safeDuration(event: LearningActivityEvent): number {
  return Number.isFinite(event.activeSeconds)
    ? Math.max(0, event.activeSeconds)
    : 0;
}

function eventSubject(event: LearningActivityEvent): string | null {
  return event.topic?.trim() || null;
}

function eventTimestamp(event: LearningActivityEvent): string {
  return event.endedAt || event.updatedAt || event.startedAt;
}

function pathPlannedMinutes(path: SubjectLearningPath): number {
  return path.path.reduce((total, stage) => {
    const taskMinutes = (stage.steps ?? []).reduce(
      (sum, task) => sum + Math.max(0, task.minutes || 0),
      0,
    );
    return total + (taskMinutes || Math.max(0, stage.minutes ?? 0));
  }, 0);
}

function remainingPathMinutes(path: SubjectLearningPath): number {
  const planned = pathPlannedMinutes(path);
  return Math.max(0, Math.round(planned * (1 - clamp(path.progress) / 100)));
}

function masteryBySubject(evidence: MasteryEvidence[]): Map<string, number> {
  const values = new Map<string, number[]>();
  for (const item of evidence) {
    const subject = item.subject?.trim();
    if (!subject) continue;
    values.set(subject, [...(values.get(subject) ?? []), percent(item.score)]);
  }
  return new Map([...values].map(([key, scores]) => [key, average(scores) ?? 0]));
}

function buildHealth(
  activities: LearningActivityEvent[],
  masteries: MasteryEvidence[],
  attempts: PracticeAttempt[],
  paths: SubjectLearningPath[],
  now: Date,
): LearningHealthInsight {
  const recentStart = startOfDay(now);
  recentStart.setDate(recentStart.getDate() - 6);
  const activeDays = new Set(
    activities
      .filter((event) => inRange(eventTimestamp(event), recentStart, now))
      .map((event) => parsedDate(eventTimestamp(event)))
      .filter((date): date is Date => Boolean(date))
      .map(localDateKey),
  );
  const continuity = activities.length > 0 ? (activeDays.size / 7) * 100 : null;
  const practice = average(attempts.map((attempt) => percent(attempt.score)));
  const mastery = average(masteries.map((item) => percent(item.score)));
  const pathTaskCount = paths.reduce((sum, path) => sum + Math.max(0, path.totalTasks), 0);
  const completedPathTasks = paths.reduce((sum, path) => sum + Math.max(0, path.completedTasks), 0);
  const completion = pathTaskCount > 0 ? (completedPathTasks / pathTaskCount) * 100 : null;
  const knowledgePoints = new Set(masteries.map((item) => item.knowledgePoint.trim()).filter(Boolean));
  const recentPointVisits = new Map<string, number>();
  activities.filter((event) => inRange(eventTimestamp(event), recentStart, now)).forEach((event) => {
    event.knowledgePoints.forEach((point) => recentPointVisits.set(point, (recentPointVisits.get(point) ?? 0) + 1));
  });
  const recentReviewPoints = new Set(
    [...recentPointVisits].filter(([, visits]) => visits > 1).map(([point]) => point),
  );
  const review = knowledgePoints.size > 0
    ? ([...knowledgePoints].filter((point) => recentReviewPoints.has(point)).length / knowledgePoints.size) * 100
    : null;
  const factors: HealthFactor[] = [
    { id: "continuity", label: "学习连续性", score: continuity === null ? null : rounded(continuity), evidence: activeDays.size },
    { id: "practice", label: "练习表现", score: practice === null ? null : rounded(practice), evidence: attempts.length },
    { id: "mastery", label: "知识掌握", score: mastery === null ? null : rounded(mastery), evidence: masteries.length },
    { id: "completion", label: "路径完成", score: completion === null ? null : rounded(completion), evidence: pathTaskCount },
    { id: "review", label: "及时复习", score: review === null ? null : rounded(review), evidence: recentReviewPoints.size },
  ];
  const available = factors.filter((factor) => factor.score !== null);
  const score = average(available.map((factor) => factor.score ?? 0));
  return {
    availability: available.length > 0 ? "ready" : "insufficient",
    score: score === null ? null : Math.round(score),
    confidence: rounded(available.length / factors.length),
    factors,
    strengths: available.filter((factor) => (factor.score ?? 0) >= 75).map((factor) => factor.label),
    risks: available.filter((factor) => (factor.score ?? 100) < 50).map((factor) => factor.label),
  };
}

function normalizedTargets(
  explicit: Record<string, number>,
  paths: SubjectLearningPath[],
): Map<string, number> {
  const values = new Map<string, number>();
  Object.entries(explicit).forEach(([subject, value]) => {
    if (Number.isFinite(value) && value >= 0) values.set(subject, percent(value));
  });
  if (values.size === 0) {
    paths.forEach((path) => {
      const minutes = pathPlannedMinutes(path);
      if (minutes > 0) values.set(path.title, minutes);
    });
  }
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (total <= 0) return new Map();
  return new Map([...values].map(([subject, value]) => [subject, (value / total) * 100]));
}

function buildSubjectBalance(
  activities: LearningActivityEvent[],
  masteries: MasteryEvidence[],
  paths: SubjectLearningPath[],
  targets: Record<string, number>,
): SubjectBalanceInsight {
  const seconds = new Map<string, number>();
  const counts = new Map<string, number>();
  activities.forEach((event) => {
    const subject = eventSubject(event);
    if (!subject) return;
    seconds.set(subject, (seconds.get(subject) ?? 0) + safeDuration(event));
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  });
  const targetShares = normalizedTargets(targets, paths);
  const mastery = masteryBySubject(masteries);
  const subjects = new Set([...seconds.keys(), ...targetShares.keys(), ...mastery.keys()]);
  const totalSeconds = [...seconds.values()].reduce((sum, value) => sum + value, 0);
  const observedShares = [...seconds.values()].filter((value) => value > 0).map((value) => (value / Math.max(1, totalSeconds)) * 100);
  const medianShare = observedShares.sort((a, b) => a - b)[Math.floor(observedShares.length / 2)] ?? 0;
  const items = [...subjects].map((subject): SubjectBalanceItem => {
    const subjectSeconds = seconds.get(subject) ?? 0;
    const investmentShare = totalSeconds > 0 ? (subjectSeconds / totalSeconds) * 100 : 0;
    const targetShare = targetShares.get(subject) ?? null;
    const subjectMastery = mastery.get(subject) ?? null;
    let state: SubjectBalanceState = "unknown";
    if (subjectMastery !== null && subjectMastery < 60 && investmentShare >= (targetShare ?? medianShare) && subjectSeconds > 0) {
      state = "high_effort_low_mastery";
    } else if (targetShare !== null && investmentShare + 10 < targetShare) {
      state = "underinvested";
    } else if (subjectMastery !== null && subjectMastery >= 75 && subjectSeconds > 0) {
      state = "strong";
    } else if (subjectSeconds > 0 && (subjectMastery !== null || targetShare !== null)) {
      state = "balanced";
    }
    return {
      subject,
      activeMinutes: rounded(subjectSeconds / 60),
      investmentShare: rounded(investmentShare),
      targetShare: targetShare === null ? null : rounded(targetShare),
      mastery: subjectMastery === null ? null : rounded(subjectMastery),
      state,
      evidence: (counts.get(subject) ?? 0) + masteries.filter((item) => item.subject === subject).length,
    };
  }).sort((left, right) => right.investmentShare - left.investmentShare);
  const findings = items.flatMap((item) => {
    if (item.state === "high_effort_low_mastery") return [`${item.subject}投入较高但掌握不足`];
    if (item.state === "underinvested") return [`${item.subject}投入低于当前路径目标`];
    if (item.state === "strong") return [`${item.subject}已形成相对优势`];
    return [];
  });
  return {
    availability: totalSeconds > 0 ? "ready" : "insufficient",
    items,
    findings,
  };
}

function buildDailySummary(
  activities: LearningActivityEvent[],
  conversations: LearningConversationRecord[],
  tasks: LearningTaskRecord[],
  attempts: PracticeAttempt[],
  now: Date,
): DailySummaryInsight {
  const date = localDateKey(now);
  const isToday = (value: string) => {
    const parsed = parsedDate(value);
    return parsed ? localDateKey(parsed) === date : false;
  };
  const todayActivities = activities.filter((item) => isToday(eventTimestamp(item)));
  const todayQuestions = conversations.filter((item) => item.kind === "question" && isToday(item.occurredAt));
  const activityQuestions = todayActivities.reduce((sum, item) => sum + item.interactions.questions, 0);
  const todayTasks = tasks.filter((item) => item.completed && isToday(item.occurredAt));
  const todayAttempts = attempts.filter((item) => isToday(item.submittedAt));
  const topicWeights = new Map<string, number>();
  const recordTopic = (topic: string, weight: number) => topicWeights.set(topic, (topicWeights.get(topic) ?? 0) + weight);
  todayActivities.forEach((event) => {
    const topics = event.knowledgePoints?.filter(Boolean) ?? [];
    (topics.length > 0 ? topics : event.topic ? [event.topic] : []).forEach((topic) => recordTopic(topic, Math.max(1, safeDuration(event))));
  });
  [...todayQuestions, ...todayTasks].forEach((record) => {
    const topics = record.knowledgePoints?.filter(Boolean) ?? [];
    (topics.length > 0 ? topics : record.subject ? [record.subject] : []).forEach((topic) => recordTopic(topic, 1));
  });
  const topics = [...topicWeights].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([topic]) => topic);
  const activeMinutes = rounded(todayActivities.reduce((sum, event) => sum + safeDuration(event), 0) / 60);
  const evidenceCount = todayActivities.length + todayQuestions.length + todayTasks.length + todayAttempts.length;
  const segments = [
    activeMinutes > 0 ? `主动学习 ${activeMinutes} 分钟` : "",
    topics.length > 0 ? `主要围绕${topics.join("、")}` : "",
    todayAttempts.length > 0 ? `完成 ${todayAttempts.length} 次练习` : "",
    todayQuestions.length + activityQuestions > 0 ? `提出 ${todayQuestions.length + activityQuestions} 个问题` : "",
    todayTasks.length > 0 ? `完成 ${todayTasks.length} 项任务` : "",
  ].filter(Boolean);
  return {
    availability: evidenceCount > 0 ? "ready" : "insufficient",
    date,
    activeMinutes,
    topics,
    questions: todayQuestions.length + activityQuestions,
    completedTasks: todayTasks.length,
    practiceAttempts: todayAttempts.length,
    narrative: evidenceCount > 0 ? `${segments.join("，")}。` : null,
  };
}

function styleChannel(event: LearningActivityEvent): LearningStyleChannel | null {
  const type = event.resourceType?.toLowerCase() ?? "";
  if (safeDuration(event) === 0 && event.interactions.questions > 0) return "dialogue";
  if (/chat|dialog|tutor/.test(type)) return "dialogue";
  if (/code|interactive/.test(type)) return "code";
  if (/quiz|practice|exam/.test(type)) return "practice";
  if (/video|mindmap|courseware|slide/.test(type)) return "visual";
  if (/reading|explainer|solution|text|document|pdf|word/.test(type)) return "text";
  return null;
}

function buildLearningStyle(activities: LearningActivityEvent[]): LearningStyleInsight {
  const mapped = activities.map((event) => ({ event, channel: styleChannel(event) })).filter(
    (item): item is { event: LearningActivityEvent; channel: LearningStyleChannel } => Boolean(item.channel),
  );
  const totalSeconds = mapped.reduce((sum, item) => sum + safeDuration(item.event), 0);
  const basis = totalSeconds > 0 ? "active_time" : mapped.length > 0 ? "event_count" : null;
  const values = new Map<LearningStyleChannel, { weight: number; evidence: number }>();
  mapped.forEach(({ event, channel }) => {
    const current = values.get(channel) ?? { weight: 0, evidence: 0 };
    const weight = basis === "active_time" ? safeDuration(event) : 1;
    values.set(channel, { weight: current.weight + weight, evidence: current.evidence + 1 });
  });
  const total = [...values.values()].reduce((sum, item) => sum + item.weight, 0);
  const channels: LearningStyleChannel[] = ["visual", "code", "practice", "text", "dialogue"];
  const items = channels.map((channel): LearningStyleItem => ({
    channel,
    label: STYLE_LABELS[channel],
    share: total > 0 ? rounded(((values.get(channel)?.weight ?? 0) / total) * 100) : 0,
    evidence: values.get(channel)?.evidence ?? 0,
  }));
  const dominant = [...items].sort((left, right) => right.share - left.share)[0];
  return {
    availability: mapped.length > 0 ? "ready" : "insufficient",
    basis,
    dominant: dominant && dominant.share > 0 ? dominant.channel : null,
    items,
  };
}

function buildForgetting(
  activities: LearningActivityEvent[],
  masteries: MasteryEvidence[],
  now: Date,
): ForgettingInsight {
  const grouped = new Map<string, MasteryEvidence[]>();
  masteries.forEach((item) => {
    const point = item.knowledgePoint.trim();
    if (point) grouped.set(point, [...(grouped.get(point) ?? []), item]);
  });
  const items = [...grouped].flatMap(([knowledgePoint, evidence]): ForgettingRiskItem[] => {
    const relatedActivities = activities.filter((event) => event.knowledgePoints?.includes(knowledgePoint));
    const dateCandidates: Array<{ value: string; source: string }> = [
      ...evidence.map((item) => ({ value: item.measuredAt, source: item.source })),
      ...relatedActivities.map((item) => ({ value: eventTimestamp(item), source: item.resourceType })),
    ];
    const dates: Array<{ value: string; source: string; date: Date }> = [];
    dateCandidates.forEach((item) => {
      const date = parsedDate(item.value);
      if (date) dates.push({ ...item, date });
    });
    dates.sort((left, right) => right.date.getTime() - left.date.getTime());
    const latest = dates[0];
    if (!latest) return [];
    const mastery = average(evidence.map((item) => percent(item.score))) ?? 0;
    const reviewCount = Math.max(0, relatedActivities.length - 1)
      + evidence.filter((item) => item.source === "review").length;
    const daysSinceStudy = Math.max(0, Math.floor((now.getTime() - latest.date.getTime()) / DAY_MS));
    const risk = Math.round(clamp(daysSinceStudy * 4 + (100 - mastery) * 0.55 - reviewCount * 4));
    return [{
      knowledgePoint,
      subject: evidence.find((item) => item.subject)?.subject ?? null,
      mastery: rounded(mastery),
      lastStudiedAt: latest.value,
      daysSinceStudy,
      reviewCount,
      risk,
      level: risk >= 70 ? "high" : risk >= 40 ? "medium" : "low",
    }];
  }).sort((left, right) => right.risk - left.risk);
  return { availability: items.length > 0 ? "ready" : "insufficient", items };
}

function buildPathProgress(paths: SubjectLearningPath[]): PathProgressInsight {
  const items = paths.map((path): PathProgressItem => ({
    id: path.id,
    title: path.title,
    status: path.status,
    progress: rounded(clamp(path.progress)),
    completedTasks: Math.max(0, path.completedTasks),
    totalTasks: Math.max(0, path.totalTasks),
    remainingMinutes: remainingPathMinutes(path),
  }));
  const current = items.find((item) => item.status === "active")
    ?? items.find((item) => item.status === "scheduled")
    ?? items.find((item) => item.status === "ready")
    ?? null;
  return {
    availability: items.length > 0 ? "ready" : "insufficient",
    items,
    currentPathId: current?.id ?? null,
  };
}

interface TopicAggregate {
  topic: string;
  subject: string | null;
  seconds: number;
  mastery: number[];
  scores: number[];
  questions: number;
  evidence: number;
}

function buildBottlenecks(
  activities: LearningActivityEvent[],
  masteries: MasteryEvidence[],
  attempts: PracticeAttempt[],
  topics: Record<string, PracticeTopic>,
  conversations: LearningConversationRecord[],
): BottleneckInsight {
  const aggregates = new Map<string, TopicAggregate>();
  const get = (topic: string, subject?: string) => {
    const key = `${subject ?? ""}\u0000${topic}`;
    const found = aggregates.get(key) ?? { topic, subject: subject ?? null, seconds: 0, mastery: [], scores: [], questions: 0, evidence: 0 };
    aggregates.set(key, found);
    return found;
  };
  activities.forEach((event) => {
    const eventTopics = event.knowledgePoints?.filter(Boolean) ?? [];
    (eventTopics.length > 0 ? eventTopics : event.topic ? [event.topic] : []).forEach((topic) => {
      const item = get(topic, event.topic);
      item.seconds += safeDuration(event);
      item.questions += event.interactions.questions;
      item.evidence += 1;
    });
  });
  masteries.forEach((evidence) => {
    const item = get(evidence.knowledgePoint, evidence.subject);
    item.mastery.push(percent(evidence.score));
    item.evidence += 1;
  });
  conversations.filter((record) => record.kind === "question").forEach((record) => {
    const recordTopics = record.knowledgePoints?.filter(Boolean) ?? [];
    (recordTopics.length > 0 ? recordTopics : record.subject ? [record.subject] : []).forEach((topic) => {
      const item = get(topic, record.subject);
      item.questions += 1;
      item.evidence += 1;
    });
  });
  attempts.forEach((attempt) => {
    const mapping = topics[attempt.resourceId];
    const attemptTopics = mapping?.knowledgePoints?.filter(Boolean) ?? [];
    (attemptTopics.length > 0 ? attemptTopics : mapping?.subject ? [mapping.subject] : []).forEach((topic) => {
      const item = get(topic, mapping?.subject);
      item.scores.push(percent(attempt.score));
      item.evidence += 1;
    });
  });
  const positiveMinutes = [...aggregates.values()].map((item) => item.seconds / 60).filter((value) => value > 0).sort((a, b) => a - b);
  const medianMinutes = positiveMinutes[Math.floor(positiveMinutes.length / 2)] ?? 0;
  const items = [...aggregates.values()].flatMap((item): LearningBottleneck[] => {
    const mastery = average(item.mastery);
    const practiceScore = average(item.scores);
    const activeMinutes = item.seconds / 60;
    const reasons: string[] = [];
    if (mastery !== null && mastery < 60) reasons.push("掌握度偏低");
    if (practiceScore !== null && practiceScore < 60) reasons.push("练习正确率偏低");
    if (item.questions >= 3) reasons.push("重复提问较多");
    if (activeMinutes >= Math.max(20, medianMinutes) && (mastery ?? practiceScore ?? 100) < 65) reasons.push("投入较高但尚未形成掌握");
    if (reasons.length === 0) return [];
    const severity = clamp(
      (mastery === null ? 0 : 60 - mastery)
      + (practiceScore === null ? 0 : 60 - practiceScore)
      + Math.min(25, item.questions * 5)
      + (activeMinutes >= Math.max(20, medianMinutes) ? 15 : 0),
    );
    return [{
      topic: item.topic,
      subject: item.subject,
      activeMinutes: rounded(activeMinutes),
      mastery: mastery === null ? null : rounded(mastery),
      practiceScore: practiceScore === null ? null : rounded(practiceScore),
      questionCount: item.questions,
      severity: Math.round(severity),
      reasons,
    }];
  }).sort((left, right) => right.severity - left.severity);
  return { availability: aggregates.size > 0 ? "ready" : "insufficient", items };
}

function buildEfficiency(
  activities: LearningActivityEvent[],
  attempts: PracticeAttempt[],
): LearningEfficiencyInsight {
  const buckets = new Map<number, { seconds: number; scores: number[]; sessions: number }>();
  activities.forEach((event) => {
    const date = parsedDate(eventTimestamp(event));
    if (!date) return;
    const hour = date.getHours();
    const bucket = buckets.get(hour) ?? { seconds: 0, scores: [], sessions: 0 };
    bucket.seconds += safeDuration(event);
    bucket.sessions += 1;
    buckets.set(hour, bucket);
  });
  attempts.forEach((attempt) => {
    const date = parsedDate(attempt.submittedAt);
    if (!date) return;
    const hour = date.getHours();
    const bucket = buckets.get(hour) ?? { seconds: 0, scores: [], sessions: 0 };
    bucket.scores.push(percent(attempt.score));
    buckets.set(hour, bucket);
  });
  const hours = [...buckets].map(([hour, bucket]): EfficiencyHour => ({
    hour,
    activeMinutes: rounded(bucket.seconds / 60),
    outcomeScore: bucket.scores.length > 0 ? rounded(average(bucket.scores) ?? 0) : null,
    sessions: bucket.sessions,
  })).sort((left, right) => left.hour - right.hour);
  const withOutcomes = hours.filter((item) => item.outcomeScore !== null);
  const basis = withOutcomes.length > 0 ? "outcomes" : hours.some((item) => item.activeMinutes > 0) ? "active_time" : null;
  const ranked = [...(basis === "outcomes" ? withOutcomes : hours)].sort((left, right) =>
    basis === "outcomes"
      ? (right.outcomeScore ?? 0) - (left.outcomeScore ?? 0) || right.activeMinutes - left.activeMinutes
      : right.activeMinutes - left.activeMinutes,
  );
  return {
    availability: hours.length > 0 ? "ready" : "insufficient",
    goldenHour: basis && ranked[0] ? ranked[0].hour : null,
    basis,
    hours,
  };
}

function buildTeacherObservations(
  health: LearningHealthInsight,
  balance: SubjectBalanceInsight,
  style: LearningStyleInsight,
  forgetting: ForgettingInsight,
  bottlenecks: BottleneckInsight,
): TeacherObservationInsight {
  const items: TeacherObservation[] = [];
  const strongest = health.strengths[0];
  if (strongest) items.push({ id: "health-strength", tone: "positive", title: `${strongest}表现稳定`, detail: "这一判断来自近期已记录的学习行为。", evidence: health.factors.find((item) => item.label === strongest)?.evidence ?? 0 });
  const bottleneck = bottlenecks.items[0];
  if (bottleneck) items.push({ id: `bottleneck-${bottleneck.topic}`, tone: "risk", title: `${bottleneck.topic}可能是当前瓶颈`, detail: bottleneck.reasons.join("，"), evidence: bottleneck.questionCount + (bottleneck.mastery === null ? 0 : 1) + (bottleneck.practiceScore === null ? 0 : 1) });
  const underinvested = balance.items.find((item) => item.state === "underinvested");
  if (underinvested) items.push({ id: `balance-${underinvested.subject}`, tone: "suggestion", title: `补足${underinvested.subject}投入`, detail: `当前投入 ${underinvested.investmentShare}%，路径目标 ${underinvested.targetShare}%`, evidence: underinvested.evidence });
  const highRisk = forgetting.items.find((item) => item.level === "high");
  if (highRisk) items.push({ id: `forget-${highRisk.knowledgePoint}`, tone: "suggestion", title: `及时复习${highRisk.knowledgePoint}`, detail: `距上次学习 ${highRisk.daysSinceStudy} 天，遗忘风险较高。`, evidence: highRisk.reviewCount + 1 });
  if (style.dominant) {
    const dominant = style.items.find((item) => item.channel === style.dominant);
    if (dominant) items.push({ id: `style-${dominant.channel}`, tone: "positive", title: `近期更常使用${dominant.label}`, detail: `${style.basis === "active_time" ? "活跃时长" : "行为次数"}占比 ${dominant.share}%。`, evidence: dominant.evidence });
  }
  return { availability: items.length > 0 ? "ready" : "insufficient", items: items.slice(0, 5) };
}

function buildPeerComparison(
  benchmarks: PeerBenchmark[],
  balance: SubjectBalanceInsight,
): PeerComparisonInsight {
  const own = new Map(balance.items.map((item) => [item.subject, item]));
  const items = benchmarks.flatMap((benchmark): PeerComparisonItem[] => {
    const learner = own.get(benchmark.subject);
    if (!learner || learner.mastery === null || benchmark.sampleSize <= 0) return [];
    const peerMastery = percent(benchmark.mastery);
    return [{
      subject: benchmark.subject,
      learnerMastery: learner.mastery,
      peerMastery: rounded(peerMastery),
      delta: rounded(learner.mastery - peerMastery),
      learnerStudyShare: learner.investmentShare,
      peerStudyShare: Number.isFinite(benchmark.studyShare) ? rounded(percent(benchmark.studyShare ?? 0)) : null,
      sampleSize: benchmark.sampleSize,
      stage: benchmark.stage ?? null,
    }];
  });
  return { availability: items.length > 0 ? "ready" : "insufficient", items };
}

/**
 * 汇总真实学习证据。函数不会生成示例记录，也不会把缺失值补成 50 分；
 * 每个模块都用 availability 和 null 显式表达证据是否足够。
 */
export function buildLearningAnalytics(input: BuildLearningAnalyticsInput): LearningAnalytics {
  const now = input.now ? new Date(input.now.getTime()) : new Date();
  const rangeDays = Math.max(1, Math.min(365, Math.round(input.rangeDays ?? 30)));
  const start = startOfDay(now);
  start.setDate(start.getDate() - rangeDays + 1);
  const activities = (input.activities ?? []).filter((item) => inRange(eventTimestamp(item), start, now));
  const masteries = (input.masteryEvidence ?? []).filter((item) => inRange(item.measuredAt, start, now));
  const attempts = (input.practiceAttempts ?? []).filter((item) => inRange(item.submittedAt, start, now));
  const conversations = (input.conversations ?? []).filter((item) => inRange(item.occurredAt, start, now));
  const tasks = (input.tasks ?? []).filter((item) => inRange(item.occurredAt, start, now));
  const paths = input.subjectPaths ?? [];
  const health = buildHealth(activities, masteries, attempts, paths, now);
  const subjectBalance = buildSubjectBalance(activities, masteries, paths, input.subjectTargets ?? {});
  const dailySummary = buildDailySummary(activities, conversations, tasks, attempts, now);
  const learningStyle = buildLearningStyle(activities);
  const forgetting = buildForgetting(activities, masteries, now);
  const pathProgress = buildPathProgress(paths);
  const bottlenecks = buildBottlenecks(activities, masteries, attempts, input.practiceTopics ?? {}, conversations);
  const efficiency = buildEfficiency(activities, attempts);
  const teacherObservations = buildTeacherObservations(health, subjectBalance, learningStyle, forgetting, bottlenecks);
  const peerComparison = buildPeerComparison(input.peerBenchmarks ?? [], subjectBalance);
  return {
    generatedAt: now.toISOString(),
    rangeDays,
    evidence: {
      activityEvents: activities.length,
      activeMinutes: rounded(activities.reduce((sum, event) => sum + safeDuration(event), 0) / 60),
      masteryMeasurements: masteries.length,
      practiceAttempts: attempts.length,
      conversationRecords: conversations.length,
      taskRecords: tasks.length,
      subjectPaths: paths.length,
    },
    health,
    subjectBalance,
    dailySummary,
    learningStyle,
    forgetting,
    pathProgress,
    bottlenecks,
    efficiency,
    teacherObservations,
    peerComparison,
  };
}
