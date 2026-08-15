"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { streamSSE } from "@/lib/api";
import { diagnosticBaseline } from "@/lib/learning-baseline-gate";
import type { LearningBaseline } from "@/lib/learning-baseline";
import type {
  LearningPathConfirmation,
  LearningPathGoal,
  LearningPathMaterialType,
} from "@/lib/learning-path-confirmation";
import { getStudentId } from "@/lib/student-identity";
import { cn } from "@/lib/utils";

type ClarificationOption = { value: string; label: string; detail?: string };
type ClarificationQuestion = {
  field: string;
  text: string;
  reason?: string;
  kind: "single" | "multiple" | "text";
  options: ClarificationOption[];
  required?: boolean;
  allow_custom?: boolean;
  custom_placeholder?: string;
};
type RequirementContractField = {
  field: string;
  label: string;
  description?: string;
  kind: "single" | "multiple" | "text";
  required: boolean;
  inferable: boolean;
  option_guidance?: string;
};
type ClarificationPayload = {
  summary: string;
  inferred: Record<string, unknown>;
  questions: ClarificationQuestion[];
  context_sources: string[];
  source: "model";
  decision: "execute" | "ask";
  requirement_contract_id: string;
  requirement_contract_source: "generated" | "reused";
  requirement_contract_owner: string;
  requirement_fields: RequirementContractField[];
};
type DiagnosticExamQuestion = {
  id: string;
  type: "mcq" | "blank" | "short" | "code";
  stem: string;
  options?: string[];
  knowledge_point?: string;
};
type DiagnosticStage = "idle" | "loading" | "questions" | "grading" | "error" | "done";

const MATERIAL_LABELS: Record<LearningPathMaterialType, string> = {
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
const GOAL_LABELS: Record<LearningPathGoal, string> = {
  starter: "系统入门",
  exam: "应试复习",
  project: "项目实战",
  gap: "查漏补缺",
};
const LEVEL_LABELS = {
  novice: "几乎零基础",
  basic: "了解少量概念",
  intermediate: "能完成基础题",
  advanced: "希望进阶与查漏",
} as const;

function answerLabel(question: ClarificationQuestion, value: string | string[]) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => question.options.find((option) => option.value === entry)?.label ?? entry).join("、");
}

function normalizeQuestions(payload: ClarificationPayload): ClarificationQuestion[] {
  const seen = new Set<string>();
  return (Array.isArray(payload.questions) ? payload.questions : [])
    .filter((question) => {
      if (!question?.field || !question.text || seen.has(question.field)) return false;
      seen.add(question.field);
      return payload.inferred[question.field] === undefined;
    })
    .slice(0, 8);
}

function inferredFromConfirmation(confirmation: LearningPathConfirmation): ClarificationPayload {
  return {
    summary: confirmation.reasoning_summary || "正在调整已经确认的学习方案。",
    inferred: {
      baseline_level: confirmation.baseline.level,
      baseline_source: confirmation.baseline.source,
      goal: confirmation.preferences.goal,
      days: confirmation.preferences.days,
      daily_minutes: confirmation.preferences.daily_minutes,
      material_types: confirmation.preferences.material_types,
      request_refinement: confirmation.refined_request ?? "",
    },
    questions: [],
    context_sources: ["已确认方案"],
    source: "model",
    decision: "ask",
    requirement_contract_id: confirmation.requirement_contract?.id ?? "",
    requirement_contract_source: confirmation.requirement_contract?.source ?? "reused",
    requirement_contract_owner: confirmation.requirement_contract?.owner_agent ?? "path_planner",
    requirement_fields: [],
  };
}

export function LearningBaselineGate({
  request,
  onChoose,
  onCancel,
  planningError,
  onRetryPlan,
  onEditPlan,
  onOpenKnowledgeBase,
  planning,
  initialConfirmation,
  onClarification,
}: {
  request: string;
  onChoose: (confirmation: LearningPathConfirmation) => void;
  onCancel: () => void;
  planningError?: { code?: string; message: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown } | null;
  onRetryPlan?: () => void;
  onEditPlan?: () => void;
  onOpenKnowledgeBase?: () => void;
  planning?: boolean;
  initialConfirmation?: LearningPathConfirmation;
  onClarification?: (summary: string, streaming: boolean) => void;
}) {
  const submittedRef = useRef(false);
  const comparisonSummaryRef = useRef(initialConfirmation?.reasoning_summary ?? "");
  const [loading, setLoading] = useState(!initialConfirmation);
  const [readyToReveal, setReadyToReveal] = useState(Boolean(initialConfirmation));
  const [loadError, setLoadError] = useState("");
  const [payload, setPayload] = useState<ClarificationPayload | null>(() => initialConfirmation ? inferredFromConfirmation(initialConfirmation) : null);
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => initialConfirmation?.clarifications ?? {});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState(Boolean(initialConfirmation));
  const [submitting, setSubmitting] = useState(false);
  const [diagnosticStage, setDiagnosticStage] = useState<DiagnosticStage>("idle");
  const [diagnosticError, setDiagnosticError] = useState("");
  const [diagnosticExamId, setDiagnosticExamId] = useState("");
  const [diagnosticQuestions, setDiagnosticQuestions] = useState<DiagnosticExamQuestion[]>([]);
  const [diagnosticAnswers, setDiagnosticAnswers] = useState<Record<string, string>>({});
  const [diagnosticIndex, setDiagnosticIndex] = useState(0);
  const [diagnosticResult, setDiagnosticResult] = useState<LearningBaseline | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setReadyToReveal(false);
    setLoadError("");
    let streamedReasoning = "";
    try {
      const outcome: { result?: ClarificationPayload; error?: string } = {};
      await streamSSE(
        "/api/chat/clarify/stream",
        {
          student_id: getStudentId(),
          request,
          task_family: "learning_path",
          owner_agent: "path_planner",
          phase: "initial",
        },
        ({ event, data }) => {
          if (event === "reasoning_reset") {
            streamedReasoning = "";
            return;
          }
          if (event === "reasoning_delta" && typeof data.text === "string") {
            streamedReasoning += data.text;
            onClarification?.(streamedReasoning, true);
            return;
          }
          if (event === "result") {
            outcome.result = data as unknown as ClarificationPayload;
            return;
          }
          if (event === "error") {
            outcome.error = typeof data.message === "string"
              ? data.message
              : "需求对照流中断，请重试。";
          }
        },
      );
      if (outcome.error) throw new Error(outcome.error);
      const responsePayload = outcome.result;
      if (!responsePayload) throw new Error("智能体未返回完整的需求对照结果，请重试。");
      const next = {
        ...responsePayload,
        summary: streamedReasoning.trim() || responsePayload.summary,
      };
      const normalized = normalizeQuestions(next);
      comparisonSummaryRef.current = next.summary;
      setPayload(next);
      setQuestions(normalized);
      setIndex(0);
      setSummary(normalized.length === 0);
      onClarification?.(next.summary, false);
      window.requestAnimationFrame(() => setReadyToReveal(true));
    } catch (cause) {
      if (streamedReasoning.trim()) {
        onClarification?.(streamedReasoning, false);
      }
      setLoadError(cause instanceof Error ? cause.message : "暂时无法判断生成条件，请稍后重试。");
      setReadyToReveal(true);
    } finally {
      setLoading(false);
    }
  }, [onClarification, request]);

  useEffect(() => {
    if (initialConfirmation) {
      const next = inferredFromConfirmation(initialConfirmation);
      comparisonSummaryRef.current = next.summary;
      setPayload(next);
      setQuestions([]);
      setSummary(true);
      setLoading(false);
      setReadyToReveal(true);
      submittedRef.current = false;
      return;
    }
    void load();
  }, [initialConfirmation, load]);

  useEffect(() => { if (planningError) setSubmitting(false); }, [planningError]);
  const inferred = payload?.inferred ?? {};
  const value = (field: string) => answers[field] ?? inferred[field];
  const inferredSource = String(value("baseline_source") ?? "");
  const baselineMethod = String(
    value("baseline_method")
      ?? (inferredSource === "diagnostic" ? "diagnostic" : inferredSource === "explicit_default" ? "default" : "self"),
  );
  const visibleQuestions = useMemo(
    () => questions.filter((question) => question.field !== "baseline_level" || baselineMethod === "self"),
    [baselineMethod, questions],
  );
  const current = visibleQuestions[index];
  const currentAnswer = current ? answers[current.field] : undefined;
  const currentCustomAnswer = current ? customAnswers[current.field]?.trim() ?? "" : "";
  const currentValid = !current
    || current.required === false
    || (Array.isArray(currentAnswer)
      ? currentAnswer.length > 0 || Boolean(currentCustomAnswer)
      : Boolean(String(currentAnswer ?? "").trim()) || Boolean(currentCustomAnswer));
  const baselineLevel = value("baseline_level");
  const goal = value("goal");
  const days = Number(value("days"));
  const dailyMinutes = Number(value("daily_minutes"));
  const materialsRaw = value("material_types");
  const materials = (Array.isArray(materialsRaw) ? materialsRaw : typeof materialsRaw === "string" ? [materialsRaw] : [])
    .filter((entry): entry is LearningPathMaterialType => entry in MATERIAL_LABELS);
  const selectedBaseline: LearningBaseline | null = initialConfirmation?.baseline
    ?? diagnosticResult
    ?? (baselineMethod === "default"
      ? {
          source: "explicit_default",
          level: "basic",
          confidence: 0.4,
          summary: "用户明确选择系统默认方案",
          explicit_default_confirmed: true,
        }
      : baselineMethod === "self" && typeof baselineLevel === "string" && baselineLevel in LEVEL_LABELS
        ? {
            source: inferredSource === "existing_profile" ? "existing_profile" : "self_report",
            level: baselineLevel as keyof typeof LEVEL_LABELS,
            confidence: inferredSource === "existing_profile" ? 0.78 : 0.65,
            summary: `模型结合${payload?.context_sources.join("、") || "用户回答"}确认当前基础`,
          }
        : null);
  const complete =
    Boolean(selectedBaseline) &&
    typeof goal === "string" && goal in GOAL_LABELS &&
    [3, 7, 14, 30].includes(days) &&
    [20, 40, 60, 90].includes(dailyMinutes) &&
    materials.length > 0;

  useEffect(() => {
    setIndex((currentIndex) => Math.min(currentIndex, Math.max(visibleQuestions.length - 1, 0)));
  }, [visibleQuestions.length]);

  const setSingle = (field: string, answer: string) => setAnswers((previous) => ({ ...previous, [field]: answer }));
  const toggleMultiple = (field: string, answer: string) => setAnswers((previous) => {
    const selected = Array.isArray(previous[field]) ? previous[field] as string[] : [];
    return { ...previous, [field]: selected.includes(answer) ? selected.filter((entry) => entry !== answer) : [...selected, answer] };
  });
  const resolvedAnswers = useCallback(() => {
    const resolved: Record<string, string | string[]> = { ...answers };
    for (const question of questions) {
      const custom = customAnswers[question.field]?.trim();
      if (!custom) continue;
      if (question.kind === "multiple") {
        const selected = Array.isArray(resolved[question.field]) ? resolved[question.field] as string[] : [];
        resolved[question.field] = [...selected, custom];
      } else {
        resolved[question.field] = custom;
      }
    }
    return resolved;
  }, [answers, customAnswers, questions]);
  const startDiagnostic = async () => {
    if (diagnosticStage === "loading" || diagnosticStage === "grading") return;
    setDiagnosticStage("loading");
    setDiagnosticError("");
    setDiagnosticQuestions([]);
    setDiagnosticAnswers({});
    setDiagnosticIndex(0);
    let examId = "";
    let generated: DiagnosticExamQuestion[] = [];
    try {
      const scopePoints = visibleQuestions
        .filter((question) => !["baseline_method", "baseline_level"].includes(question.field))
        .filter((question) => answers[question.field] !== undefined)
        .map((question) => `${question.text}：${answerLabel(question, answers[question.field])}`);
      await streamSSE(
        "/api/assess/exam",
        {
          topic: request,
          student_id: getStudentId(),
          scope_points: scopePoints,
          paper_type: "adaptive",
          category: "学情摸底",
        },
        ({ event, data }) => {
          if (event === "exam" && Array.isArray(data.questions)) {
            generated = data.questions.flatMap((item, itemIndex) => {
              if (!item || typeof item !== "object") return [];
              const question = item as Record<string, unknown>;
              const type = String(question.type ?? "");
              if (!["mcq", "blank", "short", "code"].includes(type)) return [];
              const stem = String(question.stem ?? "").trim();
              if (!stem) return [];
              return [{
                id: String(question.id ?? `diagnostic-${itemIndex + 1}`),
                type: type as DiagnosticExamQuestion["type"],
                stem,
                options: Array.isArray(question.options)
                  ? question.options.filter((option): option is string => typeof option === "string")
                  : undefined,
                knowledge_point: typeof question.knowledge_point === "string" ? question.knowledge_point : undefined,
              }];
            });
          }
          if (event === "done" && typeof data.exam_id === "string") examId = data.exam_id;
        },
      );
      if (!examId || generated.length === 0) throw new Error("AI 未返回可用的摸底题，请重试");
      setDiagnosticExamId(examId);
      setDiagnosticQuestions(generated);
      setDiagnosticStage("questions");
    } catch (cause) {
      setDiagnosticError(cause instanceof Error ? cause.message : "生成摸底题失败，请重试");
      setDiagnosticStage("error");
    }
  };

  const submitDiagnostic = async () => {
    if (!diagnosticExamId || diagnosticStage === "grading") return;
    setDiagnosticStage("grading");
    setDiagnosticError("");
    let overall: unknown = 0;
    let mastery: Record<string, unknown> = {};
    try {
      await streamSSE(
        `/api/assess/${encodeURIComponent(diagnosticExamId)}/submit`,
        { student_id: getStudentId(), answers: diagnosticAnswers },
        ({ event, data }) => {
          if (event !== "graded" || !data.results || typeof data.results !== "object") return;
          const results = data.results as Record<string, unknown>;
          overall = results.overall ?? 0;
          mastery = results.mastery && typeof results.mastery === "object"
            ? results.mastery as Record<string, unknown>
            : {};
        },
      );
      setDiagnosticResult(diagnosticBaseline(overall, mastery, diagnosticQuestions.length));
      setDiagnosticStage("done");
      setSummary(true);
    } catch (cause) {
      setDiagnosticError(cause instanceof Error ? cause.message : "摸底评分失败，请重试");
      setDiagnosticStage("error");
    }
  };

  const advanceDiagnostic = () => {
    const question = diagnosticQuestions[diagnosticIndex];
    if (!question || !String(diagnosticAnswers[question.id] ?? "").trim()) return;
    if (diagnosticIndex < diagnosticQuestions.length - 1) {
      setDiagnosticIndex((currentIndex) => currentIndex + 1);
    } else {
      void submitDiagnostic();
    }
  };

  const next = () => {
    if (!currentValid) return;
    if (index < visibleQuestions.length - 1) setIndex((currentIndex) => currentIndex + 1);
    else if (baselineMethod === "diagnostic" && !diagnosticResult) void startDiagnostic();
    else setSummary(true);
  };
  const previous = () => {
    if (summary && visibleQuestions.length > 0) {
      setSummary(false);
      if (baselineMethod === "diagnostic") {
        setDiagnosticStage("idle");
        setDiagnosticResult(null);
        setDiagnosticExamId("");
        setDiagnosticQuestions([]);
        setDiagnosticAnswers({});
      }
    }
    else setIndex((currentIndex) => Math.max(0, currentIndex - 1));
  };

  const submit = () => {
    if (!complete || submittedRef.current || submitting) return;
    submittedRef.current = true;
    setSubmitting(true);
    const resolved = resolvedAnswers();
    const supplemental = visibleQuestions
      .filter((question) => !["baseline_method", "baseline_level", "goal", "days", "daily_minutes", "material_types"].includes(question.field))
      .flatMap((question) => resolved[question.field] === undefined
        ? []
        : [`${question.text}：${answerLabel(question, resolved[question.field])}`]);
    const requestRefinement = [String(inferred.request_refinement ?? "").trim(), ...supplemental]
      .filter(Boolean)
      .join("；");
    onChoose({
      baseline: selectedBaseline!,
      preferences: {
        goal: goal as LearningPathGoal,
        days: days as 3 | 7 | 14 | 30,
        daily_minutes: dailyMinutes as 20 | 40 | 60 | 90,
        material_types: materials,
      },
      refined_request: requestRefinement || undefined,
      clarifications: resolved,
      reasoning_summary: comparisonSummaryRef.current || payload?.summary,
      requirement_contract: payload ? {
        id: payload.requirement_contract_id,
        source: payload.requirement_contract_source,
        owner_agent: payload.requirement_contract_owner,
      } : undefined,
    });
  };

  const submitFromEffect = useEffectEvent(submit);
  const autoSubmitReady = (
    !loading
    && !loadError
    && payload?.decision === "execute"
    && visibleQuestions.length === 0
    && complete
    && !planningError
  );

  useEffect(() => {
    if (autoSubmitReady) submitFromEffect();
  }, [autoSubmitReady]);

  const cancel = () => {
    submittedRef.current = false;
    setSubmitting(false);
    onCancel();
  };

  const editPlan = () => {
    submittedRef.current = false;
    setSubmitting(false);
    onEditPlan?.();
    setSummary(false);
    setIndex(0);
    setDiagnosticStage("idle");
    setDiagnosticResult(null);
    setDiagnosticExamId("");
    setDiagnosticQuestions([]);
    setDiagnosticAnswers({});
    if (visibleQuestions.length === 0) void load();
  };

  const stepCurrent = diagnosticStage === "questions"
    ? visibleQuestions.length + diagnosticIndex + 1
    : summary
      ? visibleQuestions.length + diagnosticQuestions.length + 1
      : Math.min(index + 1, Math.max(visibleQuestions.length, 1));
  const stepTotal = visibleQuestions.length + diagnosticQuestions.length + 1;

  // Keep requirement analysis in the conversation process trace. The
  // interactive card appears only after the model has finished authoring every
  // question and option. A complete request continues automatically without
  // flashing an empty confirmation surface.
  if (!readyToReveal || loading || (payload?.decision === "execute" && visibleQuestions.length === 0 && complete)) {
    return null;
  }

  return (
    <motion.section
      role="region"
      aria-labelledby="learning-confirmation-title"
      data-testid="learning-requirement-card"
      initial={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
      animate={{ height: "auto", opacity: 1, clipPath: "inset(0 0 0% 0)" }}
      exit={{ height: 0, opacity: 0, clipPath: "inset(0 0 100% 0)" }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="shrink-0 overflow-hidden border-t border-[#d8cab5] bg-[#fbf7ef] shadow-[0_-10px_28px_rgba(78,55,28,0.08)]"
      style={{ transformOrigin: "top" }}
    >
      <div className="thin-scroll mx-auto max-h-[min(48vh,34rem)] w-full max-w-[980px] overflow-y-auto px-6 py-4">
        <div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-primary">
              <BrainCircuit className="size-4" />智能体需要补充信息
              {payload && (
                <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-normal">
                  {payload.requirement_contract_source === "generated" ? "本次新建需求契约" : "已复用同类需求契约"}
                </span>
              )}
            </div>
            <h2 id="learning-confirmation-title" className="text-base font-semibold">确认后继续生成学习任务</h2>
            <p className="mt-1 text-xs text-muted-foreground">只补充仍会改变结果的信息 · {stepCurrent}/{stepTotal}，你也可以取消后继续浏览其他页面</p>
          </div>
        </div>

        {loadError && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p>{loadError}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void load()}>让智能体重试</Button>
              <Button variant="ghost" onClick={cancel}>取消</Button>
            </div>
          </div>
        )}

        {!loading && !loadError && payload && (
          <fieldset disabled={Boolean(planning || submitting)} className="mt-4 min-w-0 space-y-4 disabled:opacity-70">
            <div className="rounded-xl border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground"><Sparkles className="size-3.5 text-primary" />{payload.summary}</div>
              <p className="mt-1.5">已参考：{payload.context_sources.join("、") || "当前请求"}</p>
            </div>

            {(diagnosticStage === "loading" || diagnosticStage === "grading") && (
              <section className="flex items-center gap-3 rounded-xl border bg-muted/40 p-5 text-sm">
                <Loader2 className="size-5 animate-spin text-primary" />
                <div>
                  <h3 className="font-medium">{diagnosticStage === "loading" ? "AI 正在规划摸底题" : "正在评分并更新学情画像"}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {diagnosticStage === "loading"
                      ? "题型和题量会根据你选择的学习范围、目标及已有画像动态决定。"
                      : `已完成 ${diagnosticQuestions.length} 道题，正在汇总知识点掌握度。`}
                  </p>
                </div>
              </section>
            )}

            {diagnosticStage === "error" && (
              <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <p>{diagnosticError}</p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => diagnosticExamId && diagnosticQuestions.length > 0 ? void submitDiagnostic() : void startDiagnostic()}
                >
                  重试摸底
                </Button>
              </section>
            )}

            {diagnosticStage === "questions" && diagnosticQuestions[diagnosticIndex] && (() => {
              const question = diagnosticQuestions[diagnosticIndex];
              const answer = diagnosticAnswers[question.id] ?? "";
              return (
                <section>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium text-primary">AI 客观摸底 · {diagnosticIndex + 1}/{diagnosticQuestions.length}</p>
                      <h3 className="mt-1 font-medium leading-6">{question.stem}</h3>
                      {question.knowledge_point && <p className="mt-1 text-xs text-muted-foreground">知识点：{question.knowledge_point}</p>}
                    </div>
                    <span className="rounded-md bg-muted px-2 py-1 text-[10px] uppercase text-muted-foreground">{question.type}</span>
                  </div>
                  {question.type === "mcq" && question.options?.length ? (
                    <div className="mt-3 space-y-2">
                      {question.options.map((option, optionIndex) => {
                        const optionValue = option.match(/^([A-Da-d])(?:[.、:：\s]|$)/)?.[1]?.toUpperCase() ?? String.fromCharCode(65 + optionIndex);
                        return (
                          <button
                            key={`${question.id}-${optionIndex}`}
                            type="button"
                            onClick={() => setDiagnosticAnswers((previous) => ({ ...previous, [question.id]: optionValue }))}
                            aria-pressed={answer === optionValue}
                            className={cn("block w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors", answer === optionValue ? "border-primary bg-primary/10" : "bg-card hover:border-primary/50")}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <textarea
                      autoFocus
                      rows={question.type === "code" ? 7 : 4}
                      value={answer}
                      onChange={(event) => setDiagnosticAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))}
                      placeholder={question.type === "code" ? "输入代码或伪代码…" : "输入你的答案…"}
                      className="mt-3 w-full resize-y rounded-xl border bg-card px-3.5 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/25"
                    />
                  )}
                  <div className="mt-4 flex justify-between border-t pt-4">
                    <Button variant="outline" disabled={diagnosticIndex === 0} onClick={() => setDiagnosticIndex((currentIndex) => Math.max(0, currentIndex - 1))}>上一题</Button>
                    <Button disabled={!answer.trim()} onClick={advanceDiagnostic}>{diagnosticIndex === diagnosticQuestions.length - 1 ? "提交摸底" : "下一题"}</Button>
                  </div>
                </section>
              );
            })()}

            {diagnosticStage === "idle" && !summary && current && (
              <section>
                <h3 className="font-medium">{current.text}</h3>
                {current.reason && <p className="mt-1 text-xs text-muted-foreground">为什么要问：{current.reason}</p>}
                {current.kind === "text" ? (
                  <textarea
                    autoFocus
                    rows={4}
                    value={typeof currentAnswer === "string" ? currentAnswer : ""}
                    onChange={(event) => setSingle(current.field, event.target.value)}
                    placeholder={current.custom_placeholder || "请填写你的具体要求…"}
                    className="mt-3 w-full resize-y rounded-xl border bg-card px-3.5 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                ) : (
                  <div className="mt-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {current.options.map((option) => {
                        const checked = current.kind === "multiple" ? Array.isArray(currentAnswer) && currentAnswer.includes(option.value) : currentAnswer === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => current.kind === "multiple" ? toggleMultiple(current.field, option.value) : setSingle(current.field, option.value)}
                            className={cn("block w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors", checked ? "border-primary bg-primary/10" : "bg-card hover:border-primary/50")}
                            aria-pressed={checked}
                          >
                            <span className="font-medium">{option.label}</span>
                            {option.detail && <span className="mt-1 block text-xs text-muted-foreground">{option.detail}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {current.allow_custom && (
                      <textarea
                        rows={2}
                        value={customAnswers[current.field] ?? ""}
                        onChange={(event) => setCustomAnswers((previous) => ({ ...previous, [current.field]: event.target.value }))}
                        placeholder={current.custom_placeholder || "以上都不合适？可以自行填写…"}
                        className="mt-2 w-full resize-y rounded-xl border bg-card px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/25"
                      />
                    )}
                  </div>
                )}
              </section>
            )}

            {summary && (
              <section className="rounded-xl bg-muted p-4 text-sm">
                <h3 className="font-medium">确认摘要</h3>
                <div className="mt-2 space-y-1.5 text-foreground/85">
                  <p>确认方式：{selectedBaseline?.source === "diagnostic" ? "AI 客观摸底" : selectedBaseline?.source === "explicit_default" ? "系统默认" : "用户自评"}</p>
                  <p>当前基础：{selectedBaseline ? LEVEL_LABELS[selectedBaseline.level as keyof typeof LEVEL_LABELS] ?? selectedBaseline.level : "待确认"}</p>
                  {selectedBaseline?.source === "diagnostic" && <p>{selectedBaseline.summary} · 共 {diagnosticQuestions.length} 题</p>}
                  <p>学习目标：{GOAL_LABELS[goal as LearningPathGoal] ?? "待确认"}</p>
                  <p>学习周期：{days || "—"} 天，每天 {dailyMinutes || "—"} 分钟</p>
                  <p>资料类型：{materials.map((entry) => MATERIAL_LABELS[entry]).join("、") || "待确认"}</p>
                  {visibleQuestions.filter((question) => (answers[question.field] !== undefined || customAnswers[question.field]) && !["baseline_method", "baseline_level", "goal", "days", "daily_minutes", "material_types"].includes(question.field)).map((question) => (
                    <p key={question.field}>{question.text}：{customAnswers[question.field]?.trim() || answerLabel(question, answers[question.field])}</p>
                  ))}
                </div>
                {planning && <p className="mt-4 rounded-lg bg-background/70 p-3">正在按确认后的信息生成学习路径，请稍候。</p>}
                {planningError && (
                  <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p>{planningError.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {planningError.retryable && onRetryPlan && <Button variant="outline" onClick={onRetryPlan}>重试生成</Button>}
                      {planningError.actions?.includes("open_kb") && <Button variant="outline" onClick={onOpenKnowledgeBase}>打开知识库</Button>}
                      <Button variant="ghost" onClick={editPlan}>调整要求</Button>
                      <Button variant="ghost" onClick={cancel}>取消本次规划</Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {(diagnosticStage === "idle" || diagnosticStage === "done") && <div className="flex justify-between border-t pt-4">
              <Button variant="ghost" onClick={cancel} disabled={planning}>取消</Button>
              <div className="flex gap-2">
                {(summary || index > 0) && <Button variant="outline" onClick={previous}>上一题</Button>}
                {summary ? (
                  <Button disabled={!complete || submitting || planning || Boolean(planningError)} onClick={submit}>
                    {submitting ? "正在提交…" : "按此方案生成"}
                  </Button>
                ) : (
                  <Button disabled={!currentValid} onClick={next}>{index === visibleQuestions.length - 1 ? (baselineMethod === "diagnostic" ? "开始 AI 摸底" : "查看摘要") : "下一题"}</Button>
                )}
              </div>
            </div>}
          </fieldset>
        )}
      </div>
    </motion.section>
  );
}
