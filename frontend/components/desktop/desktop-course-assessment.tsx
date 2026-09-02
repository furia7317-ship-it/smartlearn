"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpenCheck,
  Bookmark,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileClock,
  FileText,
  Loader2,
  Mail,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  Target,
  UserRound,
} from "lucide-react";

import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { streamSSE } from "@/lib/api";
import {
  buildCourseAssessmentScopes,
  COURSE_ASSESSMENT_CATEGORY,
  courseAssessmentDraftKey,
  courseAssessmentScopeSignature,
  courseExamRequestCourses,
  isCourseAssessmentReport,
  normalizeCourseAssessmentMastery,
  normalizeCourseAssessmentQuestions,
  normalizeCourseAssessmentResults,
  type CourseAssessmentDraft,
  type CourseAssessmentQuestion,
  type CourseAssessmentReport,
  type CourseAssessmentResult,
} from "@/lib/course-assessment";
import {
  getPaperDetail,
  invalidateLibraryListCache,
  listPapers,
  type PaperSummary,
} from "@/lib/library";
import { optionAnswerValue } from "@/lib/learning-baseline-gate";
import {
  readDesktopModuleView,
  saveDesktopModuleView,
} from "@/lib/desktop-module-view";
import { getStudentId } from "@/lib/student-identity";
import { cn } from "@/lib/utils";
import pathStyles from "./desktop-path.module.css";
import styles from "./desktop-course-assessment.module.css";

type AssessmentStage = "setup" | "generating" | "questions" | "grading" | "result";
type PathWorkspaceTab = "overview" | "courses" | "plan";

const QUESTION_TYPE_LABEL: Record<CourseAssessmentQuestion["type"], string> = {
  mcq: "单选题",
  blank: "填空题",
  short: "简答题",
  code: "代码题",
};
const MAX_SELECTED_COURSES = 8;

function safeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function readDraft(key: string, signature: string): CourseAssessmentDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null") as Partial<CourseAssessmentDraft> | null;
    if (!parsed || parsed.version !== 1 || parsed.scopeSignature !== signature || !parsed.examId) return null;
    const questions = normalizeCourseAssessmentQuestions(parsed.questions);
    if (questions.length === 0) return null;
    return {
      version: 1,
      scopeSignature: signature,
      selectedCourseIds: Array.isArray(parsed.selectedCourseIds)
        ? parsed.selectedCourseIds.filter((item): item is string => typeof item === "string")
        : [],
      examId: parsed.examId,
      paperId: typeof parsed.paperId === "string" ? parsed.paperId : "",
      questions,
      questionIndex: Math.min(Math.max(Number(parsed.questionIndex) || 0, 0), questions.length - 1),
      answers: parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {},
      flagged: parsed.flagged && typeof parsed.flagged === "object" ? parsed.flagged : {},
      startedAt: Number(parsed.startedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function resultScoreLabel(score: number): string {
  if (score >= 85) return "掌握稳固";
  if (score >= 60) return "基本掌握";
  return "需要回炉";
}

function CourseAssessmentTopbar({
  courseCount,
  assessmentCount,
  onOpenWorkspace,
}: {
  courseCount: number;
  assessmentCount: number;
  onOpenWorkspace: (tab: PathWorkspaceTab) => void;
}) {

  return (
    <header className={pathStyles.pathTopbar}>
      <div className={pathStyles.pathTopbarTitle}>
        <h1>学习路径</h1>
        <span aria-hidden>学</span>
      </div>
      <nav className={pathStyles.pathTopbarNav} aria-label="学习路径页面导航">
        <button type="button" onClick={() => onOpenWorkspace("overview")}>路径总览</button>
        <button type="button" onClick={() => onOpenWorkspace("courses")}>
          课程管理{courseCount > 0 ? <span className={pathStyles.pathNavCount}>{courseCount}</span> : null}
        </button>
        <button type="button" onClick={() => onOpenWorkspace("plan")}>学习计划</button>
        <NextLink href="/desktop/path/assessment" aria-current="page" className={pathStyles.pathTopbarActive}>
          考试测评{assessmentCount > 0 ? <span className={pathStyles.pathNavCount}>{assessmentCount}</span> : null}
        </NextLink>
      </nav>
      <div className={pathStyles.pathTopbarTools}>
        <details className={pathStyles.pathNoticeMenu}>
          <summary aria-label="查看测评说明"><Bell className="size-[18px]" aria-hidden /></summary>
          <div><strong>课程测评</strong><p>试卷范围只包含已学和正在学习的节点，提交后同步记忆与画像。</p></div>
        </details>
        <TeacherOpenButton
          context={{
            module: "assessment",
            title: "考试测评",
            detail: "围绕当前课程测评的范围、组卷或结果复盘提问。",
          }}
          aria-label="打开智能教师消息"
        >
          <Mail className="size-[18px]" aria-hidden />
        </TeacherOpenButton>
      </div>
    </header>
  );
}

export default function DesktopCourseAssessment() {
  const router = useRouter();
  const { mode, hydrated, subjectPaths, completedMaterials } = useOrchestratorContext();
  const [studentId, setStudentId] = useState("");
  const scopes = useMemo(
    () => buildCourseAssessmentScopes(subjectPaths, completedMaterials)
      .filter((scope) => scope.status === "active"),
    [completedMaterials, subjectPaths],
  );
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const selectionReady = useRef(false);
  const [stage, setStage] = useState<AssessmentStage>("setup");
  const [examId, setExamId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [questions, setQuestions] = useState<CourseAssessmentQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [savedAt, setSavedAt] = useState(0);
  const [result, setResult] = useState<CourseAssessmentResult | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PaperSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [openingHistoryId, setOpeningHistoryId] = useState("");

  useEffect(() => {
    if (!hydrated) return;
    setStudentId(getStudentId());
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || selectionReady.current) return;
    selectionReady.current = true;
    setSelectedCourseIds(scopes.slice(0, MAX_SELECTED_COURSES).map((scope) => scope.courseId));
  }, [hydrated, scopes]);

  const requestCourses = useMemo(
    () => courseExamRequestCourses(scopes, selectedCourseIds),
    [scopes, selectedCourseIds],
  );
  const scopeSignature = useMemo(
    () => courseAssessmentScopeSignature(requestCourses),
    [requestCourses],
  );
  const draftStorageKey = useMemo(
    () => courseAssessmentDraftKey(studentId, scopeSignature),
    [scopeSignature, studentId],
  );
  const scopePointCount = useMemo(
    () => new Set(requestCourses.flatMap((course) => course.scope_points)).size,
    [requestCourses],
  );

  const refreshHistory = useCallback(() => {
    if (mode === "checking") return;
    setLoadingHistory(true);
    listPapers(mode)
      .then((papers) => setHistory(papers.filter((paper) => (
        paper.category === COURSE_ASSESSMENT_CATEGORY
        && paper.status === "graded"
        && paper.overall_score !== null
      ))))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHistory(false));
  }, [mode]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  useEffect(() => {
    if (!studentId || !selectionReady.current || stage !== "setup" || requestCourses.length === 0) return;
    const draft = readDraft(draftStorageKey, scopeSignature);
    if (!draft) return;
    setSelectedCourseIds(draft.selectedCourseIds.slice(0, MAX_SELECTED_COURSES));
    setExamId(draft.examId);
    setPaperId(draft.paperId);
    setQuestions(draft.questions);
    setQuestionIndex(draft.questionIndex);
    setAnswers(draft.answers);
    setFlagged(draft.flagged);
    setStartedAt(draft.startedAt);
    setStage("questions");
  }, [draftStorageKey, requestCourses.length, scopeSignature, stage, studentId]);

  useEffect(() => {
    if (stage !== "questions") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  const persistDraft = useCallback(() => {
    if (questions.length === 0 || !examId) return;
    const draft: CourseAssessmentDraft = {
      version: 1,
      scopeSignature,
      selectedCourseIds,
      examId,
      paperId,
      questions,
      questionIndex,
      answers,
      flagged,
      startedAt,
    };
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
      setSavedAt(Date.now());
    } catch {
      // The assessment remains usable if local storage is unavailable.
    }
  }, [answers, draftStorageKey, examId, flagged, paperId, questionIndex, questions, scopeSignature, selectedCourseIds, startedAt]);

  useEffect(() => {
    if (stage !== "questions" || questions.length === 0 || !examId) return;
    const timer = window.setTimeout(persistDraft, 240);
    return () => window.clearTimeout(timer);
  }, [examId, persistDraft, questions.length, stage]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // In-memory reset still works.
    }
  }, [draftStorageKey]);

  const openPathWorkspace = (tab: PathWorkspaceTab) => {
    const current = readDesktopModuleView("path");
    saveDesktopModuleView("path", {
      href: "/desktop/path",
      values: { ...current.values, "workspace.tab": tab },
    });
    router.push("/desktop/path");
  };

  const openWrongbook = () => {
    const current = readDesktopModuleView("practice");
    saveDesktopModuleView("practice", {
      href: "/desktop/practice",
      values: { ...current.values, "library.tab": "wrongbook" },
    });
    router.push("/desktop/practice");
  };

  const saveAndExit = () => {
    persistDraft();
    openPathWorkspace("overview");
  };

  const toggleCourse = (courseId: string) => {
    if (stage !== "setup") return;
    if (selectedCourseIds.includes(courseId)) {
      setSelectedCourseIds((current) => current.filter((id) => id !== courseId));
      return;
    }
    if (selectedCourseIds.length >= MAX_SELECTED_COURSES) {
      setError(`一次最多选择 ${MAX_SELECTED_COURSES} 门课程，请先取消一门再选择。`);
      return;
    }
    setSelectedCourseIds((current) => [...current, courseId]);
  };

  const startAssessment = async () => {
    if (!studentId || mode !== "live" || requestCourses.length === 0 || stage !== "setup") return;
    setStage("generating");
    setError("");
    setExamId("");
    setPaperId("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setFlagged({});
    setResult(null);
    let generatedQuestions: CourseAssessmentQuestion[] = [];
    let generatedExamId = "";
    let generatedPaperId = "";
    let streamError = "";
    try {
      await streamSSE(
        "/api/assess/course-exam",
        {
          student_id: studentId,
          courses: requestCourses,
          paper_type: "adaptive",
        },
        ({ event, data }) => {
          if (event === "exam") {
            generatedQuestions = normalizeCourseAssessmentQuestions(data.questions);
          } else if (event === "done") {
            if (typeof data.exam_id === "string") generatedExamId = data.exam_id;
            if (typeof data.paper_id === "string") generatedPaperId = data.paper_id;
          } else if (event === "error") {
            streamError = typeof data.message === "string" ? data.message : "课程试卷生成失败";
          }
        },
      );
      if (streamError) throw new Error(streamError);
      if (!generatedExamId || generatedQuestions.length === 0) {
        throw new Error("后端没有返回可用试卷，请检查课程知识库后重试");
      }
      setExamId(generatedExamId);
      setPaperId(generatedPaperId);
      setQuestions(generatedQuestions);
      setStartedAt(Date.now());
      setNow(Date.now());
      setSavedAt(0);
      setStage("questions");
      invalidateLibraryListCache("papers");
      refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课程试卷生成失败，请重试");
      setStage("setup");
    }
  };

  const submitAssessment = async () => {
    if (!studentId || !examId || stage !== "questions") return;
    setStage("grading");
    setError("");
    let gradeReceived = false;
    let overall = 0;
    let mastery: CourseAssessmentResult["mastery"] = {};
    let rows: CourseAssessmentResult["results"] = [];
    let report: CourseAssessmentReport | null = null;
    let memoryCardsCreated: number | undefined;
    let semanticFactsUpdated: number | undefined;
    let profileUpdated: boolean | undefined;
    let streamError = "";
    try {
      await streamSSE(
        `/api/assess/${encodeURIComponent(examId)}/submit`,
        { student_id: studentId, answers },
        ({ event, data }) => {
          if (event === "graded" && data.results && typeof data.results === "object") {
            const payload = data.results as Record<string, unknown>;
            const receivedOverall = safeNumber(payload.overall);
            if (receivedOverall !== undefined) overall = receivedOverall;
            mastery = normalizeCourseAssessmentMastery(payload.mastery);
            rows = normalizeCourseAssessmentResults(payload.results);
            gradeReceived = true;
          } else if (event === "report" && isCourseAssessmentReport(data.assessment)) {
            report = data.assessment;
          } else if (event === "done") {
            const receivedOverall = safeNumber(data.overall);
            if (receivedOverall !== undefined) overall = receivedOverall;
            const count = safeNumber(data.memory_cards_created);
            if (count !== undefined) memoryCardsCreated = count;
            const facts = safeNumber(data.semantic_facts_updated);
            if (facts !== undefined) semanticFactsUpdated = facts;
            if (typeof data.profile_updated === "boolean") profileUpdated = data.profile_updated;
          } else if (event === "error") {
            streamError = typeof data.message === "string" ? data.message : "课程测评评分失败";
          }
        },
      );
      if (streamError) throw new Error(streamError);
      invalidateLibraryListCache("papers", "goals");
      const detail = await getPaperDetail(mode, paperId || examId);
      if (detail) {
        const detailOverall = safeNumber(detail.overall_score);
        if (detailOverall !== undefined) overall = detailOverall;
        const detailMastery = normalizeCourseAssessmentMastery(detail.mastery);
        if (Object.keys(detailMastery).length > 0) mastery = detailMastery;
        const detailRows = normalizeCourseAssessmentResults(detail.results);
        if (detailRows.length > 0) rows = detailRows;
      }
      if (!gradeReceived && !detail) throw new Error("后端未返回评分结果，请重试提交");
      setResult({ overall, mastery, results: rows, report, memoryCardsCreated, semanticFactsUpdated, profileUpdated });
      clearDraft();
      setStage("result");
      refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "课程测评评分失败，请重试");
      setStage("questions");
    }
  };

  const resetAssessment = () => {
    clearDraft();
    setStage("setup");
    setExamId("");
    setPaperId("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({});
    setFlagged({});
    setStartedAt(0);
    setResult(null);
    setError("");
  };

  const openHistory = async (paper: PaperSummary) => {
    setOpeningHistoryId(paper.id);
    setError("");
    try {
      const detail = await getPaperDetail(mode, paper.id);
      if (!detail) throw new Error("无法读取这份测评记录");
      setExamId(detail.exam_id);
      setPaperId(detail.id);
      setQuestions(normalizeCourseAssessmentQuestions(detail.questions));
      setAnswers(detail.answers || {});
      setResult({
        overall: safeNumber(detail.overall_score) ?? 0,
        mastery: normalizeCourseAssessmentMastery(detail.mastery),
        results: normalizeCourseAssessmentResults(detail.results),
        report: null,
        profileUpdated: true,
      });
      setStage("result");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取这份测评记录");
    } finally {
      setOpeningHistoryId("");
    }
  };

  const currentQuestion = questions[questionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] || "" : "";
  const answeredCount = questions.filter((question) => Boolean(answers[question.id]?.trim())).length;
  const knowledgeCoverage = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((question) => {
      const point = question.knowledge_point?.trim() || "综合应用";
      counts.set(point, (counts.get(point) || 0) + 1);
    });
    return [...counts.entries()];
  }, [questions]);

  const renderSetup = () => (
    <main className={`thin-scroll ${styles.body}`}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>COURSE ASSESSMENT</span>
          <h2>课程考试测评</h2>
          <p>依据进行中的课程、已学节点与个人薄弱项组卷，不提前考尚未解锁的内容。</p>
        </div>
        <span className={styles.heroSeal} aria-hidden>考</span>
      </section>

      {error ? <div className={styles.errorBanner} role="alert"><CircleAlert aria-hidden />{error}<button type="button" onClick={() => setError("")}>关闭</button></div> : null}

      <div className={styles.setupGrid}>
        <section className={styles.coursePanel} aria-labelledby="assessment-course-title">
          <header className={styles.sectionHeader}>
            <div><span>壹</span><h3 id="assessment-course-title">本次测评范围</h3></div>
            <p>默认选择正在进行的课程</p>
          </header>
          {!hydrated ? (
            <div className={styles.loadingBlock}><Loader2 className="animate-spin" />正在恢复课程…</div>
          ) : scopes.length === 0 ? (
            <div className={styles.emptyBlock}>
              <BookOpenCheck aria-hidden />
              <strong>还没有可供组卷的课程</strong>
              <p>先创建并启用课程，学到第一个知识节点后即可测评。</p>
              <button type="button" onClick={() => openPathWorkspace("courses")}>去课程管理</button>
            </div>
          ) : (
            <div className={styles.courseList}>
              {scopes.map((scope) => {
                const selected = selectedCourseIds.includes(scope.courseId);
                const unavailable = scope.scopePoints.length === 0;
                return (
                  <button
                    key={scope.courseId}
                    type="button"
                    className={cn(styles.courseCard, selected && styles.courseCardSelected)}
                    disabled={unavailable}
                    aria-pressed={selected}
                    onClick={() => toggleCourse(scope.courseId)}
                  >
                    <span className={styles.courseCheck}>{selected ? <Check aria-hidden /> : null}</span>
                    <span className={styles.courseCopy}>
                      <span className={styles.courseTitle}><strong>{scope.title}</strong><i>{scope.status === "active" ? "进行中" : scope.status === "completed" ? "已完成" : "未启用"}</i></span>
                      <span className={styles.progressTrack}><i style={{ width: `${scope.progress}%` }} /></span>
                      <span className={styles.courseMeta}>进度 {scope.progress}% · 当前：{scope.currentStage}</span>
                      {unavailable ? <small>尚无已学或当前知识节点，暂不能纳入测评</small> : (
                        <span className={styles.scopeTags}>
                          {scope.scopePoints.slice(0, 5).map((point) => <em key={point}>{point}</em>)}
                          {scope.scopePoints.length > 5 ? <em>+{scope.scopePoints.length - 5}</em> : null}
                        </span>
                      )}
                    </span>
                    <span className={styles.courseStageCount}>{scope.coveredStageCount}<small>个节点</small></span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className={styles.blueprint} aria-labelledby="assessment-blueprint-title">
          <header><ScrollText aria-hidden /><div><span>组卷案</span><h3 id="assessment-blueprint-title">自适应课程卷</h3></div></header>
          <dl>
            <div><dt>纳入课程</dt><dd>{requestCourses.length}<small>门</small></dd></div>
            <div><dt>知识范围</dt><dd>{scopePointCount}<small>项</small></dd></div>
            <div><dt>预计用时</dt><dd>{Math.max(12, requestCourses.length * 8)}<small>分钟</small></dd></div>
          </dl>
          <section>
            <h4>出卷原则</h4>
            <p><ShieldCheck aria-hidden />只覆盖已完成与当前节点</p>
            <p><Target aria-hidden />结合画像中的薄弱知识点调整难度</p>
            <p><BrainCircuit aria-hidden />错题进入记忆复习，掌握度写回画像</p>
          </section>
          <button type="button" disabled={!studentId || mode !== "live" || requestCourses.length === 0} onClick={() => void startAssessment()}>
            <ClipboardCheck aria-hidden />开始 AI 组卷
          </button>
          {mode !== "live" ? <small className={styles.serviceWarning}>学习服务未连接，暂时不能组卷。</small> : null}
        </aside>
      </div>

      <section className={styles.historyPanel} aria-labelledby="assessment-history-title">
        <header className={styles.sectionHeader}>
          <div><span>贰</span><h3 id="assessment-history-title">历次课程测评</h3></div>
          <p>这里只收录“课程测评”，普通练习仍在练习模块</p>
        </header>
        {loadingHistory ? <div className={styles.historyLoading}><Loader2 className="animate-spin" />正在读取测评记录…</div> : history.length > 0 ? (
          <div className={styles.historyList}>
            {history.slice(0, 6).map((paper) => (
              <button key={paper.id} type="button" onClick={() => void openHistory(paper)} disabled={openingHistoryId === paper.id}>
                <FileText aria-hidden />
                <span><strong>{paper.title}</strong><small>{paper.topic} · {paper.question_count} 题</small></span>
                <time>{new Date(paper.created_at).toLocaleDateString("zh-CN")}</time>
                <b>{paper.overall_score === null ? "待作答" : `${Math.round(paper.overall_score)} 分`}</b>
                {openingHistoryId === paper.id ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowRight aria-hidden />}
              </button>
            ))}
          </div>
        ) : <div className={styles.historyEmpty}><FileClock aria-hidden />完成第一份课程测评后，记录会出现在这里。</div>}
      </section>
    </main>
  );

  const renderGenerating = () => (
    <main className={styles.centerStage}>
      <div className={styles.generatingMark}><ScrollText aria-hidden /><Loader2 className="animate-spin" aria-hidden /></div>
      <span className={styles.eyebrow}>正在拟卷</span>
      <h2>核定课程范围与题型</h2>
      <p>系统正在分别检索 {requestCourses.length} 门课程的学习资料，并依据当前画像配置难度。</p>
      <div className={styles.generatingSteps}><span>核定考纲</span><i /><span>分配题型</span><i /><span>形成试卷</span></div>
    </main>
  );

  const renderQuestions = () => (
    <main className={styles.examBody}>
      <header className={styles.examHeader}>
        <div><span>课程综合测评</span><h2>{requestCourses.map((course) => course.title).join(" · ")}</h2></div>
        <div className={styles.examProgress}><span><i style={{ width: `${questions.length ? answeredCount / questions.length * 100 : 0}%` }} /></span><strong>{answeredCount}/{questions.length}</strong></div>
        <div className={styles.saveState}><Clock3 aria-hidden /><span>用时 {formatElapsed(startedAt, now)}</span><small>{savedAt ? "答卷已自动保存" : "正在保存"}</small></div>
      </header>
      {error ? <div className={styles.errorBanner} role="alert"><CircleAlert aria-hidden />{error}<button type="button" onClick={() => setError("")}>关闭</button></div> : null}
      <div className={styles.examGrid}>
        <aside className={styles.answerSheet} aria-label="答题卡">
          <header><span>答题卡</span><small>{questions.length} 题</small></header>
          <div className={styles.answerLegend}><span><i data-tone="done" />已答</span><span><i data-tone="current" />当前</span><span><i />未答</span></div>
          <div className={styles.answerNumbers}>{questions.map((question, index) => (
            <button
              key={question.id}
              type="button"
              className={cn(index === questionIndex && styles.answerCurrent, answers[question.id]?.trim() && styles.answerDone)}
              aria-current={index === questionIndex ? "step" : undefined}
              onClick={() => setQuestionIndex(index)}
            >{index + 1}{flagged[question.id] ? <Bookmark aria-hidden /> : null}</button>
          ))}</div>
          <section><h3>知识点覆盖</h3>{knowledgeCoverage.slice(0, 8).map(([point, count]) => <p key={point}><span>{point}</span><b>{count} 题</b></p>)}</section>
          <button type="button" className={styles.exitExam} onClick={saveAndExit}>暂存并退出</button>
        </aside>

        <section className={styles.questionPaper} aria-label="当前题目">
          {currentQuestion ? <>
            <header>
              <div><span>第 {questionIndex + 1} 题</span><i>{QUESTION_TYPE_LABEL[currentQuestion.type]}</i>{currentQuestion.knowledge_point ? <em>{currentQuestion.knowledge_point}</em> : null}</div>
              <button type="button" aria-pressed={Boolean(flagged[currentQuestion.id])} onClick={() => setFlagged((current) => ({ ...current, [currentQuestion.id]: !current[currentQuestion.id] }))}><Bookmark aria-hidden />{flagged[currentQuestion.id] ? "已标记" : "标记"}</button>
            </header>
            <div className={`thin-scroll ${styles.questionContent}`}>
              <Markdown content={currentQuestion.stem} className={styles.questionStem} />
              {currentQuestion.type === "mcq" && currentQuestion.options?.length ? (
                <div className={styles.options}>{currentQuestion.options.map((option, index) => {
                  const value = optionAnswerValue(option, index);
                  const selected = currentAnswer === value;
                  return <button key={`${currentQuestion.id}-${index}`} type="button" aria-pressed={selected} className={selected ? styles.optionSelected : undefined} onClick={() => setAnswers((current) => ({ ...current, [currentQuestion.id]: value }))}><span>{String.fromCharCode(65 + index)}</span><Markdown inline content={option.replace(/^([A-Za-z])\s*[.、:：)）]\s*/, "")} /></button>;
                })}</div>
              ) : (
                <textarea
                  autoFocus
                  value={currentAnswer}
                  rows={currentQuestion.type === "code" ? 12 : 7}
                  placeholder={currentQuestion.type === "code" ? "输入代码或伪代码…" : "在此作答…"}
                  onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion.id]: event.target.value }))}
                />
              )}
            </div>
            <footer>
              <button type="button" disabled={questionIndex === 0} onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}><ArrowLeft aria-hidden />上一题</button>
              {questionIndex < questions.length - 1 ? (
                <button type="button" className={styles.examPrimary} onClick={() => setQuestionIndex((index) => index + 1)}>下一题<ArrowRight aria-hidden /></button>
              ) : (
                <button type="button" className={styles.examPrimary} disabled={answeredCount < questions.length} onClick={() => void submitAssessment()}><ClipboardCheck aria-hidden />提交试卷</button>
              )}
            </footer>
          </> : null}
        </section>

        <aside className={styles.examDossier} aria-label="本次试卷卷宗">
          <header><ScrollText aria-hidden /><h3>本次卷宗</h3></header>
          <dl><div><dt>课程</dt><dd>{requestCourses.length} 门</dd></div><div><dt>题目</dt><dd>{questions.length} 道</dd></div><div><dt>范围</dt><dd>{knowledgeCoverage.length} 项</dd></div></dl>
          <section><h4>课程构成</h4>{requestCourses.map((course) => <p key={course.course_id}><span>{course.title}</span><b>{course.scope_points.length} 项</b></p>)}</section>
          <section><h4>作答进度</h4><div className={styles.miniProgress}>{questions.map((question) => <i key={question.id} className={answers[question.id]?.trim() ? styles.miniProgressDone : undefined} />)}</div></section>
          <div className={styles.syncNote}><BrainCircuit aria-hidden /><p>交卷并完成后端评分后，错题才会进入记忆复习，掌握度才会更新画像。</p></div>
        </aside>
      </div>
    </main>
  );

  const renderGrading = () => (
    <main className={styles.centerStage}>
      <div className={styles.gradingSeal}>阅<Loader2 className="animate-spin" aria-hidden /></div>
      <span className={styles.eyebrow}>正在评卷</span>
      <h2>汇总掌握度与错误类型</h2>
      <p>客观题由规则核验，主观题由后端评分；完成后将同步错题记忆与学习画像。</p>
    </main>
  );

  const renderResult = () => {
    if (!result) return null;
    const masteryEntries = Object.entries(result.mastery).sort((left, right) => right[1].score - left[1].score);
    const wrongRows = result.results.filter((row) => !row.correct);
    const suggestions = [...new Set([...(result.report?.suggestions || []), ...(result.report?.next_steps || [])])];
    return (
      <main className={`thin-scroll ${styles.resultBody}`}>
        <header className={styles.resultHeader}>
          <div><span className={styles.eyebrow}>ASSESSMENT COMPLETE</span><h2>课程测评结果</h2><p>{result.report?.summary || "本次测评已完成，评分结果已归档。"}</p></div>
          <button type="button" onClick={resetAssessment}><RotateCcw aria-hidden />再组一份</button>
        </header>
        <div className={styles.resultGrid}>
          <aside className={styles.scoreCard}>
            <span>综合得分</span><strong>{Math.round(result.overall)}</strong><em>{resultScoreLabel(result.overall)}</em>
            <div><p>答对题目<b>{result.results.length > 0 ? result.results.filter((row) => row.correct).length : "—"}</b></p><p>待复盘<b>{result.results.length > 0 ? wrongRows.length : "—"}</b></p></div>
          </aside>
          <section className={styles.resultMain}>
            <div className={styles.syncSuccess}>
              <CheckCircle2 aria-hidden />
              <div><strong>评卷结果已进入学习闭环</strong><p>错题与反馈已同步到记忆复习；知识点掌握度和错误类型已写入学习画像。</p></div>
              {result.memoryCardsCreated !== undefined || result.semanticFactsUpdated !== undefined ? <span>{result.memoryCardsCreated ?? 0} 张记忆卡 · {result.semanticFactsUpdated ?? 0} 项画像事实</span> : null}
            </div>
            {result.report?.encouragement ? <blockquote>{result.report.encouragement}</blockquote> : null}
            <section className={styles.masterySection}>
              <header><h3>知识点掌握度</h3><small>{masteryEntries.length} 项</small></header>
              {masteryEntries.length > 0 ? <div>{masteryEntries.map(([point, item]) => <article key={point}><span><strong>{point}</strong><small>{item.level || (item.score >= .8 ? "掌握" : item.score >= .6 ? "巩固" : "薄弱")}</small></span><div><i style={{ width: `${item.score * 100}%` }} /></div><b>{Math.round(item.score * 100)}%</b></article>)}</div> : <p className={styles.noResultDetail}>这份历史记录没有分项掌握度。</p>}
            </section>
            {(result.report?.strengths?.length || result.report?.weaknesses?.length || suggestions.length) ? <div className={styles.resultNotes}>
              <section><h3>已掌握</h3><div>{result.report?.strengths?.map((item) => <span key={item}>{item}</span>) || <small>暂无</small>}</div></section>
              <section><h3>需要复盘</h3><div>{result.report?.weaknesses?.map((item) => <span key={item}>{item}</span>) || <small>暂无</small>}</div></section>
              <section><h3>后续建议</h3><div>{suggestions.map((item) => <span key={item}>{item}</span>)}</div></section>
            </div> : null}
            {wrongRows.length > 0 ? <section className={styles.wrongSection}><header><h3>错题反馈</h3><small>{wrongRows.length} 题</small></header>{wrongRows.map((row, index) => <article key={`${row.question_id}-${index}`}><span>{index + 1}</span><div><strong>{row.knowledge_point || "综合应用"}</strong><p>{row.feedback || "已归档，建议结合参考答案重新作答。"}</p></div><b>{row.score}/{row.max_score}</b></article>)}</section> : null}
            <footer className={styles.resultActions}><NextLink href="/desktop/profile"><UserRound aria-hidden />查看学习画像</NextLink><button type="button" onClick={openWrongbook}><BrainCircuit aria-hidden />查看错题与记忆</button><button type="button" onClick={() => openPathWorkspace("plan")}><ArrowRight aria-hidden />回到学习计划</button></footer>
          </section>
        </div>
      </main>
    );
  };

  return (
    <div className={pathStyles.page}>
      <div className={pathStyles.frame}>
        <CourseAssessmentTopbar courseCount={subjectPaths.length} assessmentCount={history.length} onOpenWorkspace={openPathWorkspace} />
        {stage === "setup" ? renderSetup() : null}
        {stage === "generating" ? renderGenerating() : null}
        {stage === "questions" ? renderQuestions() : null}
        {stage === "grading" ? renderGrading() : null}
        {stage === "result" ? renderResult() : null}
      </div>
    </div>
  );
}
