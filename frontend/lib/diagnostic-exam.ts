import type { DiagnosticAnalysis } from "./library.ts";
import type { MasteryLevel } from "./material-types.ts";

export type DiagnosticQuestionType = "mcq" | "blank" | "short" | "code";

export interface DiagnosticExamQuestion {
  id: string;
  type: DiagnosticQuestionType;
  stem: string;
  options?: string[];
  knowledge_point?: string;
}

export interface DiagnosticGradeReport {
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
  suggestions?: string[];
  next_steps?: string[];
  encouragement?: string;
}

export function normalizeDiagnosticQuestions(value: unknown): DiagnosticExamQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, itemIndex) => {
    if (!item || typeof item !== "object") return [];
    const question = item as Record<string, unknown>;
    const type = String(question.type ?? "");
    if (!["mcq", "blank", "short", "code"].includes(type)) return [];
    const stem = String(question.stem ?? "").trim();
    if (!stem) return [];
    return [{
      id: String(question.id ?? `diagnostic-${itemIndex + 1}`),
      type: type as DiagnosticQuestionType,
      stem,
      options: Array.isArray(question.options)
        ? question.options.filter((option): option is string => typeof option === "string")
        : undefined,
      knowledge_point: typeof question.knowledge_point === "string"
        ? question.knowledge_point
        : undefined,
    }];
  });
}

export function diagnosticLevelFromScore(value: unknown): MasteryLevel {
  const raw = Number(value) || 0;
  const score = raw <= 1 ? raw * 100 : raw;
  if (score >= 85) return "完全掌握";
  if (score >= 60) return "进阶";
  return "基础";
}

export function diagnosticAnalysisFromGrade(
  overall: unknown,
  mastery: Record<string, unknown>,
  report: DiagnosticGradeReport | null,
): DiagnosticAnalysis {
  const knowledgeSeed = Object.fromEntries(
    Object.entries(mastery).flatMap(([knowledgePoint, value]) => {
      const raw = value && typeof value === "object"
        ? Number((value as { score?: unknown }).score)
        : Number(value);
      if (!Number.isFinite(raw)) return [];
      const normalized = Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw));
      return [[knowledgePoint, normalized]];
    }),
  );
  const score = Number(overall) || 0;
  const suggestions = [...(report?.suggestions ?? []), ...(report?.next_steps ?? [])];
  return {
    summary: report?.summary || `本次客观摸底得分 ${Math.round(score)} 分`,
    narrative: report?.encouragement,
    strengths: report?.strengths ?? [],
    gaps: report?.weaknesses ?? [],
    recommended_focus: [...new Set(suggestions)],
    knowledge_seed: knowledgeSeed,
    suggested_modules: score < 60 ? ["explainer", "quiz"] : ["quiz", "reading"],
  };
}
