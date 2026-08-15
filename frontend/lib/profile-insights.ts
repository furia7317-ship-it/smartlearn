import type { AssessmentRecord, PaperSummary } from "./library.ts";
import type { SubjectLearningPath, SubjectPathStatus } from "./master-learning-path.ts";
import type { PracticeAttempt } from "./practice-feedback.ts";
import type { ProfileDim } from "./types.ts";
import type { WatchedVideoRecord } from "./video-learning.ts";

export type ProfileEvidenceKind = "diagnostic" | "practice" | "review";

export interface ProfileTaskEvidence {
  kind: "resource_read" | "quiz_submission" | "written_response";
  content: string;
  completedAt: string;
  passed?: boolean;
}

export interface ProfileEvidenceRow {
  id: string;
  kind: ProfileEvidenceKind;
  label: string;
  content: string;
  knowledge: string;
  result: string;
  time: string;
  occurredAt: string;
  href: string;
}

export interface ProfileLearningSummary {
  studyMinutes: number;
  studyHoursLabel: string;
  dailyAverageLabel: string;
  mastery: number;
  masteryDelta: number;
  completedQuestions: number;
  accuracy: number | null;
  activityLevels: number[];
  rangeStartLabel: string;
  rangeEndLabel: string;
}

export interface ProfileLearningFocus {
  subjectTitle: string;
  stageTitle: string;
  description: string;
  progress: number;
  remainingMinutes: number;
  completedTasks: number;
  totalTasks: number;
  status: SubjectPathStatus;
  statusLabel: string;
}

export interface BuildProfileInsightsOptions {
  profile: ProfileDim[];
  practiceAttempts: PracticeAttempt[];
  taskEvidence: Record<string, ProfileTaskEvidence>;
  completedMaterials: string[];
  watchedVideos: WatchedVideoRecord[];
  subjectPaths: SubjectLearningPath[];
  assessments: AssessmentRecord[];
  papers: PaperSummary[];
  now?: Date;
}

export interface ProfileInsights {
  summary: ProfileLearningSummary;
  focus: ProfileLearningFocus | null;
  evidence: ProfileEvidenceRow[];
}

const DAY_MS = 86_400_000;

function parsedDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeStart(now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 29);
  return start;
}

function isRecent(value: string, start: Date, now: Date): boolean {
  const date = parsedDate(value);
  return Boolean(date && date.getTime() >= start.getTime() && date.getTime() <= now.getTime());
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function evidenceTime(value: string, now: Date): string {
  const date = parsedDate(value);
  if (!date) return "时间未知";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const difference = Math.round((today.getTime() - target.getTime()) / DAY_MS);
  const clock = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (difference === 0) return `今天 ${clock}`;
  if (difference === 1) return `昨天 ${clock}`;
  return `${shortDate(date)} ${clock}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function diagnosticScore(record: AssessmentRecord): number | null {
  const values = Object.values(record.analysis?.knowledge_seed ?? {})
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  return clampPercent(average <= 1 ? average * 100 : average);
}

function diagnosticKnowledge(record: AssessmentRecord): string {
  const seeded = Object.keys(record.analysis?.knowledge_seed ?? {}).filter(Boolean);
  if (seeded.length > 0) return seeded.slice(0, 3).join("、");
  const focus = record.analysis?.recommended_focus ?? [];
  if (focus.length > 0) return focus.slice(0, 3).join("、");
  const gaps = record.analysis?.gaps ?? [];
  if (gaps.length > 0) return gaps.slice(0, 3).join("、");
  return record.subject || "学情摸底";
}

function taskCompletionKeys(
  subject: SubjectLearningPath,
  stageIndex: number,
  taskIndex: number,
): string[] {
  const task = subject.path[stageIndex]?.steps?.[taskIndex];
  return [
    task?.completion_key,
    `${stageIndex}:task:${taskIndex}`,
  ].filter((value): value is string => Boolean(value));
}

function taskIsCompleted(
  subject: SubjectLearningPath,
  stageIndex: number,
  taskIndex: number,
  completed: Set<string>,
): boolean {
  return taskCompletionKeys(subject, stageIndex, taskIndex)
    .some((key) => completed.has(key));
}

function buildFocus(
  subjectPaths: SubjectLearningPath[],
  completed: Set<string>,
): ProfileLearningFocus | null {
  const statusOrder: SubjectPathStatus[] = [
    "active",
    "scheduled",
    "ready",
    "paused",
    "completed",
  ];
  const subject = statusOrder
    .map((status) => subjectPaths.find((item) => item.status === status))
    .find((item): item is SubjectLearningPath => Boolean(item));
  if (!subject) return null;

  const currentStageIndex = subject.path.findIndex((stage, stageIndex) => {
    const tasks = stage.steps ?? [];
    return tasks.length === 0 || tasks.some((_, taskIndex) =>
      !taskIsCompleted(subject, stageIndex, taskIndex, completed));
  });
  const resolvedStageIndex = currentStageIndex >= 0
    ? currentStageIndex
    : Math.max(subject.path.length - 1, 0);
  const currentStage = subject.path[resolvedStageIndex];
  const remainingMinutes = subject.path.reduce((total, stage, stageIndex) =>
    total + (stage.steps ?? []).reduce((stageTotal, task, taskIndex) =>
      stageTotal + (
        taskIsCompleted(subject, stageIndex, taskIndex, completed)
          ? 0
          : Math.max(0, task.minutes || 0)
      ), 0), 0);
  const statusLabels: Record<SubjectPathStatus, string> = {
    active: "正在学习",
    scheduled: "计划开始",
    ready: "待启用",
    paused: "已暂停",
    completed: "已完成",
  };

  return {
    subjectTitle: subject.title,
    stageTitle: currentStage?.title || "路径准备中",
    description: currentStage?.objective
      || currentStage?.desc
      || subject.requestSummary
      || "查看科目学习路径与下一步任务。",
    progress: subject.progress,
    remainingMinutes,
    completedTasks: subject.completedTasks,
    totalTasks: subject.totalTasks,
    status: subject.status,
    statusLabel: statusLabels[subject.status],
  };
}

function completedStudyMinutes(
  subjectPaths: SubjectLearningPath[],
  taskEvidence: Record<string, ProfileTaskEvidence>,
  watchedVideos: WatchedVideoRecord[],
  start: Date,
  now: Date,
): number {
  const counted = new Set<string>();
  const completedTaskTitles = new Set<string>();
  let minutes = 0;

  subjectPaths.forEach((subject) => {
    subject.path.forEach((stage, stageIndex) => {
      (stage.steps ?? []).forEach((task, taskIndex) => {
        const evidenceEntry = taskCompletionKeys(subject, stageIndex, taskIndex)
          .map((key) => ({ key, evidence: taskEvidence[key] }))
          .find(({ evidence }) =>
            evidence
            && evidence.passed !== false
            && isRecent(evidence.completedAt, start, now));
        if (!evidenceEntry || counted.has(evidenceEntry.key)) return;
        counted.add(evidenceEntry.key);
        completedTaskTitles.add(task.title.trim());
        minutes += Math.max(0, task.minutes || 0);
      });
    });
  });

  watchedVideos.forEach((video) => {
    if (!isRecent(video.watched_at, start, now)) return;
    const title = video.title.trim();
    const representedByTask = [...completedTaskTitles].some((taskTitle) =>
      taskTitle.includes(title) || title.includes(taskTitle));
    if (!representedByTask) minutes += Math.max(0, video.watched_seconds) / 60;
  });

  return Math.round(minutes);
}

function buildActivityLevels(
  values: string[],
  start: Date,
  now: Date,
): number[] {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const date = parsedDate(value);
    if (!date || date < start || date > now) return;
    const key = localDateKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return Math.min(4, counts.get(localDateKey(date)) ?? 0);
  });
}

function findTaskContext(
  key: string,
  subjectPaths: SubjectLearningPath[],
): { subject: SubjectLearningPath; title: string } | null {
  for (const subject of subjectPaths) {
    for (let stageIndex = 0; stageIndex < subject.path.length; stageIndex += 1) {
      const tasks = subject.path[stageIndex]?.steps ?? [];
      for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
        if (taskCompletionKeys(subject, stageIndex, taskIndex).includes(key)) {
          return { subject, title: tasks[taskIndex].title };
        }
      }
    }
  }
  return null;
}

function findPracticeKnowledge(
  attempt: PracticeAttempt,
  subjectPaths: SubjectLearningPath[],
): string {
  for (const subject of subjectPaths) {
    for (const stage of subject.path) {
      const task = (stage.steps ?? []).find((item) =>
        item.resources?.some((resource) => resource.id === attempt.resourceId));
      if (task) return `${subject.title} · ${task.title}`;
    }
  }
  return attempt.wrongQuestions.length > 0
    ? `${attempt.wrongQuestions.length} 个待巩固点`
    : "练习掌握情况";
}

function buildEvidence(
  options: BuildProfileInsightsOptions,
  now: Date,
): ProfileEvidenceRow[] {
  const rows: ProfileEvidenceRow[] = [];

  options.assessments.forEach((assessment) => {
    const score = diagnosticScore(assessment);
    rows.push({
      id: `diagnostic-${assessment.id}`,
      kind: "diagnostic",
      label: "诊断",
      content: `${assessment.subject || "综合能力"} · 学情摸底`,
      knowledge: diagnosticKnowledge(assessment),
      result: [assessment.self_level, score === null ? "" : `${score}%`]
        .filter(Boolean)
        .join(" "),
      time: evidenceTime(assessment.created_at, now),
      occurredAt: assessment.created_at,
      href: "/desktop/diagnostic",
    });
  });

  options.practiceAttempts.forEach((attempt) => {
    rows.push({
      id: `practice-${attempt.id}`,
      kind: "practice",
      label: "练习",
      content: attempt.title || "练习记录",
      knowledge: findPracticeKnowledge(attempt, options.subjectPaths),
      result: `正确率 ${clampPercent(attempt.score)}%`,
      time: evidenceTime(attempt.submittedAt, now),
      occurredAt: attempt.submittedAt,
      href: "/desktop/practice",
    });
  });

  Object.entries(options.taskEvidence).forEach(([key, evidence]) => {
    if (evidence.kind !== "written_response") return;
    const context = findTaskContext(key, options.subjectPaths);
    rows.push({
      id: `review-${key}`,
      kind: "review",
      label: "复习",
      content: context?.title || evidence.content.slice(0, 42) || "学习复盘",
      knowledge: context
        ? `${context.subject.title} · ${context.title}`
        : "学习路径复盘",
      result: evidence.passed === false ? "待补充" : "已完成",
      time: evidenceTime(evidence.completedAt, now),
      occurredAt: evidence.completedAt,
      href: "/desktop/path",
    });
  });

  const attemptedPaperKeys = new Set(
    options.practiceAttempts.flatMap((attempt) => [attempt.resourceId, attempt.title]),
  );
  options.papers.forEach((paper) => {
    if (paper.overall_score === null) return;
    if (
      attemptedPaperKeys.has(paper.id)
      || attemptedPaperKeys.has(paper.exam_id)
      || attemptedPaperKeys.has(paper.title)
    ) return;
    rows.push({
      id: `paper-${paper.id}`,
      kind: "practice",
      label: "练习",
      content: paper.title || "试卷练习",
      knowledge: paper.topic || paper.tags.slice(0, 3).join("、") || "综合练习",
      result: `得分 ${clampPercent(paper.overall_score)}%`,
      time: evidenceTime(paper.created_at, now),
      occurredAt: paper.created_at,
      href: "/desktop/practice",
    });
  });

  return rows
    .filter((row) => parsedDate(row.occurredAt))
    .sort((left, right) =>
      (parsedDate(right.occurredAt)?.getTime() ?? 0)
      - (parsedDate(left.occurredAt)?.getTime() ?? 0));
}

export function buildProfileInsights(
  options: BuildProfileInsightsOptions,
): ProfileInsights {
  const now = options.now ? new Date(options.now.getTime()) : new Date();
  const start = rangeStart(now);
  const completed = new Set(options.completedMaterials);
  const recentAttempts = options.practiceAttempts.filter((attempt) =>
    isRecent(attempt.submittedAt, start, now));
  const recentPapers = options.papers.filter((paper) =>
    paper.overall_score !== null && isRecent(paper.created_at, start, now));
  const completedQuestionsFromAttempts = recentAttempts.reduce(
    (total, attempt) => total + Math.max(0, attempt.total),
    0,
  );
  const completedQuestions = completedQuestionsFromAttempts > 0
    ? completedQuestionsFromAttempts
    : recentPapers.reduce((total, paper) => total + Math.max(0, paper.question_count), 0);
  const correctQuestions = recentAttempts.reduce(
    (total, attempt) => total + Math.max(0, attempt.correctCount),
    0,
  );
  const paperWeightedScore = recentPapers.reduce(
    (total, paper) => total + (paper.overall_score ?? 0) * Math.max(0, paper.question_count),
    0,
  );
  const paperQuestionCount = recentPapers.reduce(
    (total, paper) => total + Math.max(0, paper.question_count),
    0,
  );
  const accuracy = completedQuestionsFromAttempts > 0
    ? clampPercent((correctQuestions / completedQuestionsFromAttempts) * 100)
    : paperQuestionCount > 0
      ? clampPercent(paperWeightedScore / paperQuestionCount)
      : null;
  const mastery = options.profile.length > 0
    ? clampPercent(
        options.profile.reduce((total, item) => total + item.value, 0)
        / options.profile.length,
      )
    : 0;
  const masteryDelta = options.profile.length > 0
    ? Math.round(
        options.profile.reduce((total, item) => total + item.delta, 0)
        / options.profile.length,
      )
    : 0;
  const studyMinutes = completedStudyMinutes(
    options.subjectPaths,
    options.taskEvidence,
    options.watchedVideos,
    start,
    now,
  );
  const activityLevels = buildActivityLevels([
    ...options.assessments.map((item) => item.created_at),
    ...options.practiceAttempts.map((item) => item.submittedAt),
    ...Object.values(options.taskEvidence).map((item) => item.completedAt),
    ...options.watchedVideos.map((item) => item.watched_at),
    ...options.papers
      .filter((item) => item.overall_score !== null)
      .map((item) => item.created_at),
  ], start, now);

  return {
    summary: {
      studyMinutes,
      studyHoursLabel: (studyMinutes / 60).toFixed(1),
      dailyAverageLabel: (studyMinutes / 60 / 30).toFixed(2),
      mastery,
      masteryDelta,
      completedQuestions,
      accuracy,
      activityLevels,
      rangeStartLabel: shortDate(start),
      rangeEndLabel: shortDate(now),
    },
    focus: buildFocus(options.subjectPaths, completed),
    evidence: buildEvidence(options, now),
  };
}
