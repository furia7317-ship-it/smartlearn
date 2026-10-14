"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link, shellHref, useShellBase } from "@/components/shell-link";
import { Button } from "@/components/ui/button";
import { buildDailyTaskPlan } from "@/lib/daily-task-plan";
import { saveReflection } from "@/lib/library";
import {
  buildReflectionContext,
  generateReflectionSupplement,
  reflectionContextText,
} from "@/lib/reflection";

export function ReflectionWorkspace() {
  const orchestrator = useOrchestratorContext((state) => ({
    masterPath: state.masterPath,
    subjectPaths: state.subjectPaths,
    path: state.path,
    completedMaterials: state.completedMaterials,
    messages: state.messages,
    practiceAttempts: state.practiceAttempts,
    taskEvidence: state.taskEvidence,
    activeTeacher: state.activeTeacher,
    mode: state.mode,
    recordReflection: state.recordReflection,
  }));
  const search = useSearchParams();
  const router = useRouter();
  const base = useShellBase();
  const day = search.get("day") ?? "";
  const taskKey = search.get("taskKey") ?? "";
  const pathId = search.get("pathId") ?? "";
  const resolvedTask = (() => {
    const preferredPaths = pathId === "master"
      ? [orchestrator.masterPath]
      : pathId
        ? [orchestrator.subjectPaths.find((subject) => subject.id === pathId)?.path ?? []]
        : [];
    const candidates = [
      ...preferredPaths,
      orchestrator.masterPath,
      ...orchestrator.subjectPaths.map((subject) => subject.path),
      orchestrator.path,
    ];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.length === 0) continue;
      const signature = candidate.map((item) => `${item.day}:${item.title}`).join("|");
      if (seen.has(signature)) continue;
      seen.add(signature);
      const orderedIndexes = candidate
        .map((_, index) => index)
        .sort((left, right) => Number(candidate[right]?.day === day) - Number(candidate[left]?.day === day));
      for (const index of orderedIndexes) {
        const plan = buildDailyTaskPlan(candidate[index], index, orchestrator.completedMaterials);
        const task = plan.tasks.find((item) => item.key === taskKey);
        if (task) return { step: candidate[index], task };
      }
    }
    return null;
  })();
  const step = resolvedTask?.step;
  const task = resolvedTask?.task;
  const [userContent, setUserContent] = useState("");
  const [aiSupplement, setAiSupplement] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const context = useMemo(
    () =>
      buildReflectionContext(
        orchestrator.messages,
        orchestrator.practiceAttempts,
        orchestrator.taskEvidence,
      ),
    [orchestrator.messages, orchestrator.practiceAttempts, orchestrator.taskEvidence],
  );
  const contextText = useMemo(() => reflectionContextText(context), [context]);
  const title = `${day || "今日"} 学习复盘${step?.title ? `：${step.title}` : ""}`;

  const askAi = async () => {
    if (!step || userContent.trim().length < 20 || generating) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError("");
    try {
      const result = await generateReflectionSupplement({
        userContent,
        dayTitle: `${day} ${step.title}`,
        context,
        teacher: orchestrator.activeTeacher,
        signal: controller.signal,
      });
      setAiSupplement(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "AI 补充失败，请稍后重试。");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setGenerating(false);
    }
  };

  const submit = async () => {
    if (!step || !task || userContent.trim().length < 20 || saving) return;
    setSaving(true);
    setError("");
    try {
      const resource = await saveReflection(orchestrator.mode, {
        taskKey,
        day,
        title,
        knowledgePoints: step.objective ?? step.title,
        userContent: userContent.trim(),
        aiSupplement: aiSupplement.trim(),
        contextSummary: contextText,
      });
      orchestrator.recordReflection(
        resource,
        taskKey,
        userContent.trim(),
        aiSupplement.trim(),
      );
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "复盘保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  if (!step || !task || task.completionKind !== "written_response") {
    return (
      <div className="h-full overflow-y-auto bg-[#f5efe4] p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 text-center">
          <BookOpenCheck className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-semibold">没有找到对应的复盘任务</h1>
          <p className="mt-2 text-sm text-muted-foreground">请从学习路径中的“进入复盘”重新打开。</p>
          <Link href="/studio" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            <ArrowLeft className="size-4" />返回智能教师
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll h-full overflow-y-auto bg-[#f5efe4]">
      <div className="mx-auto w-full max-w-6xl px-6 py-6 lg:px-8">
        <header className="flex flex-wrap items-start gap-4">
          <button
            type="button"
            onClick={() => router.push(shellHref(base, "/studio"))}
            className="mt-1 grid size-9 place-items-center rounded-lg border bg-card text-muted-foreground hover:text-foreground"
            aria-label="返回智能教师"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <ClipboardCheck className="size-4" />{day} · 学习成果
            </div>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              先保留你自己的判断，再让 AI 只补充遗漏点。提交后会进入资源中心，并作为学习画像的复盘证据。
            </p>
          </div>
          <span className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            {task.minutes} 分钟
          </span>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <main className="space-y-5">
            <section className="rounded-2xl border border-[#d9b36d] bg-[#fff8e9] p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="size-4 text-[#9b6727]" />
                <h2 className="font-semibold text-[#513719]">我的复盘</h2>
                <span className="ml-auto rounded-full bg-[#f3e0b9] px-2 py-1 text-[11px] font-medium text-[#765022]">学生原文</span>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-5 text-[#765d3d]">
                {(task.prompts.length ? task.prompts : ["今天最容易出错的地方是什么？", "明天最需要解决的问题是什么？"]).map((prompt, index) => (
                  <p key={prompt}><span className="mr-1 font-mono font-semibold">Q{index + 1}</span>{prompt}</p>
                ))}
              </div>
              <textarea
                value={userContent}
                onChange={(event) => setUserContent(event.target.value)}
                disabled={saved}
                rows={12}
                placeholder="写下今天真正理解了什么、哪里出错、为什么出错，以及明天准备怎么验证……"
                className="mt-4 w-full resize-y rounded-xl border border-[#d8bd8c] bg-[#fffdf7] px-4 py-3 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-[#b77a2c]/30 disabled:opacity-70"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-[#846b4a]">
                <span>至少 20 字，原文提交后不会被 AI 覆盖</span>
                <span className="font-mono">{userContent.trim().length} 字</span>
              </div>
            </section>

            <section className="rounded-2xl border border-[#96b5a0] bg-[#eef6f0] p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <BrainCircuit className="size-4 text-[#47785a]" />
                <h2 className="font-semibold text-[#284c35]">AI 补充</h2>
                <span className="ml-auto rounded-full bg-[#d8eadc] px-2 py-1 text-[11px] font-medium text-[#3d704e]">教师补充 · 单独保存</span>
              </div>
              {aiSupplement ? (
                <div className="mt-4 whitespace-pre-wrap rounded-xl border border-[#a9c5b0] bg-[#f8fcf8] px-4 py-3 text-sm leading-6 text-[#30533a]">
                  {aiSupplement}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-[#a9c5b0] px-4 py-8 text-center text-sm text-[#5d7864]">
                  AI 会结合当前会话、今天的测验和已完成任务，只补充你遗漏的部分。
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={saved || generating || orchestrator.mode !== "live" || userContent.trim().length < 20}
                onClick={() => void askAi()}
                className="mt-4 gap-2 border-[#8eaf98] bg-[#f8fcf8] text-[#356044] hover:bg-[#e2efe5]"
              >
                {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {generating ? "正在结合今日学习记录…" : aiSupplement ? "重新生成 AI 补充" : "让 AI 补充复盘"}
              </Button>
            </section>

            {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>}
            {saved ? (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-5">
                <CheckCircle2 className="size-5 text-success" />
                <div className="min-w-0 flex-1">
                  <strong className="block text-sm">复盘已提交</strong>
                  <span className="text-xs text-muted-foreground">任务进度、资源中心和学习画像已经同步更新。</span>
                </div>
                <Link href="/resources" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">前往资源中心</Link>
              </div>
            ) : (
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={saving || orchestrator.mode !== "live" || userContent.trim().length < 20}
                  onClick={() => void submit()}
                  className="gap-2 px-5"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {saving ? "正在保存…" : "提交复盘"}
                </Button>
              </div>
            )}
          </main>

          <aside className="space-y-4">
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="text-sm font-semibold">今日学习依据</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">AI 仅使用这些公开学习记录补充，不读取隐藏推理。</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl bg-muted/50 p-3">
                  <div className="text-xs font-medium">问答记录</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{context.chatHistory.length} 条</div>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <div className="text-xs font-medium">今日测验</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{context.quizSummaries.length} 次</div>
                </div>
                <div className="rounded-xl bg-muted/50 p-3">
                  <div className="text-xs font-medium">完成证据</div>
                  <div className="mt-1 font-mono text-lg font-semibold">{context.evidenceSummaries.length} 条</div>
                </div>
              </div>
            </section>
            <section className="rounded-2xl border bg-card p-4">
              <h2 className="text-sm font-semibold">提交后会发生什么</h2>
              <ol className="mt-3 space-y-3 text-xs leading-5 text-muted-foreground">
                <li>1. 当前复盘任务按真实提交记录为完成。</li>
                <li>2. 用户原文与 AI 补充进入资源中心。</li>
                <li>3. 易错管理、认知匹配和目标清晰度画像获得新证据。</li>
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
