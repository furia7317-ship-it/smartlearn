"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpenCheck, CheckCircle2, ClipboardList, FileClock, FileText, Loader2, RefreshCw, Search } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { getPaperDetail, listPapers, type PaperDetail, type PaperSummary } from "@/lib/library";
import { COURSE_ASSESSMENT_CATEGORY, QUESTION_TYPE_LABEL, type CourseAssessmentQuestionType } from "@/lib/course-assessment";
import { filterPapers, PAPER_STATUS_LABEL, paperAnswerText } from "@/lib/paper-center";
import styles from "./desktop-paper-center.module.css";

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function PaperCenterWorkspace() {
  const { mode, hydrated } = useOrchestratorContext((state) => ({ mode: state.mode, hydrated: state.hydrated }));
  const router = useRouter();
  const searchParams = useSearchParams();
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [onlyWrong, setOnlyWrong] = useState(false);
  const [revision, setRevision] = useState(0);
  const filtered = useMemo(() => filterPapers(papers, query, status, category), [papers, query, status, category]);
  const requestedId = searchParams.get("paper");
  const selectedId = filtered.find((paper) => paper.id === requestedId)?.id || filtered[0]?.id || "";
  const completed = papers.filter((paper) => paper.status === "graded");
  const categories = [...new Set(papers.map((paper) => paper.category))];

  useEffect(() => {
    if (!hydrated || mode === "checking") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    listPapers(mode, { force: true }).then((items) => { if (!cancelled) setPapers(items); }).catch(() => {
      if (!cancelled) setError("暂时无法读取试卷，请检查学习服务后重试。");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrated, mode, revision]);

  useEffect(() => {
    setDetail(null);
    setDetailError("");
    setOnlyWrong(false);
    if (!selectedId || mode === "checking") return;
    let cancelled = false;
    setLoadingDetail(true);
    getPaperDetail(mode, selectedId).then((paper) => {
      if (cancelled) return;
      if (paper) setDetail(paper);
      else setDetailError("这份试卷读取失败，请刷新重试。");
    }).finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [mode, selectedId, revision]);

  const graded = detail?.status === "graded";
  const results = new Map(detail?.results?.map((row) => [row.question_id, row]));

  return <div className={styles.page}>
    <header className={styles.topbar}><div><Link href="/desktop/resources" aria-label="返回资源中心"><ArrowLeft size={17} /></Link><span>资源中心</span><i>/</i><strong>试卷中心</strong></div><Link href="/desktop/path/assessment"><ClipboardList size={16} />新建课程测评</Link></header>
    <main className={`thin-scroll ${styles.body}`}>
      <section className={styles.hero}><div><span className={styles.eyebrow}>EXAM ARCHIVE</span><h1>试卷中心</h1><p>一场考试，一份卷宗。留存试卷、作答与批改，回看每一次学习的进步。</p><div className={styles.heroMeta}><span><FileText size={15} />{papers.length} 份试卷</span><span><CheckCircle2 size={15} />{completed.length} 份已完成</span><span><FileClock size={15} />{papers.length - completed.length} 份待完成</span></div></div><span className={styles.seal} aria-hidden>卷</span></section>
      <section className={styles.archive} aria-label="考试试卷档案">
        <header className={styles.filters}><label className={styles.search}><Search size={16} /><input aria-label="搜索试卷" placeholder="搜索试卷、课程或知识主题…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="按考试状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(PAPER_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select aria-label="按试卷分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><button type="button" aria-label="刷新试卷" onClick={() => setRevision((value) => value + 1)} disabled={loading}><RefreshCw size={16} /></button></header>
        {error ? <div className={styles.empty} role="alert"><FileClock /><h2>试卷暂时无法读取</h2><p>{error}</p><button onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : loading ? <div className={styles.empty} role="status"><Loader2 className="animate-spin" /><p>正在整理试卷档案…</p></div> : !filtered.length ? <div className={styles.empty}><BookOpenCheck size={42} /><h2>{papers.length ? "没有符合条件的试卷" : "书架里的第一份试卷，等您写下"}</h2><p>{papers.length ? "试试其他关键词，或清除筛选条件。" : "生成试卷后会自动收录，作答进度与交卷后的批改结果也会保存在这里。"}</p>{papers.length ? <button onClick={() => { setQuery(""); setStatus(""); setCategory(""); }}>清除筛选</button> : <Link href="/desktop/path/assessment">开始课程测评<ArrowRight size={16} /></Link>}</div> : <div className={styles.workspace}>
          <aside className={`thin-scroll ${styles.paperList}`} aria-label="试卷列表"><div className={styles.listHeading}><strong>全部卷宗</strong><span>{filtered.length} 份 · 最近在前</span></div>{filtered.map((paper) => <button type="button" key={paper.id} className={styles.paperCard} aria-pressed={paper.id === selectedId} onClick={() => router.replace(`/desktop/resources/papers?paper=${encodeURIComponent(paper.id)}`, { scroll: false })}><div><span className={styles.category}>{paper.category}</span><span className={styles.status} data-status={paper.status}>{PAPER_STATUS_LABEL[paper.status] || paper.status}</span></div><h2>{paper.title || paper.topic || "未命名试卷"}</h2><p>{paper.topic}</p><footer><span>{paper.question_count} 题 · {formatDate(paper.created_at)}</span><strong>{paper.overall_score != null && paper.status === "graded" ? `${Math.round(paper.overall_score)} 分` : `${paper.answered_count ?? 0}/${paper.question_count} 已答`}</strong></footer></button>)}</aside>
          <section className={`thin-scroll ${styles.detail}`} aria-label="试卷详情">
            {loadingDetail ? <div className={styles.empty} role="status"><Loader2 className="animate-spin" /><p>正在读取答题记录…</p></div> : detailError ? <div className={styles.empty} role="alert"><p>{detailError}</p><button onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : detail && <>
              <header className={styles.detailHeader}><div><span className={styles.eyebrow}>EXAM RECORD</span><h2>{detail.title || detail.topic}</h2><p>出卷于 {formatDate(detail.created_at)}{detail.updated_at ? ` · 最近保存 ${formatDate(detail.updated_at)}` : ""}</p></div>{graded && detail.overall_score != null ? <div className={styles.score}><strong>{Math.round(detail.overall_score)}</strong><span>/ 100 分</span></div> : <span className={styles.status} data-status={detail.status}>{PAPER_STATUS_LABEL[detail.status] || detail.status}</span>}</header>
              <div className={styles.detailSummary}><span>{detail.questions.length} 道题</span><span>{Object.values(detail.answers || {}).filter((value) => value.trim()).length} 道已答</span>{graded && detail.results?.length ? <span>{detail.results.filter((row) => row.correct).length} 道通过</span> : null}{!graded && detail.category === COURSE_ASSESSMENT_CATEGORY ? <Link href={`/desktop/path/assessment?paper=${encodeURIComponent(detail.id)}`}>{detail.status === "submitted" ? "继续评分" : "继续作答"}<ArrowRight size={14} /></Link> : !graded ? <Link href="/desktop/practice">前往练习<ArrowRight size={14} /></Link> : null}</div>
              <div className={styles.questionHeading}><h3>逐题答题记录</h3>{graded ? <label><input type="checkbox" checked={onlyWrong} disabled={!detail.results?.length} onChange={(event) => setOnlyWrong(event.target.checked)} />仅看未通过的题目</label> : <span>交卷并完成评分后可查看参考答案与解析</span>}</div>
              {onlyWrong && !detail.results?.some((row) => !row.correct) ? <div className={styles.empty}><CheckCircle2 /><p>本次试卷没有未通过的题目。</p></div> : detail.questions.map((question, index) => {
                const result = question.id ? results.get(question.id) : undefined;
                if (onlyWrong && (!result || result.correct)) return null;
                const answer = (question.id ? detail.answers?.[question.id] : undefined) ?? result?.student_answer;
                const reference = result?.answer || question.answer;
                return <article key={question.id || index} className={styles.question}><header><span className={styles.number}>{String(index + 1).padStart(2, "0")}</span><strong>{QUESTION_TYPE_LABEL[question.type as CourseAssessmentQuestionType] || (question.type === "judge" ? "判断题" : "试题")}</strong>{question.knowledge_point ? <small>{question.knowledge_point}</small> : null}{result ? <b data-correct={result.correct}>{result.score}{(result.max_score ?? question.score) != null ? ` / ${result.max_score ?? question.score}` : ""} 分</b> : question.score ? <b>{question.score} 分</b> : null}</header><Markdown content={question.stem} />{question.options?.length ? <div className={styles.questionOptions}>{question.options.map((option, optionIndex) => <Markdown key={optionIndex} content={option} />)}</div> : null}<div className={styles.answerBlocks}><section><h4>我的作答</h4><Markdown content={paperAnswerText(answer, question.type, question.options)} /></section>{graded ? <section><h4>参考答案</h4><Markdown content={reference ? paperAnswerText(reference, question.type, question.options) : "这份历史试卷未保存参考答案"} /></section> : null}</div>{graded && (result?.feedback || question.explanation) ? <div className={styles.feedback}>{result?.feedback ? <><h4>批改反馈</h4><Markdown content={result.feedback} /></> : null}{question.explanation ? <><h4>题目解析</h4><Markdown content={question.explanation} /></> : null}</div> : null}</article>;
              })}
            </>}
          </section>
        </div>}
      </section>
    </main>
  </div>;
}

export default function DesktopPaperCenter() {
  return <Suspense fallback={<div className={styles.empty}>正在打开试卷中心…</div>}><PaperCenterWorkspace /></Suspense>;
}
