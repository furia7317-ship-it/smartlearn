"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ArrowRight, Bell, Bookmark, BookOpenCheck, BookX, CalendarDays, CheckCircle2, ChevronDown, ClipboardList, Clock3, Ellipsis, FileText, LayoutGrid, Leaf, List, Loader2, Plus, RefreshCw, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useTeacherWindowActions } from "@/components/desktop/teacher-window-provider";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { Markdown } from "@/components/markdown";
import { QuizRunner } from "@/components/quiz-runner";
import { UserAvatar } from "@/components/user-avatar";
import { useUserSettings } from "@/hooks/use-user-settings";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import { useAppFeatureNavigation } from "@/hooks/use-app-feature-navigation";
import { deletePaper, getPaperDetail, listPapers, setPaperStarred, type PaperDetail, type PaperSummary } from "@/lib/library";
import { COURSE_ASSESSMENT_CATEGORY } from "@/lib/course-assessment";
import { buildPracticeMistakes, buildPracticePapers, practiceStatistics, practiceTimestamp, selectPracticePapers, type PracticeFilter, type PracticePaper, type PracticeSort } from "@/lib/practice-library";
import type { QuizSubmission } from "@/lib/practice-feedback";
import type { QuizQuestion, ResourceItem } from "@/lib/types";
import s from "./desktop-practice.module.css";

const FILTERS = [
  { id: "recommended", label: "推荐题库", icon: Leaf },
  { id: "mine", label: "我的题库", icon: ClipboardList },
  { id: "recent", label: "最近练习", icon: Clock3 },
  { id: "starred", label: "收藏题库", icon: Star },
  { id: "wrongbook", label: "错题本", icon: BookX },
] as const;
const FILTER_IDS = FILTERS.map((filter) => filter.id);
const VIEW_IDS = ["grid", "list"] as const;
type Preferences = { starred: string[]; recent: Record<string, string> };
type OpenPaper = { paper: PracticePaper; questions: QuizQuestion[]; loading: boolean; error: string; resourceId: string };
function shortDate(value?: string) {
  const time = practiceTimestamp(value);
  if (!time) return "当前会话";
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, "0")}月${String(date.getDate()).padStart(2, "0")}日`;
}

export default function DesktopPractice() {
  const router = useRouter();
  const { user } = useAuth();
  const { name } = useUserSettings();
  const { mode, hydrated, resources, practiceAttempts, recordPractice } = useOrchestratorContext();
  const { openTeacher } = useTeacherWindowActions();
  const displayName = name.trim() || user?.display_name || user?.login || "同学";
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [details, setDetails] = useState<PaperDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useDesktopModuleStringState<PracticeFilter>("practice", "archive.filter", "recommended", FILTER_IDS);
  useAppFeatureNavigation("/desktop/practice/", "tab", FILTER_IDS, setFilter);
  const [sort, setSort] = useState<PracticeSort>("recommended");
  const [view, setView] = useDesktopModuleStringState<"grid" | "list">("practice", "archive.view", "grid", VIEW_IDS);
  const [preferences, setPreferences] = useState<Preferences>({ starred: [], recent: {} });
  const [savingStar, setSavingStar] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPaper | null>(null);
  const [deleting, setDeleting] = useState<PracticePaper | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const openRequest = useRef(0);
  const preferenceKey = `sl_practice_library_v1:${user?.id || "local"}`;
  const quizKey = resources.filter((resource) => resource.type === "quiz").map((resource) => `${resource.id}:${resource.version}:${resource.status}`).join("|");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
      setPreferences({ starred: Array.isArray(saved.starred) ? saved.starred.filter((id: unknown) => typeof id === "string") : [], recent: saved.recent && typeof saved.recent === "object" && !Array.isArray(saved.recent) ? saved.recent : {} });
    } catch { setPreferences({ starred: [], recent: {} }); }
  }, [preferenceKey]);
  useEffect(() => {
    if (!hydrated || mode === "checking") return;
    let cancelled = false;
    setLoading(true); setError("");
    listPapers(mode, { force: true }).then((items) => { if (!cancelled) setPapers(items); })
      .catch(() => { if (!cancelled) setError("题库暂时无法读取，请检查连接后重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrated, mode, revision, quizKey]);
  const gradedIds = useMemo(() => papers.filter((paper) => paper.status === "graded").map((paper) => paper.id), [papers]);
  useEffect(() => {
    if (mode === "checking") return;
    let cancelled = false;
    setHistoryLoading(true); setHistoryError("");
    void (async () => {
      const records: PaperDetail[] = [];
      let missing = 0;
      for (let offset = 0; offset < gradedIds.length && !cancelled; offset += 4) {
        const batch = await Promise.all(gradedIds.slice(offset, offset + 4).map((id) => getPaperDetail(mode, id)));
        for (const record of batch) { if (record) records.push(record); else missing += 1; }
      }
      if (!cancelled) {
        setDetails(records); setHistoryLoading(false);
        if (missing) setHistoryError("部分答题记录暂未读到，错题与统计将在重试后补全。");
      }
    })();
    return () => { cancelled = true; };
  }, [mode, gradedIds, revision]);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    if (!open && node?.open) node.close();
  }, [open]);
  useEffect(() => {
    const node = deleteDialog.current;
    if (deleting && node && !node.open) node.showModal();
    if (!deleting && node?.open) node.close();
  }, [deleting]);

  const allPapers = useMemo(() => buildPracticePapers(papers, resources, practiceAttempts), [papers, resources, practiceAttempts]);
  const filtered = useMemo(() => selectPracticePapers(allPapers, { filter, query, sort, ...preferences }), [allPapers, filter, query, sort, preferences]);
  const mistakes = useMemo(() => buildPracticeMistakes(details, practiceAttempts, allPapers), [details, practiceAttempts, allPapers]);
  const visibleMistakes = mistakes.filter((question) => !query.trim() || [question.stem, question.paperTitle, question.topic].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const stats = useMemo(() => practiceStatistics(details, practiceAttempts, allPapers), [details, practiceAttempts, allPapers]);
  const busy = loading || !hydrated;
  const savePreferences = (next: Preferences) => { localStorage.setItem(preferenceKey, JSON.stringify(next)); setPreferences(next); };
  const requestPractice = (topic?: string) => openTeacher({ module: "practice", title: "练习与错题", detail: topic ? `请针对「${topic}」和我的错题，为我生成一组有针对性的练习，并保存为独立练习卷。` : "请结合当前学习内容和薄弱知识点，推荐适合我的练习，并生成一份独立保存的练习卷。" });
  const closePaper = useCallback(() => { openRequest.current += 1; setOpen(null); }, []);
  const openPaper = async (paper: PracticePaper) => {
    setActionError("");
    try { savePreferences({ ...preferences, recent: { ...preferences.recent, [paper.id]: new Date().toISOString() } }); }
    catch { setActionError("本机暂时无法保存最近打开记录，仍可继续练习。"); }
    if (paper.category === COURSE_ASSESSMENT_CATEGORY) { router.push(`/desktop/path/assessment?paper=${encodeURIComponent(paper.id)}`); return; }
    const request = ++openRequest.current;
    const sessionQuestions = paper.sessionResource?.data?.questions;
    if (paper.id.startsWith("session_") && sessionQuestions?.length) { setOpen({ paper, questions: sessionQuestions, loading: false, error: "", resourceId: paper.sessionResource!.id }); return; }
    setOpen({ paper, questions: [], loading: true, error: "", resourceId: paper.id });
    const detail = await getPaperDetail(mode, paper.id);
    if (request !== openRequest.current) return;
    setOpen({ paper, questions: detail?.questions || [], loading: false, error: detail?.questions.length ? "" : "未能读取这份练习卷，请重试。", resourceId: paper.id });
  };
  const toggleStar = async (paper: PracticePaper) => {
    if (savingStar) return;
    setSavingStar(paper.id); setActionError("");
    const starred = !paper.starred && !preferences.starred.includes(paper.id);
    try {
      if (paper.id.startsWith("session_")) savePreferences({ ...preferences, starred: starred ? [...preferences.starred, paper.id] : preferences.starred.filter((id) => id !== paper.id) });
      else { await setPaperStarred(mode, paper.id, starred); setPapers((items) => items.map((item) => item.id === paper.id ? { ...item, starred } : item)); }
    } catch { setActionError("收藏未能保存，请稍后重试。"); }
    finally { setSavingStar(null); }
  };
  const removePaper = async () => {
    if (!deleting || deletingBusy) return;
    setDeletingBusy(true); setActionError("");
    try { await deletePaper(mode, deleting.id); setPapers((items) => items.filter((item) => item.id !== deleting.id)); setDetails((items) => items.filter((item) => item.id !== deleting.id)); setDeleting(null); }
    catch { setActionError("试卷删除失败，原试卷仍然保留。"); }
    finally { setDeletingBusy(false); }
  };
  const onSubmit = (submission: QuizSubmission) => {
    if (!open) return;
    const resource: ResourceItem = { id: open.resourceId, type: "quiz", title: open.paper.title, subtitle: open.paper.topic, meta: [], status: "ready", version: 1, sources: 0, data: { questions: open.questions } };
    recordPractice(resource, submission);
  };

  return <div className={`${s.page} thin-scroll`} data-desktop-scroll-memory="practice"><div className={s.frame}>
    <header className={s.topbar}>
      <label className={s.search}><Search size={23} aria-hidden /><input aria-label="搜索题库、知识点或试卷" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、知识点或试卷…" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}><X size={17} /></button>}</label>
      <div className={s.accountTools}><details className={s.notice}><summary aria-label="练习提醒"><Bell size={23} />{mistakes.length > 0 && <span className={s.noticeDot} />}</summary><div className={s.noticePanel}><strong>练习提醒</strong><p>{mistakes.length ? `还有 ${mistakes.length} 道错题可以复盘。` : "今天也从一道练习开始。"}</p><button onClick={(event) => { setFilter("wrongbook"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>查看错题本<ArrowRight size={14} /></button></div></details><Link href="/desktop/profile" className={s.account}><UserAvatar name={displayName} userId={user?.id} size={46} fallback="mascot" /><span><strong>你好，{displayName}</strong><small>今日亦是精进的一天</small></span><ChevronDown size={18} /></Link></div>
    </header>
    <section className={s.hero} aria-labelledby="practice-heading"><Image className={s.heroImage} src="/brand/practice/practice-hero-v1.webp" alt="" fill priority sizes="(max-width: 767px) 100vw, calc(100vw - 192px)" /><div className={s.heroCopy}><h1 id="practice-heading">练习与错题</h1><p>每次生成的练习卷独立存档于试题库 · 批改后自动归档错题</p><small>以练促学 · 以错为鉴 · 日进有常</small></div><p className={s.heroVerse}>学而时习之<br />不亦说乎</p></section>
    <section className={s.library} aria-label="练习题库">
      <div className={s.toolbar}><div className={s.filters} role="group" aria-label="题库分类">{FILTERS.map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => { setFilter(id); setSort(id === "recommended" ? "recommended" : "latest"); }}><Icon size={21} aria-hidden /><span>{label}</span>{id === "wrongbook" && mistakes.length > 0 && <small>{mistakes.length}</small>}</button>)}</div><div className={s.viewTools}>{filter !== "wrongbook" && <><label className={s.sort}><SlidersHorizontal size={18} aria-hidden /><select aria-label="题库排序" value={sort === "recommended" && filter !== "recommended" ? "latest" : sort} onChange={(event) => setSort(event.target.value as PracticeSort)}>{filter === "recommended" && <option value="recommended">推荐排序</option>}<option value="latest">最新发布</option><option value="oldest">最早发布</option><option value="score-low">分数从低到高</option><option value="score-high">分数从高到低</option></select></label><div className={s.viewSwitch} role="group" aria-label="题库视图"><button type="button" aria-label="卡片视图" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid size={21} /></button><button type="button" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={22} /></button></div></>}<button className={s.refresh} type="button" disabled={busy || historyLoading} aria-label="刷新题库" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={17} /></button></div></div>
      {actionError && <p className={s.error} role="alert">{actionError}</p>}
      {historyError && !busy && <div className={s.error} role="status">{historyError}<button onClick={() => setRevision((value) => value + 1)}>重试</button></div>}
      {error ? <div className={s.empty} role="alert"><BookOpenCheck size={32} /><h2>题库暂时无法读取</h2><p>{error}</p><button onClick={() => setRevision((value) => value + 1)}>重新读取</button></div> : busy ? <div className={s.empty} role="status"><Loader2 className="animate-spin" size={28} /><p>正在整理你的练习卷…</p></div> : filter === "wrongbook" ? <>
        <div className={s.wrongHeading}><div><h2>从错题里，找到下一步</h2><p>{historyLoading ? "正在补全历史错题…" : `${visibleMistakes.length} 道错题 · 按最近记录排序`}</p></div><button onClick={() => requestPractice(visibleMistakes.slice(0, 3).map((item) => item.topic).join("、") || undefined)}><Plus size={17} />针对错题再练</button></div>
        {visibleMistakes.length ? <div className={s.wrongList}>{visibleMistakes.map((question, index) => <article className={s.wrongCard} key={question.id}><header><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{question.topic}</strong><small>{question.paperTitle} · {shortDate(question.date)}</small></div><button onClick={() => requestPractice(question.topic)}>同类再练<ArrowRight size={15} /></button></header><Markdown content={question.stem} />{question.options?.length ? <div className={s.options}>{question.options.map((option, optionIndex) => <Markdown key={optionIndex} content={option} />)}</div> : null}<details><summary>查看答案与解析<ChevronDown size={16} /></summary><div className={s.answers}><section><h3>我的答案</h3><Markdown content={question.chosen} /></section><section><h3>正确答案</h3><Markdown content={question.answer} /></section></div>{question.explanation && <div className={s.explanation}><h3>解题思路</h3><Markdown content={question.explanation} /></div>}</details></article>)}</div> : <div className={s.empty}><CheckCircle2 size={32} /><h2>{query ? "没有找到相关错题" : "错题本是空的"}</h2><p>{query ? "试试题目中的关键词，或清空搜索。" : "完成练习后，错题和解析会整理到这里。"}</p><button onClick={() => { setQuery(""); setFilter("mine"); }}>去做练习<ArrowRight size={16} /></button></div>}
      </> : <>
        <p className={s.resultCount} aria-live="polite">{filtered.length} 份练习卷{filter === "recent" ? " · 最近打开或作答" : filter === "starred" ? " · 已收藏" : ""}</p>
        {!filtered.length && <div className={s.empty}><BookOpenCheck size={32} /><h2>{query ? "没有找到相关练习" : filter === "starred" ? "把想复习的题库收藏在这里" : filter === "recent" ? "还没有最近练习" : "第一份练习，从这里开始"}</h2><p>{query ? "试试其他关键词，或清空搜索条件。" : filter === "starred" ? "点击题库右上角的书签，随时回来继续。" : "让智能教师结合你的学习进度，准备一份适合的练习。"}</p><button onClick={() => { if (query) setQuery(""); else if (filter === "starred" || filter === "recent") setFilter("mine"); else requestPractice(); }}>{query ? "清空搜索" : filter === "starred" || filter === "recent" ? "浏览我的题库" : "生成第一份练习"}<ArrowRight size={16} /></button></div>}
        <div className={s.paperGrid} data-view={view}>{filtered.map((paper) => {
          const starred = Boolean(paper.starred || preferences.starred.includes(paper.id));
          const score = paper.status === "graded" ? paper.overall_score : null;
          const datedTitle = paper.title.match(/^(.*?)\s*·\s*(\d{2}-\d{2})$/);
          const tags = paper.tags.filter((tag) => !["演示痕迹", "生成", "会话"].includes(tag)).slice(0, 3);
          return <article className={s.paperCard} key={paper.id}><Image src={`/brand/practice/${Array.from(paper.id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 ? "card-bamboo-v1.webp" : "card-plum-v1.webp"}`} className={s.cardArt} alt="" fill sizes="(max-width: 620px) 90vw, (max-width: 1120px) 45vw, 330px" /><div className={s.cardTop}><span className={s.category} title={paper.topic || paper.category}>{paper.tags.find((tag) => tag.length <= 8 && !["演示痕迹", "阶段测验"].includes(tag)) || paper.category}</span><button type="button" className={s.bookmark} aria-label={`${starred ? "取消收藏" : "收藏"}《${paper.title}》`} aria-pressed={starred} disabled={savingStar === paper.id} onClick={() => void toggleStar(paper)}>{savingStar === paper.id ? <Loader2 className="animate-spin" size={17} /> : <Bookmark size={19} fill={starred ? "currentColor" : "none"} />}</button></div><div className={s.cardCopy}><h2><button aria-label={paper.title} onClick={() => void openPaper(paper)}>{datedTitle ? <>{datedTitle[1]}<span className={s.titleDate}>{datedTitle[2]}</span></> : paper.title}</button></h2>{(!paper.topic || !paper.title.includes(paper.topic)) && <p title={paper.topic}>{paper.topic || "围绕所学，巩固理解"}</p>}</div><div className={s.tags}>{(tags.length ? tags : [paper.category]).map((tag, tagIndex) => <span key={`${tag}-${tagIndex}`}>{tag}</span>)}</div><div className={s.cardMeta}><span><FileText size={16} />{paper.question_count} 题</span><time dateTime={paper.created_at || undefined}><CalendarDays size={16} />{shortDate(paper.created_at)}</time><strong className={s.score} data-level={score == null ? "pending" : score < 60 ? "low" : score < 80 ? "medium" : "good"}>{score != null ? `${Math.round(score)} 分` : paper.status === "submitted" ? "待批改" : paper.status === "in_progress" ? "作答中" : "待作答"}</strong></div><div className={s.cardActions}><button className={s.start} onClick={() => void openPaper(paper)}>{paper.category === COURSE_ASSESSMENT_CATEGORY && paper.status === "graded" ? "查看答卷" : "开始练习"}<ArrowRight size={19} /></button>{!paper.id.startsWith("session_") && <details className={s.more}><summary aria-label={`管理《${paper.title}》`}><Ellipsis size={19} /></summary><div><button onClick={() => { setActionError(""); setDeleting(paper); }}><Trash2 size={15} />删除试卷</button></div></details>}</div></article>;
        })}<button type="button" className={s.discoverCard} onClick={() => requestPractice()}><span className={s.plus}><Plus size={37} /></span><strong>发现更多题库</strong><small>探索个性化练习内容</small></button></div>
      </>}
    </section>
    <footer className={s.footer}><div className={s.quote}><Leaf size={32} aria-hidden /><div><h2>每日一言</h2><p>“学而不思则罔，思而不学则殆。”<span> ——《论语》</span></p></div></div><dl className={s.statistics} aria-label="练习统计" title="按保存的练习提交记录与试卷归档日期统计；正确率按逐题批改结果计算。"><div><dt>本周练习</dt><dd>{busy || historyLoading || historyError ? "—" : stats.weekly}</dd></div><div><dt>正确率</dt><dd>{busy || historyLoading || historyError || stats.accuracy == null ? "—" : `${stats.accuracy}%`}</dd></div><div><dt>累计天数</dt><dd>{busy || historyLoading || historyError ? "—" : stats.days}</dd></div></dl></footer>
  </div>{hydrated && createPortal(<>
    <dialog ref={dialog} className={s.dialog} aria-labelledby="practice-dialog-title" onCancel={closePaper} onClose={closePaper} onClick={(event) => { if (event.target === event.currentTarget) closePaper(); }}>{open && <div className={s.dialogFrame}><header><div><h2 id="practice-dialog-title">{open.paper.title}</h2><p>{open.paper.topic} · {open.paper.question_count} 题</p></div><button type="button" onClick={closePaper} aria-label="关闭练习"><X size={22} /></button></header><div className={`${s.dialogBody} thin-scroll`}>{open.loading ? <div className={s.empty} role="status"><Loader2 className="animate-spin" /><p>正在打开练习…</p></div> : open.error ? <div className={s.empty} role="alert"><p>{open.error}</p><button onClick={() => void openPaper(open.paper)}>重试</button></div> : <QuizRunner key={open.resourceId} questions={open.questions} onSubmit={onSubmit} onClose={closePaper} />}</div></div>}</dialog>
    <dialog ref={deleteDialog} className={`${s.dialog} ${s.deleteDialog}`} aria-labelledby="delete-paper-title" onCancel={(event) => { if (deletingBusy) event.preventDefault(); else setDeleting(null); }} onClose={() => setDeleting(null)}>{deleting && <div className={s.deleteBody}><h2 id="delete-paper-title">删除这份试卷？</h2><p>《{deleting.title}》将从题库中移除。</p>{actionError && <p role="alert">{actionError}</p>}<div><button disabled={deletingBusy} onClick={() => setDeleting(null)}>保留试卷</button><button disabled={deletingBusy} onClick={() => void removePaper()}>{deletingBusy ? "正在删除…" : "删除试卷"}</button></div></div>}</dialog>
  </>, document.body)}</div>;
}
