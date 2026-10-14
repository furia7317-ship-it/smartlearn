"use client";

import { useCallback, useEffect, useState } from "react";
import { ShellLink as Link } from "@/components/shell-link";
import { BookX, CheckCircle2, FilePlus2, Loader2, X } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { PaperCover } from "@/components/paper-cover";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { QuizRunner } from "@/components/quiz-runner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deletePaper,
  getPaperDetail,
  listPapers,
  type PaperSummary,
} from "@/lib/library";
import type { QuizSubmission } from "@/lib/practice-feedback";
import { findQuizResource } from "@/lib/session-insights";
import type { QuizQuestion, ResourceItem } from "@/lib/types";

interface OpenPaper {
  paper: PaperSummary;
  questions: QuizQuestion[];
  loading: boolean;
  resourceId: string; // 用于 recordPractice 关联
}

export default function PracticePage() {
  const { mode, hydrated, resources, practiceAttempts, recordPractice } =
    useOrchestratorContext((state) => ({
      mode: state.mode,
      hydrated: state.hydrated,
      resources: state.resources,
      practiceAttempts: state.practiceAttempts,
      recordPractice: state.recordPractice,
    }));

  const sessionQuiz = findQuizResource(resources);
  const latestAttempt = practiceAttempts[0];
  const [activeTab, setActiveTab] = useState<"papers" | "wrongbook">("papers");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requested = query.get("detailTab") || query.get("tab");
    if (requested === "wrongbook") setActiveTab("wrongbook");
  }, []);
  const wrongQuestions = practiceAttempts.flatMap((attempt) =>
    attempt.wrongQuestions.map((question) => ({ ...question, attempt }))
  );

  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [open, setOpen] = useState<OpenPaper | null>(null);

  const refresh = useCallback(() => {
    if (mode === "checking") return;
    setLoadingPapers(true);
    listPapers(mode)
      .then(setPapers)
      .catch(() => setPapers([]))
      .finally(() => setLoadingPapers(false));
  }, [mode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 当前会话生成的 quiz（studio 路径不入库）合成一张封皮置顶
  const sessionCard: PaperSummary | null = sessionQuiz
    ? {
        id: `session_${sessionQuiz.id}`,
        exam_id: "",
        title: sessionQuiz.title,
        topic: sessionQuiz.subtitle || "当前会话",
        category: "当前会话",
        tags: ["会话"],
        status: latestAttempt?.resourceId === sessionQuiz.id ? "graded" : "created",
        overall_score:
          latestAttempt?.resourceId === sessionQuiz.id ? latestAttempt.score : null,
        question_count: sessionQuiz.data?.questions?.length ?? 0,
        created_at: new Date().toISOString(),
      }
    : null;

  const allPapers = [sessionCard, ...papers].filter(Boolean) as PaperSummary[];

  const openPaper = async (paper: PaperSummary) => {
    if (paper.id.startsWith("session_") && sessionQuiz) {
      setOpen({
        paper,
        questions: sessionQuiz.data?.questions ?? [],
        loading: false,
        resourceId: sessionQuiz.id,
      });
      return;
    }
    setOpen({ paper, questions: [], loading: true, resourceId: paper.id });
    const detail = await getPaperDetail(mode, paper.exam_id || paper.id);
    setOpen({
      paper,
      questions: detail?.questions ?? [],
      loading: false,
      resourceId: paper.id,
    });
  };

  const removePaper = async (paper: PaperSummary) => {
    if (paper.id.startsWith("session_")) return; // 会话卷不可删
    setPapers((prev) => prev.filter((p) => p.id !== paper.id));
    await deletePaper(mode, paper.id);
  };

  const onSubmit = (submission: QuizSubmission) => {
    if (!open) return;
    const resource: ResourceItem = {
      id: open.resourceId,
      type: "quiz",
      title: open.paper.title,
      subtitle: open.paper.topic,
      meta: [],
      status: "ready",
      version: 1,
      sources: 0,
      data: { questions: open.questions },
    };
    recordPractice(resource, submission);
    // 乐观更新封皮分数
    setPapers((prev) =>
      prev.map((p) =>
        p.id === open.paper.id
          ? { ...p, status: "graded", overall_score: submission.score }
          : p
      )
    );
  };

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader
          title="练习与错题"
          desc="每次生成的练习卷独立存档于试题库 · 批改后自动归档错因"
        >
          <Link
            href="/create"
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-accent"
          >
            <FilePlus2 className="size-3.5" />
            生成新练习卷
          </Link>
        </PageHeader>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value === "wrongbook" ? "wrongbook" : "papers")}>
          <TabsList>
            <TabsTrigger value="papers">试题库</TabsTrigger>
            <TabsTrigger value="wrongbook">错题本</TabsTrigger>
          </TabsList>

          <TabsContent value="papers" className="mt-2">
            {!hydrated || loadingPapers ? (
              <div className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
                正在加载试题库…
              </div>
            ) : allPapers.length > 0 ? (
              <>
                <div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>每份练习卷独立存档，可反复作答</span>
                  <span>{allPapers.length} 份试卷</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {allPapers.map((paper) => (
                    <PaperCover
                      key={paper.id}
                      paper={paper}
                      onOpen={openPaper}
                      onDelete={paper.id.startsWith("session_") ? undefined : removePaper}
                    />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                icon={FilePlus2}
                mascot="alligator"
                title="试题库还是空的"
                desc="去「生成资料」勾选练习题库，或在 AI 答疑让题库命题官按薄弱点组卷，生成的每份练习卷都会独立存档在这里。"
                cta={{ href: "/create", label: "生成一套练习卷" }}
              />
            )}
          </TabsContent>

          <TabsContent value="wrongbook" className="mt-2">
            {wrongQuestions.length > 0 ? (
              <div className="space-y-3">
                {wrongQuestions.map((question) => (
                  <section key={`${question.attempt.id}-${question.id}`} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start gap-2">
                      <BookX className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-[13px] font-semibold leading-relaxed">{question.stem}</h2>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          你的答案：{question.chosen || "未作答"} · 正确答案：{question.answer || "见解析"}
                        </p>
                        {question.explanation && (
                          <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-[12px] leading-relaxed">
                            {question.explanation}
                          </p>
                        )}
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          来源：{question.attempt.title} · 得分 {question.attempt.score}
                        </p>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            ) : practiceAttempts.length > 0 ? (
              <EmptyState
                icon={CheckCircle2}
                mascot="red-panda"
                title="本轮没有错题"
                desc="最近一次练习全部答对，成绩已经同步到学习画像与路径调整记录。"
              />
            ) : (
              <EmptyState
                icon={BookX}
                mascot="alligator"
                title="错题本是空的"
                desc="做练习时答错的题会按错因自动归档到这里，并联动学习路径安排复盘。"
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* 作答弹层 */}
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
          >
            <header className="flex shrink-0 items-start gap-3 border-b bg-surface-2/60 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[15px] font-semibold leading-tight">{open.paper.title}</h2>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  《{open.paper.topic}》 · {open.paper.question_count} 题
                </div>
              </div>
              <button
                onClick={() => setOpen(null)}
                aria-label="关闭"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {open.loading ? (
                <div className="grid place-items-center py-16 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="mt-2 text-[12px]">加载题目…</span>
                </div>
              ) : (
                <QuizRunner
                  questions={open.questions}
                  onSubmit={onSubmit}
                  onClose={() => setOpen(null)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
