import type { LearningBaseline } from "./learning-baseline.ts";

export type LearningPathMaterialType =
  | "explainer"
  | "quiz"
  | "solution"
  | "reading"
  | "code"
  | "video"
  | "mindmap"
  | "courseware"
  | "interactive";
export type LearningPathGoal = "starter" | "exam" | "project" | "gap";

export interface LearningPathPreferences {
  goal: LearningPathGoal;
  days: 3 | 7 | 14 | 30;
  daily_minutes: 20 | 40 | 60 | 90;
  material_types: LearningPathMaterialType[];
}

export interface LearningPathConfirmation {
  baseline: LearningBaseline;
  preferences: LearningPathPreferences;
  /** Main-agent-authored public judgment shown in the replayable process panel. */
  reasoning_summary?: string;
  /** Reusable specialist-authored contract used for this decision. */
  requirement_contract?: {
    id: string;
    source: "generated" | "reused";
    owner_agent: string;
  };
  /** 模型澄清后得到的补充范围与约束，随规划请求一并提交。 */
  refined_request?: string;
  clarifications?: Record<string, string | string[]>;
}

const CONFIRMATION_LEVEL_LABELS: Record<LearningBaseline["level"], string> = {
  novice: "几乎零基础",
  basic: "了解少量概念",
  intermediate: "能完成基础题",
  advanced: "希望进阶与查漏",
  custom: "用户自定义基础",
};

const CONFIRMATION_GOAL_LABELS: Record<LearningPathGoal, string> = {
  starter: "系统入门",
  exam: "应试复习",
  project: "项目实战",
  gap: "查漏补缺",
};

const CONFIRMATION_MATERIAL_LABELS: Record<LearningPathMaterialType, string> = {
  explainer: "讲义",
  quiz: "练习题",
  solution: "题目解析",
  reading: "扩展阅读",
  code: "代码示例",
  video: "讲解视频",
  mindmap: "思维导图",
  courseware: "课件",
  interactive: "交互演示",
};

export function confirmedLearningPathAnswers(
  confirmation: LearningPathConfirmation,
): Record<string, string | string[] | number> {
  return {
    ...(confirmation.clarifications ?? {}),
    baseline_level: confirmation.baseline.level,
    baseline_source: confirmation.baseline.source,
    goal: confirmation.preferences.goal,
    days: confirmation.preferences.days,
    daily_minutes: confirmation.preferences.daily_minutes,
    material_types: confirmation.preferences.material_types,
  };
}

export function learningPathConfirmationMessage(
  confirmation: LearningPathConfirmation,
): string {
  const preferences = confirmation.preferences;
  const materials = preferences.material_types
    .map((type) => CONFIRMATION_MATERIAL_LABELS[type])
    .join("、");
  const coreFields = new Set([
    "baseline_method",
    "baseline_level",
    "baseline_source",
    "goal",
    "days",
    "daily_minutes",
    "material_types",
  ]);
  const supplemental = Object.entries(confirmation.clarifications ?? {})
    .filter(([field, value]) => !coreFields.has(field) && (Array.isArray(value) ? value.length > 0 : value.trim()))
    .map(([, value]) => Array.isArray(value) ? value.join("、") : value);
  return [
    "我已填写学习任务信息：",
    `基础：${CONFIRMATION_LEVEL_LABELS[confirmation.baseline.level]}`,
    `目标：${CONFIRMATION_GOAL_LABELS[preferences.goal]}`,
    `周期：${preferences.days} 天`,
    `每天：${preferences.daily_minutes} 分钟`,
    `资料：${materials}`,
    ...supplemental.map((value) => `补充：${value}`),
  ].join("\n");
}

export type ConfirmationPage =
  | "method"
  | "level"
  | "history"
  | "diagnostic"
  | "goal"
  | "days"
  | "minutes"
  | "materials"
  | "summary";

export interface DiagnosticQuestion {
  id: string;
  type: "mcq" | "blank" | "short" | "code";
  stem: string;
  options?: string[];
}

export function normalizeDiagnosticQuestions(
  value: unknown,
): DiagnosticQuestion[] {
  if (!Array.isArray(value)) return [];
  const questions = value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    )
    .filter((item) => ["mcq", "blank", "short", "code"].includes(String(item.type)))
    .map((item, index) => ({
      id:
        typeof item.id === "string"
          ? item.id
          : "diagnostic-" + String(index + 1),
      type: item.type as DiagnosticQuestion["type"],
      stem: typeof item.stem === "string" ? item.stem.trim() : "",
      options: (Array.isArray(item.options) ? item.options : [])
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter((option) => option.length > 0),
    }))
    .filter((item) => item.stem.length > 0 && (item.type !== "mcq" || item.options.length >= 2))
    .slice(0, 15);
  return questions.length >= 3 ? questions : [];
}

export type ConfirmationMethod =
  "self" | "history" | "diagnostic" | "default" | null;

export function confirmationProgress(
  page: ConfirmationPage,
  diagnosticIndex: number,
  diagnosticCount: number,
  method: ConfirmationMethod,
): { current: number; total: number } {
  const diagnosticSteps = Array.from(
    { length: diagnosticCount },
    (_, index) => "diagnostic-" + String(index + 1),
  );
  const branchSteps =
    method === "diagnostic"
      ? ["method", ...diagnosticSteps]
      : method === "self"
        ? ["method", "level"]
        : method === "history"
          ? ["method", "history"]
          : ["method"];
  const steps = [
    ...branchSteps,
    "goal",
    "days",
    "minutes",
    "materials",
    "summary",
  ];
  const currentStep =
    page === "diagnostic" ? "diagnostic-" + String(diagnosticIndex + 1) : page;
  return {
    current: Math.max(1, steps.indexOf(currentStep) + 1),
    total: steps.length,
  };
}

export function canSubmitConfirmation(submitting: boolean): boolean {
  return !submitting;
}

export function createSingleSubmitGuard() {
  let submitted = false;
  return () => {
    if (submitted) return false;
    submitted = true;
    return true;
  };
}
