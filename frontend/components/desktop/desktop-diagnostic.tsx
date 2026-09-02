"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link } from "@/components/shell-link";
import { streamSSE } from "@/lib/api";
import {
  diagnosticAnalysisFromGrade,
  diagnosticLevelFromScore,
  normalizeDiagnosticQuestions,
  type DiagnosticExamQuestion,
  type DiagnosticGradeReport,
} from "@/lib/diagnostic-exam";
import { optionAnswerValue } from "@/lib/learning-baseline-gate";
import {
  invalidateLibraryListCache,
  type DiagnosticAnalysis,
} from "@/lib/library";
import { MASTERY_LEVELS, type MasteryLevel } from "@/lib/material-types";
import { getStudentId } from "@/lib/student-identity";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "sl_desktop_diagnostic_draft_v1";

const LEVEL_DESC: Record<MasteryLevel, string> = {
  基础: "从核心概念起步，题目以基础理解和直接应用为主",
  进阶: "覆盖主干知识，并加入综合应用与易混点",
  完全掌握: "侧重查漏补缺、复杂应用与典型陷阱",
};

const TYPE_LABEL: Record<DiagnosticExamQuestion["type"], string> = {
  mcq: "单选题",
  blank: "填空题",
  short: "简答题",
  code: "代码题",
};

const CONFIDENCE_OPTIONS = [
  { value: "certain", label: "确定" },
  { value: "unsure", label: "有点犹豫" },
  { value: "unknown", label: "不会" },
] as const;

type ConfidenceValue = (typeof CONFIDENCE_OPTIONS)[number]["value"];
type DiagnosticStage = "idle" | "generating" | "questions" | "grading" | "result" | "error";

interface DiagnosticDraft {
  subject: string;
  level: MasteryLevel;
  examId: string;
  questions: DiagnosticExamQuestion[];
  questionIndex: number;
  answers: Record<string, string>;
  confidence: Record<string, ConfidenceValue>;
  flagged: Record<string, boolean>;
  startedAt: number;
}

function draftKey(): string {
  return `${DRAFT_KEY}:${getStudentId()}`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const remainder = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function ResultChips({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  if (!items?.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item} className={cn("rounded-md px-2.5 py-1.5 text-xs", tone)}>{item}</span>
        ))}
      </div>
    </section>
  );
}

export function DesktopDiagnostic() {
  const { mode, applyAssessment } = useOrchestratorContext();
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState<MasteryLevel>("基础");
  const [stage, setStage] = useState<DiagnosticStage>("idle");
  const [examId, setExamId] = useState("");
  const [questions, setQuestions] = useState<DiagnosticExamQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, ConfidenceValue>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [savedAt, setSavedAt] = useState(0);
  const [overall, setOverall] = useState(0);
  const [analysis, setAnalysis] = useState<DiagnosticAnalysis | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey());
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<DiagnosticDraft>;
      const restoredQuestions = normalizeDiagnosticQuestions(draft.questions);
      if (!draft.examId || !draft.subject || restoredQuestions.length === 0) return;
      setSubject(draft.subject);
      if (draft.level && MASTERY_LEVELS.includes(draft.level)) setLevel(draft.level);
      setExamId(draft.examId);
      setQuestions(restoredQuestions);
      setQuestionIndex(Math.min(Number(draft.questionIndex) || 0, restoredQuestions.length - 1));
      setAnswers(draft.answers && typeof draft.answers === "object" ? draft.answers : {});
      setConfidence(draft.confidence && typeof draft.confidence === "object" ? draft.confidence : {});
      setFlagged(draft.flagged && typeof draft.flagged === "object" ? draft.flagged : {});
      setStartedAt(Number(draft.startedAt) || Date.now());
      setStage("questions");
      setSavedAt(Date.now());
    } catch {
      // A damaged draft should never block a new diagnostic.
    }
  }, []);

  useEffect(() => {
    if (stage !== "questions") return;
    const payload: DiagnosticDraft = {
      subject,
      level,
      examId,
      questions,
      questionIndex,
      answers,
      confidence,
      flagged,
      startedAt,
    };
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey(), JSON.stringify(payload));
        setSavedAt(Date.now());
      } catch {
        // Answering remains available when local storage is unavailable.
      }
    }, 240);
    return () => window.clearTimeout(timer);
  }, [answers, confidence, examId, flagged, level, questionIndex, questions, stage, startedAt, subject]);

  useEffect(() => {
    if (stage !== "questions") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const currentQuestion = questions[questionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] ?? "" : "";
  const answeredCount = useMemo(
    () => questions.filter((question) => Boolean(answers[question.id]?.trim())).length,
    [answers, questions],
  );
  const knowledgeCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => {
      const key = question.knowledge_point?.trim() || "综合应用";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()];
  }, [questions]);
  const typeDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => {
      const label = TYPE_LABEL[question.type];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts.entries()];
  }, [questions]);
  const estimatedMinutes = Math.max(8, Math.ceil(questions.length * 1.2));
  const remainingSeconds = startedAt && now
    ? Math.max(0, estimatedMinutes * 60 - Math.floor((now - startedAt) / 1000))
    : estimatedMinutes * 60;
  const masteryEntries = useMemo(
    () => Object.entries(analysis?.knowledge_seed ?? {}).sort((a, b) => b[1] - a[1]),
    [analysis],
  );
  const difficultySegments = level === "基础"
    ? [50, 30, 20]
    : level === "进阶"
      ? [25, 50, 25]
      : [20, 35, 45];

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(draftKey());
    } catch {
      // Reset still succeeds in memory.
    }
  };

  const reset = () => {
    clearDraft();
    setStage("idle");
    setExamId("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setConfidence({});
    setFlagged({});
    setStartedAt(0);
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
    setConfidence({});
    setFlagged({});
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
          if (event === "exam") generatedQuestions = normalizeDiagnosticQuestions(data.questions);
          else if (event === "done" && typeof data.exam_id === "string") generatedExamId = data.exam_id;
          else if (event === "error") streamError = typeof data.message === "string" ? data.message : "生成摸底题失败";
        },
      );
      if (streamError) throw new Error(streamError);
      if (!generatedExamId || generatedQuestions.length === 0) throw new Error("AI 未返回可用的摸底题，请重试");
      setExamId(generatedExamId);
      setQuestions(generatedQuestions);
      setStartedAt(Date.now());
      setNow(Date.now());
      invalidateLibraryListCache("papers");
      setStage("questions");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成摸底题失败，请重试");
      setStage("error");
    }
  };

  const submitDiagnostic = async () => {
    if (!examId || stage === "grading" || answeredCount < questions.length) return;
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
      invalidateLibraryListCache("papers", "assessments", "goals");
      const finalAnalysis = diagnosticAnalysisFromGrade(finalOverall, finalMastery, finalReport);
      setOverall(finalOverall);
      setAnalysis(finalAnalysis);
      applyAssessment({
        subject: subject.trim(),
        level: diagnosticLevelFromScore(finalOverall),
        gaps: finalAnalysis.gaps,
      });
      clearDraft();
      setStage("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "摸底评分失败，请重试");
      setStage("questions");
    }
  };

  const updateAnswer = (answer: string) => {
    if (!currentQuestion) return;
    setAnswers((previous) => ({ ...previous, [currentQuestion.id]: answer }));
  };

  if (stage === "idle" || stage === "generating" || stage === "error") {
    return (
      <main className="thin-scroll h-full overflow-y-auto bg-background px-6 py-6 lg:px-9">
        <div className="mx-auto max-w-[1280px]">
          <header className="rounded-2xl border bg-card px-7 py-6">
            <p className="text-xs font-semibold text-primary">学习工作台</p>
            <h1 className="mt-2 font-display text-3xl font-semibold">学情摸底</h1>
            <p className="mt-2 text-sm text-muted-foreground">先确定科目与起始难度，再生成真实测试；提交前不会提前给出学情分析。</p>
          </header>

          <div className="mt-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            <section className="rounded-2xl border bg-card p-6">
              <label className="text-xs font-semibold text-muted-foreground" htmlFor="diagnostic-subject">学习科目</label>
              <input
                id="diagnostic-subject"
                value={subject}
                disabled={stage === "generating"}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="如：数据结构 / 高等数学 / 计算机网络"
                className="mt-2 h-11 w-full rounded-lg border bg-transparent px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
              />
              <div className="mt-6">
                <p className="text-xs font-semibold text-muted-foreground">自评难度起点</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">只调节首轮题目难度，最终掌握度以答题结果为准。</p>
                <div className="mt-3 space-y-2">
                  {MASTERY_LEVELS.map((item) => {
                    const active = level === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        disabled={stage === "generating"}
                        onClick={() => setLevel(item)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60",
                          active ? "border-primary bg-primary/[0.06]" : "hover:border-primary/40",
                        )}
                      >
                        <span className={cn("mt-0.5 grid size-5 place-items-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>
                          {active && <Check className="size-3" />}
                        </span>
                        <span><strong className="block text-sm">{item}</strong><small className="mt-1 block text-xs leading-relaxed text-muted-foreground">{LEVEL_DESC[item]}</small></span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                disabled={stage === "generating" || mode !== "live" || !subject.trim()}
                onClick={() => void startDiagnostic()}
                className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
              >
                {stage === "generating" ? <Loader2 className="size-4 animate-spin" /> : <ClipboardCheck className="size-4" />}
                {stage === "generating" ? "正在生成摸底测试…" : "开始摸底"}
              </button>
              {mode !== "live" && <p className="mt-2 text-center text-xs text-danger">学习服务未连接，暂时无法生成真实测试。</p>}
            </section>

            <section className="rounded-2xl border bg-card p-7">
              <div className="flex items-center gap-2 border-b pb-4"><Sparkles className="size-4 text-primary" /><h2 className="text-sm font-semibold">测试生成说明</h2></div>
              {stage === "generating" ? (
                <div className="grid min-h-[390px] place-items-center text-center">
                  <div><Loader2 className="mx-auto size-9 animate-spin text-primary" /><h3 className="mt-4 text-base font-semibold">正在规划题型与知识覆盖</h3><p className="mt-2 text-sm text-muted-foreground">AI 正在结合科目、知识库和自评难度生成 6—15 道摸底题。</p></div>
                </div>
              ) : (
                <div className="grid min-h-[390px] content-center gap-8 lg:grid-cols-3">
                  {[
                    ["1", "生成测试", "围绕科目主干知识生成客观题"],
                    ["2", "完成作答", "答题卡自动保存进度和信心标记"],
                    ["3", "提交分析", "评分后才写入学习画像并给出建议"],
                  ].map(([index, title, detail]) => (
                    <div key={index} className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-full border border-primary/30 bg-primary/[0.06] font-display text-lg font-semibold text-primary">{index}</span><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></div>
                  ))}
                </div>
              )}
              {error && (
                <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-danger/30 bg-danger/[0.05] px-4 py-3 text-xs text-danger">
                  <span>{error}</span><button type="button" onClick={() => setStage("idle")} className="shrink-0 font-semibold underline">返回设置</button>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    );
  }

  if (stage === "grading") {
    return (
      <main className="grid h-full place-items-center bg-background p-8 text-center">
        <div><Loader2 className="mx-auto size-10 animate-spin text-primary" /><h1 className="mt-5 font-display text-2xl font-semibold">正在评分并生成学情结论</h1><p className="mt-2 text-sm text-muted-foreground">系统正在汇总知识点掌握度、错题原因和后续学习建议。</p></div>
      </main>
    );
  }

  if (stage === "result" && analysis) {
    return (
      <main className="thin-scroll h-full overflow-y-auto bg-background px-6 py-6 lg:px-9">
        <div className="mx-auto max-w-[1260px]">
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card px-7 py-6">
            <div><p className="text-xs font-semibold text-primary">{subject} · 摸底完成</p><h1 className="mt-2 font-display text-3xl font-semibold">你的客观摸底结果</h1></div>
            <button type="button" onClick={reset} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold hover:bg-accent"><RotateCcw className="size-4" />重新摸底</button>
          </header>
          <div className="mt-5 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <section className="rounded-2xl border bg-card p-6 text-center"><p className="text-xs text-muted-foreground">客观摸底得分</p><strong className="mt-3 block font-display text-6xl text-primary">{Math.round(overall)}</strong><p className="mt-2 text-sm font-semibold">{diagnosticLevelFromScore(overall)}</p></section>
            <section className="space-y-5 rounded-2xl border bg-card p-6">
              <div><h2 className="text-base font-semibold">{analysis.summary}</h2>{analysis.narrative && <p className="mt-2 text-sm leading-7 text-muted-foreground">{analysis.narrative}</p>}</div>
              <ResultChips title="已掌握" items={analysis.strengths} tone="bg-success/10 text-success" />
              <ResultChips title="薄弱环节" items={analysis.gaps} tone="bg-danger/10 text-danger" />
              <ResultChips title="下一步建议" items={analysis.recommended_focus} tone="bg-primary/10 text-primary" />
              {masteryEntries.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{masteryEntries.map(([point, score]) => <div key={point} className="rounded-xl border p-3"><div className="flex justify-between gap-3 text-xs"><span>{point}</span><strong>{Math.round(score * 100)}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${score * 100}%` }} /></div></div>)}</div>}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-success/30 bg-success/[0.05] px-4 py-3 text-xs"><CheckCircle2 className="size-4 text-success" /><span>测试评分与知识点掌握度已写入学习画像。</span><Link href="/profile" className="ml-auto inline-flex items-center gap-1 font-semibold text-primary">看画像<ArrowUpRight className="size-3.5" /></Link><Link href="/create" className="inline-flex items-center gap-1 font-semibold text-primary">生成针对性资料<ArrowUpRight className="size-3.5" /></Link></div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full min-h-0 overflow-hidden bg-background p-4 xl:p-5">
      <div className="mx-auto flex h-full max-w-[1500px] min-h-0 flex-col gap-4">
        <header className="flex shrink-0 items-center gap-5 rounded-2xl border bg-card px-5 py-4">
          <div className="min-w-[230px]"><h1 className="font-display text-xl font-semibold">{subject} · {level}摸底</h1><p className="mt-1 text-xs text-muted-foreground">{questions.length} 道题 · 预计 {estimatedMinutes} 分钟</p></div>
          <div className="flex min-w-0 flex-1 items-center gap-4"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }} /></div><strong className="shrink-0 text-sm text-primary">{questionIndex + 1} / {questions.length}</strong></div>
          <div className="flex min-w-[155px] items-center justify-end gap-2 text-xs text-muted-foreground"><Save className="size-4" /><span>{savedAt ? "已自动保存" : "正在保存"}</span></div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[250px_minmax(0,1fr)_280px]">
          <aside className="thin-scroll min-h-0 overflow-y-auto rounded-2xl border bg-card p-5" aria-label="答题卡">
            <h2 className="text-base font-semibold">答题卡</h2>
            <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-success" />已答</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary" />当前</span><span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm border bg-background" />未答</span></div>
            <div className="mt-5 grid grid-cols-4 gap-2.5">{questions.map((question, index) => {
              const isCurrent = index === questionIndex;
              const answered = Boolean(answers[question.id]?.trim());
              return <button key={question.id} type="button" onClick={() => setQuestionIndex(index)} aria-current={isCurrent ? "step" : undefined} className={cn("relative grid aspect-square place-items-center rounded-lg border text-sm font-semibold transition-colors", isCurrent ? "border-primary bg-primary/[0.06] text-primary ring-1 ring-primary/20" : answered ? "border-success/35 bg-success/[0.06]" : "bg-background hover:border-primary/40")}>{index + 1}{answered && !isCurrent && <Check className="absolute bottom-1 right-1 size-3 text-success" />}</button>;
            })}</div>
            <div className="mt-6 border-t pt-5"><h3 className="text-sm font-semibold">知识点覆盖</h3><div className="mt-3 flex flex-wrap gap-2">{knowledgeCoverage.map(([point, count]) => <span key={point} className="rounded-full bg-muted px-2.5 py-1 text-[11px]">{point}<b className="ml-1.5 text-primary">{count} 题</b></span>)}</div></div>
            <div className="mt-6 rounded-xl border bg-background p-4 text-center"><div className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-4 text-primary" />剩余时间</div><strong className="mt-2 block font-mono text-2xl tracking-wide text-primary">{formatDuration(remainingSeconds)}</strong></div>
            <Link href="/" className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border bg-background text-xs font-semibold hover:bg-accent"><Save className="size-4" />暂存并退出</Link>
          </aside>

          <section className="flex min-h-0 flex-col rounded-2xl border bg-card p-5 xl:p-6" aria-label="当前题目">
            {error && <div className="mb-4 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/[0.05] px-3 py-2 text-xs text-danger"><span>{error}</span><button type="button" onClick={() => setError("")} className="shrink-0 font-semibold underline">关闭</button></div>}
            <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">第 {questionIndex + 1} 题 · {currentQuestion ? TYPE_LABEL[currentQuestion.type] : ""}{currentQuestion?.knowledge_point ? ` · ${currentQuestion.knowledge_point}` : ""}</p></div>{currentQuestion && <button type="button" aria-pressed={Boolean(flagged[currentQuestion.id])} onClick={() => setFlagged((previous) => ({ ...previous, [currentQuestion.id]: !previous[currentQuestion.id] }))} className={cn("inline-flex items-center gap-1.5 text-xs hover:text-foreground", flagged[currentQuestion.id] ? "text-primary" : "text-muted-foreground")}><Bookmark className={cn("size-4", flagged[currentQuestion.id] && "fill-current")} />{flagged[currentQuestion.id] ? "已标记" : "标记"}</button>}</div>
            {currentQuestion && <div className="thin-scroll mt-5 min-h-0 flex-1 overflow-y-auto pr-1"><h2 className="text-[15px] font-medium leading-7">{currentQuestion.stem}</h2>{currentQuestion.type === "mcq" && currentQuestion.options?.length ? <div className="mt-5 space-y-3">{currentQuestion.options.map((option, optionIndex) => { const value = optionAnswerValue(option, optionIndex); const selected = currentAnswer === value; return <button key={`${currentQuestion.id}-${optionIndex}`} type="button" aria-pressed={selected} onClick={() => updateAnswer(value)} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors", selected ? "border-primary bg-primary/[0.06] ring-1 ring-primary/15" : "bg-background hover:border-primary/45")}><span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", selected && "border-primary bg-primary text-primary-foreground")}>{selected && <Check className="size-3" />}</span><span>{option}</span></button>; })}</div> : <textarea autoFocus value={currentAnswer} onChange={(event) => updateAnswer(event.target.value)} rows={currentQuestion.type === "code" ? 10 : 6} placeholder={currentQuestion.type === "code" ? "输入代码或伪代码…" : "输入你的答案…"} className="mt-5 w-full resize-y rounded-xl border bg-background px-4 py-3 font-mono text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />}</div>}
            {currentQuestion && <div className="mt-5 shrink-0 border-t pt-4"><div className="flex flex-wrap items-center gap-2"><span className="mr-2 text-xs text-muted-foreground">这题我：</span>{CONFIDENCE_OPTIONS.map((item) => <button key={item.value} type="button" onClick={() => setConfidence((previous) => ({ ...previous, [currentQuestion.id]: item.value }))} className={cn("rounded-lg border px-3 py-2 text-xs transition-colors", confidence[currentQuestion.id] === item.value ? "border-primary bg-primary/[0.07] text-primary" : "bg-background hover:border-primary/40")}>{item.label}</button>)}</div><div className="mt-5 flex items-center justify-between"><button type="button" disabled={questionIndex === 0} onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))} className="inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-semibold disabled:opacity-40"><ArrowLeft className="size-4" />上一题</button>{questionIndex < questions.length - 1 ? <button type="button" disabled={!currentAnswer.trim()} onClick={() => setQuestionIndex((index) => index + 1)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40">下一题<ArrowRight className="size-4" /></button> : <button type="button" disabled={answeredCount < questions.length} onClick={() => void submitDiagnostic()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-40"><ClipboardCheck className="size-4" />提交测试</button>}</div></div>}
          </section>

          <aside className="thin-scroll col-span-2 min-h-0 overflow-y-auto rounded-2xl border bg-card p-5 xl:col-span-1" aria-label="本次摸底蓝图">
            <div className="flex items-center gap-2"><BarChart3 className="size-4 text-primary" /><h2 className="text-base font-semibold">本次摸底</h2></div>
            <div className="mt-5 border-t pt-5"><h3 className="text-sm font-semibold">蓝图概览</h3><dl className="mt-3 space-y-3 text-xs"><div className="flex justify-between"><dt className="text-muted-foreground">题目总数</dt><dd>{questions.length} 道</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">预计时长</dt><dd>{estimatedMinutes} 分钟</dd></div><div className="flex justify-between gap-4"><dt className="text-muted-foreground">题型分布</dt><dd className="text-right">{typeDistribution.map(([type, count]) => `${type} ${count} 道`).join(" · ")}</dd></div></dl></div>
            <div className="mt-6"><h3 className="text-sm font-semibold">难度分布</h3><div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted"><span className="bg-primary/90" style={{ width: `${difficultySegments[0]}%` }} /><span className="bg-[#b88a4c]" style={{ width: `${difficultySegments[1]}%` }} /><span className="bg-[#8a8174]" style={{ width: `${difficultySegments[2]}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>基础 {difficultySegments[0]}%</span><span>进阶 {difficultySegments[1]}%</span><span>挑战 {difficultySegments[2]}%</span></div></div>
            <div className="mt-6"><h3 className="text-sm font-semibold">知识点覆盖</h3><div className="mt-3 space-y-2.5">{knowledgeCoverage.map(([point, count]) => <div key={point} className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{point}</span><span>{count} 道（{Math.round((count / questions.length) * 100)}%）</span></div>)}</div></div>
            <div className="mt-6"><h3 className="text-sm font-semibold">作答进度</h3><div className="mt-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">已完成</span><strong>{answeredCount} / {questions.length}</strong></div><div className="mt-2 grid grid-cols-10 gap-1">{questions.map((question) => <span key={question.id} className={cn("h-4 rounded-sm border", answers[question.id]?.trim() && "border-success bg-success")} />)}</div></div>
            <div className="mt-7 rounded-xl border border-primary/20 bg-primary/[0.055] p-4 text-xs leading-6 text-primary"><div className="flex gap-2"><Sparkles className="mt-1 size-4 shrink-0" /><p>完成全部题目并提交后，才生成学情分析并写入学习画像。</p></div></div>
          </aside>
        </div>
      </div>
    </main>
  );
}
