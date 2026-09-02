import { buildPathDashboardPlan } from "./daily-task-plan.ts";
import type { SubjectLearningPath } from "./master-learning-path.ts";

export const COURSE_ASSESSMENT_CATEGORY = "课程测评";

export type CourseAssessmentQuestionType = "mcq" | "blank" | "short" | "code";

export interface CourseAssessmentQuestion {
  id: string;
  type: CourseAssessmentQuestionType;
  stem: string;
  options?: string[];
  knowledge_point?: string;
  difficulty?: string;
  score?: number;
}

export interface CourseAssessmentScope {
  courseId: string;
  title: string;
  progress: number;
  scopePoints: string[];
  currentStage: string;
  coveredStageCount: number;
  status: SubjectLearningPath["status"];
}

export interface CourseExamRequestCourse {
  course_id: string;
  title: string;
  progress: number;
  scope_points: string[];
  current_stage: string;
}

export interface CourseAssessmentResultRow {
  question_id: string;
  type?: string;
  score: number;
  max_score: number;
  correct: boolean;
  student_answer?: string;
  answer?: string;
  knowledge_point?: string;
  feedback?: string;
  error_type?: string;
}

export interface CourseAssessmentMasteryItem {
  score: number;
  level?: string;
  question_count?: number;
}

export interface CourseAssessmentReport {
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  suggestions?: string[];
  next_steps?: string[];
  encouragement?: string;
}

export interface CourseAssessmentResult {
  overall: number;
  mastery: Record<string, CourseAssessmentMasteryItem>;
  results: CourseAssessmentResultRow[];
  report: CourseAssessmentReport | null;
  memoryCardsCreated?: number;
  semanticFactsUpdated?: number;
  profileUpdated?: boolean;
}

export interface CourseAssessmentDraft {
  version: 1;
  scopeSignature: string;
  selectedCourseIds: string[];
  examId: string;
  paperId: string;
  questions: CourseAssessmentQuestion[];
  questionIndex: number;
  answers: Record<string, string>;
  flagged: Record<string, boolean>;
  startedAt: number;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s*(?:学习路径|学习计划)\s*$/u, "")
    .trim() || "未命名课程";
}

function unique(values: string[], limit = 24): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

/**
 * A course exam must only cover learned material: fully completed stages plus
 * the stage that is currently being studied. Future nodes never enter the scope.
 */
export function buildCourseAssessmentScopes(
  subjects: SubjectLearningPath[],
  completedKeys: string[],
  now = new Date(),
): CourseAssessmentScope[] {
  return subjects.map((subject) => {
    const dashboard = buildPathDashboardPlan(subject.path, completedKeys, {
      anchorDate: subject.activationDate,
      today: now,
    });
    const currentIndex = dashboard.today?.index
      ?? dashboard.stages.find((stage) => stage.completedTaskCount < stage.taskCount)?.index
      ?? (subject.path.length > 0 ? 0 : -1);
    const eligibleIndexes = dashboard.stages
      .filter((stage) => (
        stage.index === currentIndex
        || (stage.taskCount > 0 && stage.completedTaskCount >= stage.taskCount)
      ))
      .map((stage) => stage.index);
    const eligibleSteps = eligibleIndexes
      .map((index) => subject.path[index])
      .filter(Boolean);
    const scopePoints = unique(eligibleSteps.flatMap((step) => (
      step.knowledge_points?.length ? step.knowledge_points : [step.title]
    )));

    return {
      courseId: subject.id,
      title: cleanTitle(subject.title || subject.requestSummary),
      progress: Math.max(0, Math.min(100, Math.round(subject.progress || 0))),
      scopePoints,
      currentStage: subject.path[currentIndex]?.title || "暂无当前节点",
      coveredStageCount: eligibleSteps.length,
      status: subject.status,
    };
  });
}

export function courseExamRequestCourses(
  scopes: CourseAssessmentScope[],
  selectedIds: Iterable<string>,
): CourseExamRequestCourse[] {
  const selected = new Set(selectedIds);
  return scopes
    .filter((scope) => selected.has(scope.courseId) && scope.scopePoints.length > 0)
    .map((scope) => ({
      course_id: scope.courseId,
      title: scope.title,
      progress: scope.progress,
      scope_points: scope.scopePoints,
      current_stage: scope.currentStage,
    }));
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function courseAssessmentScopeSignature(courses: CourseExamRequestCourse[]): string {
  const stable = [...courses]
    .sort((left, right) => left.course_id.localeCompare(right.course_id))
    .map((course) => [
      course.course_id,
      course.title,
      course.progress,
      course.current_stage,
      [...course.scope_points].sort(),
    ]);
  return shortHash(JSON.stringify(stable));
}

export function courseAssessmentDraftKey(studentId: string, scopeSignature: string): string {
  return `sl_course_assessment_draft_v1:${studentId}:${scopeSignature}`;
}

/** Drop answer/explanation fields before questions reach assessment UI state. */
export function normalizeCourseAssessmentQuestions(value: unknown): CourseAssessmentQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, itemIndex) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const type = String(raw.type || "");
    if (!["mcq", "blank", "short", "code"].includes(type)) return [];
    const stem = String(raw.stem || "").trim();
    if (!stem) return [];
    return [{
      id: String(raw.id || `course-assessment-${itemIndex + 1}`),
      type: type as CourseAssessmentQuestionType,
      stem,
      options: Array.isArray(raw.options)
        ? raw.options.filter((option): option is string => typeof option === "string")
        : undefined,
      knowledge_point: typeof raw.knowledge_point === "string" ? raw.knowledge_point : undefined,
      difficulty: typeof raw.difficulty === "string" ? raw.difficulty : undefined,
      score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : undefined,
    }];
  });
}

export function normalizeCourseAssessmentMastery(
  value: unknown,
): Record<string, CourseAssessmentMasteryItem> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    const source = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : { score: raw };
    const numeric = Number(source.score);
    if (!Number.isFinite(numeric)) return [];
    const score = Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
    return [[key, {
      score,
      level: typeof source.level === "string" ? source.level : undefined,
      question_count: Number.isFinite(Number(source.question_count))
        ? Number(source.question_count)
        : undefined,
    }]];
  }));
}

export function normalizeCourseAssessmentResults(value: unknown): CourseAssessmentResultRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const questionId = String(raw.question_id || "").trim();
    if (!questionId) return [];
    return [{
      question_id: questionId,
      type: typeof raw.type === "string" ? raw.type : undefined,
      score: Number(raw.score) || 0,
      max_score: Number(raw.max_score) || 0,
      correct: raw.correct === true,
      student_answer: typeof raw.student_answer === "string" ? raw.student_answer : undefined,
      answer: typeof raw.answer === "string" ? raw.answer : undefined,
      knowledge_point: typeof raw.knowledge_point === "string" ? raw.knowledge_point : undefined,
      feedback: typeof raw.feedback === "string" ? raw.feedback : undefined,
      error_type: typeof raw.error_type === "string" ? raw.error_type : undefined,
    }];
  });
}

export function isCourseAssessmentReport(value: unknown): value is CourseAssessmentReport {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
