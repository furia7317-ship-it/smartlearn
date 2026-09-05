"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Code2,
  FileCode2,
  Gauge,
  Lightbulb,
  ListChecks,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  TerminalSquare,
  Trophy,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import {
  executeCodeWithReview,
  generateCodeExercise,
  getLatestCodeExercise,
  submitCodeExercise,
  type CodeExecutionResponse,
  type CodeExercise,
  type CodeExerciseSubmission,
} from "@/lib/code-lab";
import { buildDailyTaskPlan } from "@/lib/daily-task-plan";
import { getStudentId } from "@/lib/student-identity";
import { localDateKey, pathScheduleCurrentIndex } from "@/lib/path-schedule-clock";
import { cn } from "@/lib/utils";

const CODE_STORAGE_KEY = "sl_python_code_lab_v2";
const STARTER_CODE = `def average(numbers):
    total = sum(numbers)
    return total / len(numbers)


scores = [86, 92, 78, 95]
print("平均分:", average(scores))`;

function storageKey(exerciseId?: string): string {
  return exerciseId ? `${CODE_STORAGE_KEY}:${exerciseId}` : CODE_STORAGE_KEY;
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

export function DesktopCodeLab() {
  const session = useOrchestratorContext((state) => ({
    masterPath: state.masterPath,
    path: state.path,
    masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    pathScheduleAnchor: state.pathScheduleAnchor,
    completedMaterials: state.completedMaterials,
    hydrated: state.hydrated,
    recordCodePractice: state.recordCodePractice,
    recordTaskEvidence: state.recordTaskEvidence,
  }));
  const learningDate = localDateKey();
  const [code, setCode] = useState(STARTER_CODE);
  const [exercise, setExercise] = useState<CodeExercise | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeExecutionResponse | CodeExerciseSubmission | null>(null);
  const [requestError, setRequestError] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [terminalOpen, setTerminalOpen] = useState(true);

  const todayLearning = useMemo(() => {
    const path = session.masterPath.length > 0 ? session.masterPath : session.path;
    const anchor = session.masterPath.length > 0
      ? session.masterPathScheduleAnchor
      : session.pathScheduleAnchor;
    const index = pathScheduleCurrentIndex(path, anchor);
    const step = index >= 0 ? path[index] : undefined;
    if (!step) {
      return {
        title: "Python 基础编程",
        context: "当前尚未启用学习路径。请生成一道适合高校学生的 Python 基础函数题。",
        hasPlan: false,
        taskKey: "",
        taskCompleted: false,
      };
    }
    const plan = buildDailyTaskPlan(step, index, session.completedMaterials);
    const assignedCodeTask = plan.tasks.find((task) =>
      task.resourceTypes.includes("code") || task.title.includes("代码挑战")
    );
    const tasks = (step.steps ?? []).map((task) => [
      task.title,
      task.detail,
      ...(task.prompts ?? []),
    ].filter(Boolean).join("："));
    return {
      title: assignedCodeTask?.title || step.title,
      context: [
        `${step.day}：${step.title}`,
        step.objective || step.desc,
        assignedCodeTask
          ? `学习路径派发的代码任务：${assignedCodeTask.title}；${assignedCodeTask.detail}`
          : "",
        ...tasks,
        ...(step.subject_titles ?? []).map((subject) => `所属科目：${subject}`),
      ].filter(Boolean).join("\n"),
      hasPlan: true,
      taskKey: assignedCodeTask?.key || "",
      taskCompleted: assignedCodeTask?.completed ?? false,
    };
  }, [
    session.masterPath,
    session.masterPathScheduleAnchor,
    session.path,
    session.pathScheduleAnchor,
    session.completedMaterials,
  ]);

  useEffect(() => {
    if (!session.hydrated) return;
    let cancelled = false;
    setRestoring(true);
    getLatestCodeExercise(getStudentId(), learningDate)
      .then((latest) => {
        if (cancelled || !latest) return;
        setExercise(latest);
        try {
          setCode(window.localStorage.getItem(storageKey(latest.id)) || latest.starter_code);
        } catch {
          setCode(latest.starter_code);
        }
      })
      .catch((error) => {
        if (!cancelled) setRequestError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [learningDate, session.hydrated]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey(exercise?.id), code);
      } catch {
        // Editing remains available without local draft persistence.
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [code, exercise?.id]);

  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(1, code.split(/\r?\n/).length) }, (_, index) => index + 1),
    [code],
  );

  const generate = async () => {
    if (generating || running) return;
    setGenerating(true);
    setRequestError("");
    setResult(null);
    try {
      const created = await generateCodeExercise({
        learningDate,
        contextTitle: todayLearning.title,
        learningContext: todayLearning.context,
      });
      setExercise(created);
      setCode(created.starter_code);
      try {
        window.localStorage.removeItem(storageKey(created.id));
      } catch {
        // The fresh starter still remains in memory.
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  const run = async () => {
    if (!code.trim() || running || generating) return;
    setRunning(true);
    setRequestError("");
    setResult(null);
    try {
      if (exercise) {
        const submission = await submitCodeExercise(exercise.id, code);
        setResult(submission);
        session.recordCodePractice({
          title: exercise.title,
          score: submission.score,
          passed: submission.passed,
          passedTests: submission.passed_tests,
          totalTests: submission.total_tests,
          knowledgePoints: exercise.knowledge_points,
        });
        if (todayLearning.taskKey) {
          session.recordTaskEvidence(
            todayLearning.taskKey,
            `已提交代码挑战《${exercise.title}》：隐藏测试 ${submission.passed_tests}/${submission.total_tests} 通过，得分 ${submission.score}`,
            "written_response",
            submission.passed,
            submission.passed,
          );
        }
      } else {
        setResult(await executeCodeWithReview(code, "用户在代码挑战中进行自由 Python 练习。"));
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setCode(exercise?.starter_code || STARTER_CODE);
    setResult(null);
    setRequestError("");
  };

  const execution = result?.execution;
  const diagnosis = result?.diagnosis;
  const submission = result && "score" in result ? result : null;
  const canGenerateFollowup = Boolean(submission?.passed || todayLearning.taskCompleted);
  const challengeStep = running ? 2 : submission ? 3 : exercise ? 1 : 0;
  const visibleTestCount = Math.min(12, submission?.total_tests ?? exercise?.test_count ?? 12);

  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b bg-card px-5 py-3">
        <div className="grid size-9 place-items-center rounded-lg bg-zinc-900 text-white"><Code2 className="size-[18px]" /></div>
        <div className="min-w-0 flex-1"><h1 className="text-base font-semibold">代码挑战</h1><p className="truncate text-[11px] text-muted-foreground">通过实战编程解决真实问题，提升算法与编码能力 · 今日：{todayLearning.title}</p></div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">语言<select className="h-9 rounded-lg border bg-background px-3 text-xs text-foreground" value="python" disabled><option value="python">Python 3</option></select></label>
        <button type="button" title="恢复题目初始代码" aria-label="恢复题目初始代码" onClick={reset} className="grid size-9 place-items-center rounded-lg border bg-background hover:bg-accent"><RotateCcw className="size-4" /></button>
        <button
          type="button"
          onClick={() => void (exercise && !canGenerateFollowup ? run() : generate())}
          disabled={running || generating || restoring || (Boolean(exercise) && !canGenerateFollowup && !code.trim())}
          className="inline-flex h-10 min-w-[126px] items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {running || generating
            ? <Loader2 className="size-4 animate-spin" />
            : exercise && !canGenerateFollowup
              ? <Play className="size-4" />
              : <Sparkles className="size-4" />}
          {generating
            ? "AI 正在出题"
            : running
              ? "提交与评分中"
              : canGenerateFollowup
                ? "根据今日所学再出一题"
                : exercise
                  ? "提交并评分"
                  : todayLearning.taskKey
                    ? "生成路径代码题"
                    : "生成今日挑战"}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(400px,1fr)_270px] 2xl:grid-cols-[270px_minmax(520px,1fr)_310px]">
        <aside className="thin-scroll min-h-0 overflow-y-auto border-r bg-card px-5 py-5" aria-label="代码题说明">
          <ol className="grid grid-cols-4 gap-1 border-b pb-5" aria-label="挑战进度">
            {["读题", "编码", "运行", "复盘"].map((label, index) => (
              <li key={label} className={cn("text-center text-[10px]", index === challengeStep ? "font-semibold text-primary" : index < challengeStep ? "text-success" : "text-muted-foreground")}>
                <span className={cn("mx-auto mb-1.5 grid size-7 place-items-center rounded-full border text-xs", index === challengeStep ? "border-primary bg-primary text-primary-foreground" : index < challengeStep ? "border-success bg-success/[0.08] text-success" : "bg-background")}>{index < challengeStep ? <CheckCircle2 className="size-3.5" /> : index + 1}</span>{label}
              </li>
            ))}
          </ol>

          {restoring ? <div className="grid min-h-64 place-items-center text-center text-xs text-muted-foreground"><div><Loader2 className="mx-auto size-6 animate-spin text-primary" /><p className="mt-3">正在恢复今天的代码题…</p></div></div> : exercise ? <div className="mt-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold text-primary">{todayLearning.taskKey ? "学习路径任务" : "今日挑战"}</p><h2 className="mt-1 font-display text-xl font-semibold leading-tight">{exercise.title}</h2></div>{canGenerateFollowup && <span className="shrink-0 rounded-md border border-success/30 bg-success/[0.07] px-2 py-1.5 text-[10px] font-semibold text-success">已完成，可再练</span>}</div>
            <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-md bg-[#f4e4c9] px-2 py-1 text-[10px] font-semibold text-[#9a651f]">{exercise.difficulty}</span>{exercise.knowledge_points.map((item) => <span key={item} className="rounded-md bg-muted px-2 py-1 text-[10px]">{item}</span>)}</div>
            <section className="mt-5"><h3 className="flex items-center gap-2 text-xs font-semibold"><BookOpenCheck className="size-4 text-primary" />题目描述</h3><p className="mt-2 text-xs leading-6 text-foreground/80">{exercise.prompt}</p></section>
            <section className="mt-5"><h3 className="flex items-center gap-2 text-xs font-semibold"><ListChecks className="size-4 text-primary" />要求</h3><ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-foreground/75">{exercise.constraints.slice(0, 5).map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /><span>{item}</span></li>)}</ul></section>
            <section className="mt-5"><h3 className="text-xs font-semibold">示例</h3><div className="mt-2 space-y-3">{exercise.examples.slice(0, 2).map((example, index) => <div key={index} className="rounded-lg border bg-background p-3 font-mono text-[10px] leading-5"><div><span className="text-muted-foreground">输入</span> {displayValue(example.input)}</div><div><span className="text-muted-foreground">输出</span> {displayValue(example.output)}</div></div>)}</div></section>
            {exercise.ai_status !== "completed" && <p className="mt-5 rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-[10px] leading-relaxed text-warning">{exercise.ai_status === "fallback" ? "AI 题目未通过校验，已切换安全题。" : "AI 暂不可用，已使用安全题。"}</p>}
          </div> : <div className="grid min-h-[420px] content-center text-center"><Sparkles className="mx-auto size-7 text-primary" /><h2 className="mt-4 text-sm font-semibold">根据今天的学习内容生成挑战</h2><p className="mt-2 text-xs leading-6 text-muted-foreground">AI 会读取今日学习路径，生成函数题和隐藏测试；点击右上角“生成今日挑战”开始。</p></div>}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col border-r" aria-label="Python 编辑器与运行输出">
          <div className="flex h-11 shrink-0 items-center justify-between border-b bg-card px-3 text-[11px] text-muted-foreground"><div className="flex h-full items-center gap-2 border-b-2 border-primary px-2 font-mono text-foreground"><FileCode2 className="size-3.5 text-primary" />main.py</div><span>Ctrl + Enter 提交并评分</span></div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-zinc-950">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 overflow-hidden border-r border-white/10 bg-zinc-950/95 pt-4 text-right font-mono text-[13px] leading-6 text-zinc-600"><div style={{ transform: `translateY(${-scrollTop}px)` }}>{lineNumbers.map((line) => <div key={line} className="h-6 pr-3">{line}</div>)}</div></div>
            <textarea
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void (exercise && !canGenerateFollowup ? run() : generate()); }
                if (event.key === "Tab") { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; setCode(`${code.slice(0, start)}    ${code.slice(end)}`); window.requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 4; }); }
              }}
              spellCheck={false}
              aria-label="Python 代码编辑器"
              className="desktop-code-editor thin-scroll absolute inset-0 resize-none py-4 pl-16 pr-5 font-mono text-[13px] leading-6 outline-none selection:bg-primary/60"
            />
          </div>
          <section className={cn("shrink-0 border-t border-zinc-700 bg-zinc-900 text-zinc-100 transition-[height]", terminalOpen ? "h-[210px]" : "h-11")} aria-label="运行输出">
            <button type="button" onClick={() => setTerminalOpen((value) => !value)} className="flex h-11 w-full items-center gap-2 px-4 text-left text-xs font-semibold"><TerminalSquare className="size-4 text-amber-400" />运行输出<span className="text-zinc-500">（{submission ? `共 ${submission.total_tests} 个测试用例` : "等待运行"}）</span>{execution && <span className="ml-auto mr-3 text-[10px] font-normal text-zinc-500">{execution.execution_time_ms.toFixed(1)} ms</span>}{terminalOpen ? <ChevronDown className="ml-auto size-4" /> : <ChevronUp className="ml-auto size-4" />}</button>
            {terminalOpen && <pre className={cn("thin-scroll h-[165px] overflow-auto whitespace-pre-wrap border-t border-white/10 px-4 py-3 font-mono text-[11px] leading-6", execution?.error ? "text-red-300" : "text-zinc-300")}>{requestError ? requestError : execution?.error ? `${execution.error.type}${execution.error.line ? ` · 第 ${execution.error.line} 行` : ""}\n${execution.error.message}` : execution?.stdout || (running ? "正在运行隐藏测试…" : "提交代码后，真实运行输出和测试结果会显示在这里。")}{submission && `\n\n隐藏测试：${submission.passed_tests}/${submission.total_tests} 通过${submission.passed ? " · 全部通过" : " · 仍有用例未通过"}`}</pre>}
          </section>
        </section>

        <aside className="thin-scroll min-h-0 overflow-y-auto bg-card px-5 py-5" aria-label="AI 教练与评分">
          <div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h2 className="text-base font-semibold">AI 教练</h2></div>
          <section className="mt-5 border-b pb-5"><p className="text-xs text-muted-foreground">得分预览</p><div className="mt-2 flex items-end gap-2"><strong className={cn("font-display text-5xl leading-none", submission ? submission.passed ? "text-success" : "text-primary" : "text-muted-foreground/45")}>{submission?.score ?? "--"}</strong><span className="pb-1 text-xs text-muted-foreground">/ 100 分</span></div>{submission && <div className="mt-3 flex items-center gap-2 text-xs font-semibold">{submission.passed ? <Trophy className="size-4 text-success" /> : <Gauge className="size-4 text-warning" />}<span>{submission.passed ? "100 分通过" : "还有测试未通过"}</span></div>}</section>
          <section className="mt-5 border-b pb-5"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">隐藏测试进度</h3><span className="text-[10px] text-muted-foreground">{submission ? `${submission.passed_tests}/${submission.total_tests}` : `0/${exercise?.test_count ?? 0}`}</span></div><div className="mt-3 grid grid-cols-6 gap-1.5">{Array.from({ length: visibleTestCount }, (_, index) => { const passed = submission && index < submission.passed_tests; const failed = submission && !submission.passed && index === submission.passed_tests; return <span key={index} className={cn("h-2 rounded-sm border", passed ? "border-success bg-success" : failed ? "border-danger bg-danger" : "bg-background")} />; })}</div><div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground"><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-success" />已通过</span><span className="flex items-center gap-1"><i className="size-2 rounded-sm bg-danger" />未通过</span><span className="flex items-center gap-1"><i className="size-2 rounded-sm border" />未运行</span></div></section>
          <section className="mt-5"><h3 className="flex items-center gap-2 text-xs font-semibold"><Lightbulb className="size-4 text-warning" />教练提示</h3>{diagnosis ? <div className="mt-3 space-y-3"><p className="text-xs leading-6 text-foreground/80">{diagnosis.summary}</p>{diagnosis.issues.slice(0, 3).map((issue, index) => <article key={`${issue.title}:${index}`} className="rounded-xl border bg-background p-3"><div className="flex gap-2">{issue.severity === "error" || issue.severity === "warning" ? <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", issue.severity === "error" ? "text-danger" : "text-warning")} /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}<div><div className="flex flex-wrap gap-2"><h4 className="text-xs font-semibold">{issue.title}</h4>{issue.line && <span className="font-mono text-[10px] text-muted-foreground">第 {issue.line} 行</span>}</div><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{issue.explanation}</p>{issue.suggestion && <p className="mt-2 border-l-2 border-primary pl-2 text-[11px] leading-5 text-primary">{issue.suggestion}</p>}</div></div></article>)}<div className="rounded-xl border border-primary/20 bg-primary/[0.055] p-3 text-[11px] leading-5"><strong>下一步：</strong>{diagnosis.next_step}</div></div> : <div className="mt-3 rounded-xl border border-dashed bg-background px-4 py-8 text-center text-xs leading-6 text-muted-foreground">{exercise ? "完成代码后点击“提交并评分”，AI 会结合真实运行结果给出具体建议。" : "先生成今日挑战，AI 教练会在这里跟进测试与复盘。"}</div>}</section>
          <section className="mt-6 border-t pt-5"><h3 className="text-xs font-semibold">学习画像</h3>{submission ? <div className="mt-3 flex gap-2 rounded-xl border border-success/25 bg-success/[0.06] p-3 text-[11px] leading-5 text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><p>已写入学习画像<br /><span className="text-muted-foreground">{exercise?.knowledge_points.join("、")} · {submission.score} 分</span></p></div> : <p className="mt-2 text-[11px] leading-5 text-muted-foreground">提交评分后，测试成绩和知识点表现会自动写入学习画像。</p>}</section>
        </aside>
      </div>
    </main>
  );
}
