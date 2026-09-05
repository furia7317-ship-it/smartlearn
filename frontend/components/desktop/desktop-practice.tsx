"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BookX,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  FilePlus2,
  Loader2,
  X,
} from "lucide-react";

import { DesktopEmptyState } from "@/components/desktop/desktop-empty-state";
import { DesktopPaperCover } from "@/components/desktop/desktop-paper-cover";
import {
  TeacherOpenButton,
  useTeacherWindowActions,
} from "@/components/desktop/teacher-window-provider";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { QuizRunner } from "@/components/quiz-runner";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
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

/**
 * 桌面专属「练习与错题」——完全独立于 web 的 /practice（自有布局/封皮/空状态，不用 web-route-frame）。
 * 共用数据层（useOrchestratorContext / lib）与功能模块 QuizRunner（判分逻辑，不复制）+ Tabs（ui 原子）。
 */

interface OpenPaper {
  paper: PaperSummary;
  questions: QuizQuestion[];
  loading: boolean;
  resourceId: string;
}

const PRACTICE_TABS = ["papers", "wrongbook"] as const;

export default function DesktopPractice() {
  const { mode, hydrated, resources, practiceAttempts, recordPractice } =
    useOrchestratorContext((state) => ({
      mode: state.mode,
      hydrated: state.hydrated,
      resources: state.resources,
      practiceAttempts: state.practiceAttempts,
      recordPractice: state.recordPractice,
    }));
  const { openTeacher } = useTeacherWindowActions();

  const sessionQuiz = findQuizResource(resources);
  const latestAttempt = practiceAttempts[0];
  const wrongQuestions = practiceAttempts.flatMap((attempt) =>
    attempt.wrongQuestions.map((question) => ({ ...question, attempt }))
  );

  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);
  const [open, setOpen] = useState<OpenPaper | null>(null);
  const [activeTab, setActiveTab] = useDesktopModuleStringState<"papers" | "wrongbook">(
    "practice",
    "library.tab",
    "papers",
    PRACTICE_TABS
  );

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
    if (paper.id.startsWith("session_")) return;
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
    setPapers((prev) =>
      prev.map((p) =>
        p.id === open.paper.id
          ? { ...p, status: "graded", overall_score: submission.score }
          : p
      )
    );
  };

  return (
    <div className="desktop-book-page thin-scroll h-full overflow-y-auto">
      <div className="desktop-book-page__frame mx-auto max-w-[1440px] space-y-6 px-8 py-7">
        <header className="desktop-book-page__header flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">练习与错题</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              每次生成的练习卷独立存档于试题库 · 批改后自动归档错因
            </p>
          </div>
          <TeacherOpenButton
            context={{
              module: "practice",
              title: "练习与错题",
              detail: "请结合当前学习内容或薄弱项，为我生成一组有针对性的练习题。",
            }}
            className="flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent"
          >
            <FilePlus2 className="size-4" />
            让教师出题
          </TeacherOpenButton>
        </header>

        <section className="grid gap-3 md:grid-cols-2" aria-label="练习工具">
          <Link
            href="/desktop/code-lab"
            className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition hover:border-primary/35 hover:bg-accent/50"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Code2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">代码挑战</strong>
              <small className="mt-1 block text-xs text-muted-foreground">按当前学习内容编程、运行并获得反馈</small>
            </span>
          </Link>
          <Link
            href="/desktop/diagnostic"
            className="group flex items-center gap-4 rounded-2xl border bg-card p-4 transition hover:border-primary/35 hover:bg-accent/50"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <ClipboardCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">学情摸底</strong>
              <small className="mt-1 block text-xs text-muted-foreground">用阶段测评识别薄弱点并调整后续练习</small>
            </span>
          </Link>
        </section>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "papers" | "wrongbook")}>
          <TabsList>
            <TabsTrigger value="papers">试题库</TabsTrigger>
            <TabsTrigger value="wrongbook">错题本</TabsTrigger>
          </TabsList>

          <TabsContent value="papers" className="mt-3">
            {!hydrated || loadingPapers ? (
              <div className="rounded-2xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">
                正在加载试题库…
              </div>
            ) : allPapers.length > 0 ? (
              <>
                <div className="mb-3 flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>每份练习卷独立存档，可反复作答</span>
                  <span>{allPapers.length} 份试卷</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {allPapers.map((paper) => (
                    <DesktopPaperCover
                      key={paper.id}
                      paper={paper}
                      onOpen={openPaper}
                      onDelete={paper.id.startsWith("session_") ? undefined : removePaper}
                    />
                  ))}
                </div>
              </>
            ) : (
              <DesktopEmptyState
                icon={FilePlus2}
                title="试题库还是空的"
                desc="告诉智能教师你的知识点或薄弱项，教师会按需组卷；生成的每份练习卷都会独立存档在这里。"
                cta={{
                  label: "找智能教师出题",
                  onClick: () => openTeacher({
                    module: "practice",
                    title: "试题库",
                    detail: "试题库为空，请结合当前学习内容或薄弱项为我生成一份练习卷。",
                  }),
                }}
              />
            )}
          </TabsContent>

          <TabsContent value="wrongbook" className="mt-3">
            {wrongQuestions.length > 0 ? (
              <div className="space-y-3">
                {wrongQuestions.map((question) => (
                  <section key={`${question.attempt.id}-${question.id}`} className="rounded-2xl border bg-card p-5">
                    <div className="flex items-start gap-2">
                      <BookX className="mt-0.5 size-4 shrink-0 text-danger" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold leading-relaxed">{question.stem}</h2>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          你的答案：{question.chosen || "未作答"} · 正确答案：{question.answer || "见解析"}
                        </p>
                        {question.explanation && (
                          <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px] leading-relaxed">
                            {question.explanation}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          来源：{question.attempt.title} · 得分 {question.attempt.score}
                        </p>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
            ) : practiceAttempts.length > 0 ? (
              <DesktopEmptyState
                icon={CheckCircle2}
                title="本轮没有错题"
                desc="最近一次练习全部答对，成绩已经同步到学习画像与路径调整记录。"
              />
            ) : (
              <DesktopEmptyState
                icon={BookX}
                title="错题本是空的"
                desc="做练习时答错的题会按错因自动归档到这里，并联动学习路径安排复盘。"
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* 作答弹层（功能用共享 QuizRunner） */}
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
          >
            <header className="flex shrink-0 items-start gap-3 border-b bg-surface-2/60 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold leading-tight">{open.paper.title}</h2>
                <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
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
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {open.loading ? (
                <div className="grid place-items-center py-16 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  <span className="mt-2 text-[13px]">加载题目…</span>
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
