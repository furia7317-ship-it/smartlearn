"use client";

import { useMemo, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Button } from "@/components/ui/button";
import { streamSSE } from "@/lib/api";
import {
  diagnosticAnalysisFromGrade,
  diagnosticLevelFromScore,
  normalizeDiagnosticQuestions,
  type DiagnosticExamQuestion,
  type DiagnosticGradeReport,
} from "@/lib/diagnostic-exam";
import { optionAnswerValue } from "@/lib/learning-baseline-gate";
import { type DiagnosticAnalysis } from "@/lib/library";
import { MASTERY_LEVELS, type MasteryLevel } from "@/lib/material-types";
import { getStudentId } from "@/lib/student-identity";
import { cn } from "@/lib/utils";

const LEVEL_DESC: Record<MasteryLevel, string> = {
  基础: "从核心概念起步，题目以基础理解和直接应用为主",
  进阶: "覆盖主干知识，并加入综合应用与易混点",
  完全掌握: "侧重查漏补缺、复杂应用与典型陷阱",
};

const TYPE_LABEL: Record<DiagnosticExamQuestion["type"], string> = {
  mcq: "选择题",
  blank: "填空题",
  short: "简答题",
  code: "代码题",
};

type DiagnosticStage = "idle" | "generating" | "questions" | "grading" | "result" | "error";

function Chips({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-muted-foreground">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={cn("rounded-md px-2 py-1 text-[11px]", tone)}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function DiagnosticPage() {
  const { mode, applyAssessment } = useOrchestratorContext();

  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState<MasteryLevel>("基础");
  const [stage, setStage] = useState<DiagnosticStage>("idle");
  const [examId, setExamId] = useState("");
  const [questions, setQuestions] = useState<DiagnosticExamQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [overall, setOverall] = useState(0);
  const [analysis, setAnalysis] = useState<DiagnosticAnalysis | null>(null);
  const [error, setError] = useState("");

  const currentQuestion = questions[questionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] ?? "" : "";
  const canStart = mode === "live"
    && subject.trim().length > 0
    && (stage === "idle" || stage === "error");
  const configLocked = !["idle", "error"].includes(stage);
  const progress = questions.length > 0 ? ((questionIndex + 1) / questions.length) * 100 : 0;
  const masteryEntries = useMemo(
    () => Object.entries(analysis?.knowledge_seed ?? {}).sort((a, b) => b[1] - a[1]),
    [analysis],
  );

  const reset = () => {
    setStage("idle");
    setExamId("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setOverall(0);
    setAnalysis(null);
    setError("");
  };

  const startDiagnostic = async () => {
    if (!subject.trim()) return;
    if (mode !== "live") {
      setError("后端未连接，无法生成真实摸底测试。请先启动本地后端。");
      setStage("error");
      return;
    }

    const topic = subject.trim();
    setStage("generating");
    setError("");
    setExamId("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setOverall(0);
    setAnalysis(null);

    let generatedExamId = "";
    let generatedQuestions: DiagnosticExamQuestion[] = [];
    let streamError = "";
    try {
      await streamSSE(
        "/api/assess/exam",
        {
          topic,
          student_id: getStudentId(),
          scope_points: [`学生自评为“${level}”，仅用于调节起始难度，不作为评分依据。`],
          paper_type: "adaptive",
          category: "学情摸底",
        },
        ({ event, data }) => {
          if (event === "exam") {
            generatedQuestions = normalizeDiagnosticQuestions(data.questions);
          } else if (event === "done" && typeof data.exam_id === "string") {
            generatedExamId = data.exam_id;
          } else if (event === "error") {
            streamError = typeof data.message === "string" ? data.message : "生成摸底题失败";
          }
        },
      );
      if (streamError) throw new Error(streamError);
      if (!generatedExamId || generatedQuestions.length === 0) {
        throw new Error("AI 未返回可用的摸底题，请重试");
      }
      setExamId(generatedExamId);
      setQuestions(generatedQuestions);
      setStage("questions");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成摸底题失败，请重试");
      setStage("error");
    }
  };

  const submitDiagnostic = async () => {
    if (!examId || stage === "grading") return;
    setStage("grading");
    setError("");

    let graded = false;
    let finalOverall = 0;
    let finalMastery: Record<string, unknown> = {};
    let finalReport: DiagnosticGradeReport | null = null;
    let streamError = "";
    try {
      await streamSSE(
        `/api/assess/${encodeURIComponent(examId)}/submit`,
        { student_id: getStudentId(), answers },
        ({ event, data }) => {
          if (event === "graded" && data.results && typeof data.results === "object") {
            const results = data.results as Record<string, unknown>;
            finalOverall = Number(results.overall) || 0;
            finalMastery = results.mastery && typeof results.mastery === "object"
              ? results.mastery as Record<string, unknown>
              : {};
            graded = true;
          } else if (event === "report" && data.assessment && typeof data.assessment === "object") {
            finalReport = data.assessment as DiagnosticGradeReport;
          } else if (event === "error") {
            streamError = typeof data.message === "string" ? data.message : "摸底评分失败";
          }
        },
      );
      if (streamError) throw new Error(streamError);
      if (!graded) throw new Error("后端未返回摸底评分，请重试提交");

      const finalAnalysis = diagnosticAnalysisFromGrade(finalOverall, finalMastery, finalReport);
      setOverall(finalOverall);
      setAnalysis(finalAnalysis);
      applyAssessment({
        subject: subject.trim(),
        level: diagnosticLevelFromScore(finalOverall),
        gaps: finalAnalysis.gaps,
      });
      setStage("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "摸底评分失败，请重试");
      setStage("error");
    }
  };

  const updateAnswer = (answer: string) => {
    if (!currentQuestion) return;
    setAnswers((previous) => ({ ...previous, [currentQuestion.id]: answer }));
  };

  const inputCls =
    "w-full rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="学情摸底"
          desc="选择科目与自评难度后生成客观摸底测试；完成作答和评分后，结果才会写入学习画像"
        />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">学习科目</label>
              <input
                value={subject}
                disabled={configLocked}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="如：数据结构 / 高等数学 / 计算机网络"
                className={cn(inputCls, "mt-1.5")}
              />
            </div>

            <div>
              <label className="text-[12px] font-medium text-muted-foreground">自评难度起点</label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">只用于调节首轮题目难度，最终掌握度以答题结果为准。</p>
              <div className="mt-2 space-y-1.5">
                {MASTERY_LEVELS.map((item) => {
                  const active = level === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={configLocked}
                      onClick={() => setLevel(item)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                        active ? "border-primary bg-primary/[0.06]" : "hover:border-primary/40",
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                        active ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                      )}>
                        {active && <Check className="size-3" />}
                      </span>
                      <span>
                        <span className="text-[13px] font-medium">{item}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{LEVEL_DESC[item]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {stage === "result" ? (
              <Button onClick={reset} variant="outline" className="w-full gap-1.5">
                <RotateCcw className="size-4" />重新设置并测试
              </Button>
            ) : (
              <Button onClick={() => void startDiagnostic()} disabled={!canStart} className="w-full gap-1.5">
                {stage === "generating" ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
                {stage === "generating" ? "正在生成摸底题…" : "开始摸底"}
              </Button>
            )}

            {stage === "questions" && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                正在作答第 {questionIndex + 1} / {questions.length} 题，全部提交后才生成学情结论。
              </div>
            )}
            {stage === "grading" && (
              <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />正在评分并更新学习画像…
              </div>
            )}
          </section>

          <section className="min-h-[420px] rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2 border-b pb-3">
              <Sparkles className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">
                {stage === "result" ? "摸底结果" : "摸底测试"}
              </h2>
            </div>

            {stage === "idle" && (
              <div className="grid place-items-center px-4 py-20 text-center">
                <ClipboardCheck className="size-8 text-muted-foreground/50" />
                <h3 className="mt-3 text-sm font-medium">尚未生成摸底测试</h3>
                <p className="mt-2 max-w-[32em] text-[13px] leading-relaxed text-muted-foreground">
                  点击左侧「开始摸底」后，AI 会结合科目、知识库和你的自评难度生成 6—15 道客观摸底题。完成测试前不会提前给出学情分析。
                </p>
              </div>
            )}

            {stage === "generating" && (
              <div className="grid place-items-center px-4 py-20 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <h3 className="mt-3 text-sm font-medium">AI 正在生成摸底测试</h3>
                <p className="mt-2 text-[12px] text-muted-foreground">正在根据科目范围规划题型、知识点与题量，请稍候。</p>
              </div>
            )}

            {stage === "questions" && currentQuestion && (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-medium text-primary">第 {questionIndex + 1} 题 / 共 {questions.length} 题</p>
                    <h3 className="mt-1.5 text-[15px] font-medium leading-7">{currentQuestion.stem}</h3>
                    {currentQuestion.knowledge_point && (
                      <p className="mt-1 text-[11px] text-muted-foreground">考查知识点：{currentQuestion.knowledge_point}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                    {TYPE_LABEL[currentQuestion.type]}
                  </span>
                </div>

                {currentQuestion.type === "mcq" && currentQuestion.options?.length ? (
                  <div className="mt-4 space-y-2">
                    {currentQuestion.options.map((option, optionIndex) => {
                      const value = optionAnswerValue(option, optionIndex);
                      return (
                        <button
                          key={`${currentQuestion.id}-${optionIndex}`}
                          type="button"
                          aria-pressed={currentAnswer === value}
                          onClick={() => updateAnswer(value)}
                          className={cn(
                            "block w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                            currentAnswer === value ? "border-primary bg-primary/10" : "hover:border-primary/50",
                          )}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    autoFocus
                    rows={currentQuestion.type === "code" ? 9 : 5}
                    value={currentAnswer}
                    onChange={(event) => updateAnswer(event.target.value)}
                    placeholder={currentQuestion.type === "code" ? "输入代码或伪代码…" : "输入你的答案…"}
                    className="mt-4 w-full resize-y rounded-xl border bg-card px-3.5 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-primary/25"
                  />
                )}

                <div className="mt-5 flex items-center justify-between border-t pt-4">
                  <Button
                    variant="outline"
                    disabled={questionIndex === 0}
                    onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
                    className="gap-1.5"
                  >
                    <ArrowLeft className="size-3.5" />上一题
                  </Button>
                  {questionIndex < questions.length - 1 ? (
                    <Button
                      disabled={!currentAnswer.trim()}
                      onClick={() => setQuestionIndex((index) => index + 1)}
                      className="gap-1.5"
                    >
                      下一题<ArrowRight className="size-3.5" />
                    </Button>
                  ) : (
                    <Button disabled={!currentAnswer.trim()} onClick={() => void submitDiagnostic()}>
                      提交摸底测试
                    </Button>
                  )}
                </div>
              </div>
            )}

            {stage === "grading" && (
              <div className="grid place-items-center px-4 py-20 text-center">
                <Loader2 className="size-8 animate-spin text-primary" />
                <h3 className="mt-3 text-sm font-medium">正在评分并生成学情结论</h3>
                <p className="mt-2 text-[12px] text-muted-foreground">系统正在汇总各知识点掌握度、错题原因与后续学习建议。</p>
              </div>
            )}

            {stage === "error" && (
              <div className="grid place-items-center px-4 py-16 text-center">
                <p className="max-w-lg rounded-lg border border-danger/30 bg-danger/[0.05] px-4 py-3 text-[12px] leading-6 text-danger">
                  {error}
                </p>
                <Button className="mt-4" variant="outline" onClick={() => void startDiagnostic()}>
                  重新生成摸底测试
                </Button>
              </div>
            )}

            {stage === "result" && analysis && (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <div className="rounded-xl border bg-muted/30 p-4 text-center">
                    <p className="text-[11px] text-muted-foreground">客观摸底得分</p>
                    <div className="mt-1 text-4xl font-semibold text-primary">{Math.round(overall)}</div>
                    <p className="mt-1 text-[12px] text-muted-foreground">{diagnosticLevelFromScore(overall)}</p>
                  </div>
                  <div className="rounded-xl border p-4">
                    <h3 className="text-sm font-semibold">{analysis.summary}</h3>
                    {analysis.narrative && <p className="mt-2 text-[12px] leading-6 text-muted-foreground">{analysis.narrative}</p>}
                  </div>
                </div>

                <Chips title="已掌握" items={analysis.strengths} tone="bg-success/10 text-success" />
                <Chips title="薄弱环节" items={analysis.gaps} tone="bg-danger/10 text-danger" />
                <Chips title="下一步建议" items={analysis.recommended_focus} tone="bg-primary/10 text-primary" />

                {masteryEntries.length > 0 && (
                  <div>
                    <div className="mb-2 text-[12px] font-semibold text-muted-foreground">知识点掌握度</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {masteryEntries.map(([knowledgePoint, score]) => (
                        <div key={knowledgePoint} className="rounded-lg border px-3 py-2">
                          <div className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="truncate">{knowledgePoint}</span>
                            <strong>{Math.round(score * 100)}%</strong>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${score * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success/[0.05] px-3.5 py-2.5 text-[12px]">
                  <Check className="size-4 text-success" />
                  <span className="text-foreground/85">测试评分与知识点掌握度已写入学习画像。</span>
                  <Link href="/profile" className="ml-auto flex items-center gap-0.5 font-medium text-primary hover:underline">
                    看画像 <ArrowUpRight className="size-3.5" />
                  </Link>
                  <Link href="/create" className="flex items-center gap-0.5 font-medium text-primary hover:underline">
                    生成针对性资料 <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
