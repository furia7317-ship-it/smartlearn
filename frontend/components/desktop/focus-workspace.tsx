"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Check, CheckCircle, Clock, FolderOpen, LockKey, MagnifyingGlass, Pause, Plus, Target, TreeStructure, X, ArrowClockwise } from "@phosphor-icons/react";
import { useAuth } from "@/components/auth-provider";
import { focusRequest, loadFocus, performFocusAction, focusStudyHref, FOCUS_LABELS, RESOURCE_LABELS, FocusApiError, type FocusSnapshot, type FocusCourse, type FocusJob, type FocusAction } from "@/lib/focus-api";
import { KnowledgeIcon } from "./focus-tree-canvas";
import styles from "./focus-workspace.module.css";

const FocusTreeCanvas = dynamic(() => import("./focus-tree-canvas"), { ssr: false, loading: () => <div className={styles.canvasMessage}>正在铺展知识图…</div> });
type ExistingCourse = { title: string; goal: string; outline: string };

function safeLink(url: string): boolean { try { return ["https:", "http:"].includes(new URL(url).protocol); } catch { return false; } }
function rememberRoute(graph: string, node: string) {
  const url = new URL(location.href);
  url.searchParams.set("graph", graph); url.searchParams.set("node", node);
  history.replaceState(history.state, "", url);
}

export default function FocusWorkspace({ onLegacy, existingCourses = [] }: { onLegacy: () => void; existingCourses?: ExistingCourse[] }) {
  const { user } = useAuth();
  const router = useRouter();
  const [courses, setCourses] = useState<FocusCourse[]>([]);
  const [jobs, setJobs] = useState<FocusJob[]>([]);
  const [courseId, setCourseId] = useState("");
  const [state, setState] = useState<FocusSnapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("details");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"new" | "plan" | "prerequisites" | null>(null);
  const [requiredDraft, setRequiredDraft] = useState<string[]>([]);
  const [budget, setBudget] = useState(60);
  const [draft, setDraft] = useState({ title: "", goal: "", source_outline: "" });
  const [courseMenu, setCourseMenu] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [mobileList, setMobileList] = useState(false);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const smallWindow = window.matchMedia("(max-width: 760px)");
    const updateView = () => setMobileList(smallWindow.matches);
    updateView(); smallWindow.addEventListener("change", updateView);
    return () => smallWindow.removeEventListener("change", updateView);
  }, []);
  const latestCourse = useRef(courseId);
  useEffect(() => { latestCourse.current = courseId; }, [courseId]);
  const storageKey = `xueshu.focus.course.${user?.id || ""}`;
  useEffect(() => {
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusable = () => [...(modal?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]') || [])];
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDialog(null); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    modal?.addEventListener("keydown", trap);
    return () => { modal?.removeEventListener("keydown", trap); previous?.focus(); };
  }, [dialog]);
  const refreshCourses = useCallback(async () => {
    const result = await focusRequest<{ courses: FocusCourse[]; jobs: FocusJob[] }>("/courses");
    setCourses(result.courses); setJobs(result.jobs);
    return result;
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    refreshCourses().then(result => {
      if (cancelled) return;
      let saved = "";
      try { saved = localStorage.getItem(storageKey) || ""; } catch { /* optional */ }
      const query = new URLSearchParams(location.search).get("graph");
      setCourseId([query, saved].find(id => result.courses.some(c => c.id === id)) || result.courses.find(c => c.status === "published")?.id || result.courses[0]?.id || "");
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [user, storageKey, refreshCourses]);
  useEffect(() => {
    if (!courseId) return;
    const controller = new AbortController();
    setState(null); setError(""); setSearch("");
    loadFocus(courseId, controller.signal).then(result => {
      setState(result); setBudget(result.plan.daily_minutes);
      let saved = "";
      try { localStorage.setItem(storageKey, courseId); saved = sessionStorage.getItem(`xueshu.focus.selection.${courseId}`) || ""; } catch { /* optional */ }
      const queryNode = new URLSearchParams(location.search).get("node") || "";
      const next = [queryNode, saved, result.active_node_id, result.plan.focus_node_id].find(id => result.graph.nodes.some(n => n.id === id)) || result.graph.nodes[0].id;
      setSelected(next); rememberRoute(courseId, next);
    }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [courseId, storageKey]);
  const pending = jobs.some(j => j.status === "pending" || j.status === "running");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { void refreshCourses().catch(() => undefined); }, 3500);
    return () => clearInterval(timer);
  }, [pending, refreshCourses]);
  const select = (id: string) => {
    setSelected(id); setTab("details"); setMobileDetail(true);
    rememberRoute(courseId, id);
    try { sessionStorage.setItem(`xueshu.focus.selection.${courseId}`, id); } catch { /* optional */ }
  };
  const act = async (action: FocusAction) => {
    if (!state || busy) return null;
    setBusy(true); setError("");
    try {
      const result = await performFocusAction(state, action);
      if (latestCourse.current === result.state.id) setState(result.state);
      return result.state;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作未完成");
      if (e instanceof FocusApiError && e.status === 409 && latestCourse.current === state.id) setState(await loadFocus(state.id));
      return null;
    } finally { setBusy(false); }
  };
  const node = state?.graph.nodes.find(n => n.id === selected);
  const record = node && state?.nodes[node.id];
  const chapter = state?.graph.modules.find(m => m.id === node?.module_id);
  const total = state?.progress.total || 0;
  const percent = total ? Math.round((state!.progress.passed / total) * 100) : 0;
  const openStudy = async (task = "lesson") => {
    if (!state || !node || !record?.available) return;
    if (record.status !== "passed" && state.active_node_id !== node.id) {
      const updated = await act({ action: "start", node_id: node.id });
      if (!updated) return;
    }
    router.push(focusStudyHref(state.id, node.id, task));
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await focusRequest<FocusJob>("/courses/generate", { ...draft, request_id: crypto.randomUUID() }); await refreshCourses(); setDialog(null); }
    catch (e) { setError(e instanceof Error ? e.message : "课程图未能生成"); }
    finally { setBusy(false); }
  };
  const publish = async () => {
    if (!state) return;
    setBusy(true); setError("");
    try { setState(await focusRequest<FocusSnapshot>(`/courses/${state.id}/publish`, {})); await refreshCourses(); }
    catch (e) { setError(e instanceof Error ? e.message : "启用失败"); }
    finally { setBusy(false); }
  };
  const savePrerequisites = async () => {
    if (!state || !node) return;
    setBusy(true); setError("");
    try {
      const graph = { ...state.graph, nodes: state.graph.nodes.map(n => n.id === node.id ? { ...n, prerequisites: { ...n.prerequisites, all_of: requiredDraft } } : n),
        relations: state.graph.relations.filter(r => !(r.target === node.id && requiredDraft.includes(r.source) && r.kind === "recommended")) };
      setState(await focusRequest<FocusSnapshot>(`/courses/${state.id}/draft`, graph)); setDialog(null);
    } catch (e) { setError(e instanceof Error ? e.message : "前置关系保存失败"); }
    finally { setBusy(false); }
  };
  const prerequisite = (id: string) => {
    const target = state?.graph.nodes.find(n => n.id === id);
    const passed = state?.nodes[id]?.status === "passed";
    return <button key={id} className={styles.prerequisite} onClick={() => select(id)}><span>{passed ? <CheckCircle weight="fill" /> : <LockKey />}{target?.title || id}</span><small>{passed ? "已通过" : "查看基础"}</small></button>;
  };
  return <div className={styles.workspace} data-focus-curriculum>
    <section className={styles.main} aria-label="课程知识树">
      <header className={styles.courseHeader}><div><h2>{state?.graph.title || "课程知识树"}</h2><p>{state?.graph.goal || "按章节整理知识点，沿着前置关系逐步学习。"}</p></div><button className={styles.createCourse} onClick={() => setDialog("new")}><Plus size={16} />创建知识树</button></header>
      <div className={styles.pathToolbar}>
        <div className={styles.coursePicker}><button onClick={() => setCourseMenu(v => !v)} aria-expanded={courseMenu}><TreeStructure size={17} />切换课程<span>⌄</span></button>
          {courseMenu && <div className={styles.courseMenu}><strong>选择课程</strong>{courses.map(c => <button key={c.id} onClick={() => { setCourseId(c.id); setCourseMenu(false); }} aria-pressed={courseId === c.id}>{c.title}<small>{c.status === "draft" ? "待确认" : c.origin === "starter" ? "入门课程" : "已启用"}</small></button>)}<button onClick={() => { setDialog("new"); setCourseMenu(false); }}><Plus size={15} />创建课程知识树</button><button onClick={onLegacy}>管理已有课程与资料</button></div>}
        </div>
        <label className={styles.search}><MagnifyingGlass size={17} /><input placeholder="查找知识点…" aria-label="搜索知识点" value={search} onChange={e => setSearch(e.target.value)} /></label><button onClick={() => setDialog("plan")}><Clock size={15} />每日 {state?.plan.daily_minutes || 60} 分钟</button>
        <div className={styles.overallProgress}><div><span>已通过节点 <strong>{state?.progress.passed || 0}</strong> / {total}</span><span>主线进度 <strong>{percent}%</strong></span></div><progress value={percent} max="100" aria-label="主线完成进度" /></div>
      </div>
      <div className={styles.mobileSwitch}><button onClick={() => setMobileList(v => !v)}>{mobileList ? "查看完整树" : "按章节查看"}</button><button onClick={() => setDialog("new")}><Plus size={15} />新课程</button></div>
      {error && <div className={styles.error} role="alert">{error}<button aria-label="关闭提示" onClick={() => setError("")}><X size={16} /></button></div>}
      {jobs.map(job => <div className={styles.jobNotice} key={job.id}>{job.status === "failed" ? <span>{job.title}：{job.error}</span> : <span>正在整理「{job.title}」的知识点和前置关系，完成后会出现在课程列表。</span>}{job.status === "failed" && <button onClick={async () => { await focusRequest(`/jobs/${job.id}/retry`, {}); await refreshCourses(); }}>重试</button>}</div>)}
      {state?.status === "draft" && <div className={styles.draftNotice}><p><strong>课程草稿待确认</strong>请检查每章的知识点与前置关系。确认后启用，原来的课程和学习记录会保留。</p><button disabled={busy} onClick={publish}>确认并启用</button></div>}
      {!state ? <div className={styles.canvasMessage}>{error ? <button onClick={() => location.reload()}><ArrowClockwise />重新连接</button> : "正在读取课程与学习记录…"}</div> : <>
        <div className={`${styles.canvasFrame} ${mobileList ? styles.hideCanvas : ""}`}><FocusTreeCanvas state={state} selected={selected} onSelect={select} search={search} /></div>
        {mobileList && <div className={styles.chapterList}>{state.graph.modules.map(m => <section key={m.id}><h2>{m.title}</h2>{state.graph.nodes.filter(n => n.module_id === m.id && n.title.includes(search)).map(n => <button key={n.id} onClick={() => select(n.id)}><KnowledgeIcon icon={n.icon} /><span>{n.title}<small>{FOCUS_LABELS[state.nodes[n.id].status]} · {n.estimated_minutes} 分钟</small></span><ArrowRight /></button>)}</section>)}</div>}
      </>}
    </section>
    <aside className={`${styles.detail} ${mobileDetail ? styles.detailOpen : ""}`} aria-label="知识点详情">
      <button className={styles.detailClose} aria-label="收起知识点详情" onClick={() => setMobileDetail(false)}><X size={21} /></button>
      {node && record && state ? <>
        <div className={styles.detailHeading}><div className={styles.detailEmblem}><KnowledgeIcon icon={node.icon} size={32} /></div><div><h2>{node.title}</h2><span className={styles.statusBadge} data-status={record.status}>{FOCUS_LABELS[record.status]}</span><div className={styles.tags}><span>{chapter?.title}</span><span>{node.kind === "extension" ? "拓展选修" : node.kind === "milestone" ? "阶段成果" : "主线必修"}</span></div></div></div>
        <div className={styles.detailTabs} role="tablist" aria-label="节点内容">{[["details", "详情"], ["tasks", "学习任务"], ["resources", "相关资源"]].map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{title}</button>)}</div>
        <div className={styles.detailBody} role="tabpanel">
          {tab === "details" ? <>
            <section><h3><Target />学习目标</h3><p>{node.objective}</p></section>
            <section><h3><LockKey />前置条件{state.status === "draft" && <button className={styles.editPrerequisites} onClick={() => { setRequiredDraft(node.prerequisites.all_of); setDialog("prerequisites"); }}>调整</button>}</h3>{node.prerequisites.all_of.length > 0 && <><small className={styles.ruleLabel}>以下基础需要全部通过</small>{node.prerequisites.all_of.map(prerequisite)}</>}
              {node.prerequisites.any_of_groups.map((group, i) => <div className={styles.anyGroup} key={i}><small className={styles.ruleLabel}>备选路线 {i + 1} · 任选一项通过</small>{group.map(prerequisite)}</div>)}
              {!node.prerequisites.all_of.length && !node.prerequisites.any_of_groups.length && <p className={styles.muted}>无需前置基础，可以从这里开始。</p>}
              {state.graph.relations.filter(r => r.target === node.id && r.kind === "recommended").map(r => <div key={r.source} className={styles.recommend}><small>建议先学 · 不影响开始</small><button onClick={() => select(r.source)}>{state.graph.nodes.find(n => n.id === r.source)?.title}<ArrowRight size={13} /></button><p>{r.reason}</p></div>)}
            </section>
            <section><h3><Clock />预计用时</h3><p className={styles.duration}>{node.estimated_minutes} 分钟<span>可分多次完成</span></p></section>
          </> : tab === "tasks" ? <section><h3><BookOpen />本节点怎么学</h3>{[["lesson", "理解讲解", "掌握概念、作用与使用条件"], ["example", "示例练习", "复现示例，再改变条件观察结果"], ["assessment", "独立核验", "提交答案，由系统核对结果"]].map(([key, title, detail]) => <button className={styles.taskRow} key={key} disabled={!record.available || state.status !== "published"} onClick={() => openStudy(key)}>{record.tasks.includes(key) ? <CheckCircle weight="fill" /> : <span className={styles.emptyCircle} />}<span>{title}<small>{detail}</small></span><ArrowRight size={16} /></button>)}<p className={styles.muted}>阅读与练习记录会保存。只有核验通过，节点才会点亮。</p></section> : <section><h3><FolderOpen />学习资料</h3><p>{RESOURCE_LABELS[state.resources[node.id]] || "按需准备"}</p><p className={styles.muted}>讲解、示例和核验题围绕当前知识点准备，进入学习后可以查看。</p><h4>参考来源</h4>{state.graph.sources.filter(s => node.source_ids.includes(s.id)).map(source => safeLink(source.url) ? <a key={source.id} className={styles.sourceLink} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowRight size={14} /></a> : <p key={source.id}>{source.title}</p>)}<Link className={styles.sourceLink} href="/desktop/kb/">查看我的知识库<ArrowRight size={14} /></Link></section>}
          <div className={styles.detailActions}>
            <button className={styles.primary} disabled={busy || !record.available || state.status !== "published"} onClick={() => openStudy()}>{record.status === "passed" ? "回顾学习" : record.status === "active" || record.status === "paused" ? "继续学习" : record.available ? "开始学习" : "完成前置后开启"}<ArrowRight size={21} /></button>
            <button className={styles.secondary} disabled={busy || !record.available || state.status !== "published"} onClick={() => openStudy("assessment")}>直接核验</button>
            {state.active_node_id === node.id && <button className={styles.pauseAction} disabled={busy} onClick={() => act({ action: "pause", node_id: node.id })}><Pause size={14} />暂停此节点，保留进度</button>}
          </div>
          <div className={styles.nodeProgress}><span>学习任务 <strong>{record.tasks.length} / 3</strong></span><progress max="3" value={record.tasks.length} />{record.last_score != null && <small>最近核验 {record.last_score} 分{record.passed_at ? " · 已通过" : " · 可以重新学习后再试"}</small>}</div>
          <p className={styles.detailQuote}>积跬步以至千里，<br />知此途，必有所成。</p>
        </div>
      </> : <div className={styles.canvasMessage}>选择一个知识点<br />查看学习目标与前置条件</div>}
    </aside>
    <footer className={styles.todayBar}><button onClick={() => setDialog("plan")}><Clock size={21} /><strong>今日任务</strong></button><span className={styles.todayBudget}>{state?.plan.daily_minutes || 60} 分钟</span><div className={styles.todayTasks}>{state?.plan.tasks.map(task => <button key={`${task.node_id}:${task.task}`} onClick={() => { select(task.node_id); router.push(focusStudyHref(state.id, task.node_id, task.task)); }}><span className={styles.emptyCircle} />{task.title}<small>{task.minutes} 分钟</small></button>)}</div><button className={styles.allTasks} onClick={() => setDialog("plan")}>查看全部<ArrowRight size={16} /></button></footer>
    {dialog && <div className={styles.modalBackdrop} onClick={() => setDialog(null)}><section ref={modalRef} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="focus-dialog-title" onClick={e => e.stopPropagation()}><button className={styles.modalClose} aria-label="关闭对话框" onClick={() => setDialog(null)}><X size={22} /></button>
      {dialog === "prerequisites" ? <><h2 id="focus-dialog-title">调整前置条件</h2><p>为「{node?.title}」选择必须先通过的知识点。不要把章节归属当成前置；互相依赖形成循环时，系统会阻止保存。</p><div className={styles.prerequisiteEditor}>{state?.graph.nodes.filter(n => n.id !== selected && !node?.prerequisites.any_of_groups.flat().includes(n.id)).map(n => <label key={n.id}><input type="checkbox" checked={requiredDraft.includes(n.id)} onChange={e => setRequiredDraft(e.target.checked ? [...requiredDraft, n.id] : requiredDraft.filter(id => id !== n.id))} /><span>{n.title}<small>{state.graph.modules.find(m => m.id === n.module_id)?.title}</small></span></label>)}</div>{Boolean(node?.prerequisites.any_of_groups.length) && <p>已设置的任选路线保持原样。</p>}<button className={styles.primary} disabled={busy} onClick={savePrerequisites}>保存前置条件<Check /></button></> : dialog === "new" ? <form onSubmit={generate}><h2 id="focus-dialog-title">创建课程知识树</h2><p>按课程内容整理章节、知识点和前置关系，生成后先检查，再开始学习。</p>{existingCourses.length > 0 && <label>使用已有课程的目录<select defaultValue="" onChange={e => { const source = existingCourses[Number(e.target.value)]; if (source) setDraft({ title: source.title, goal: source.goal, source_outline: source.outline }); }}><option value="" disabled>选择已有课程…</option>{existingCourses.map((c, i) => <option key={i} value={i}>{c.title}</option>)}</select></label>}<label>课程名称<input required minLength={2} maxLength={80} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>学习目标<textarea required minLength={4} maxLength={1200} rows={2} value={draft.goal} onChange={e => setDraft({ ...draft, goal: e.target.value })} placeholder="例如：能独立完成带登录、列表与表单的前端应用" /></label><label>课程目录或知识范围<textarea required minLength={20} maxLength={30000} rows={5} value={draft.source_outline} onChange={e => setDraft({ ...draft, source_outline: e.target.value })} placeholder="粘贴教材目录、课程大纲或需要覆盖的知识点。内容越具体，关系越容易检查。" /></label><button className={styles.primary} disabled={busy}>{busy ? "正在提交…" : "生成课程草稿"}<ArrowRight /></button></form> : <><h2 id="focus-dialog-title">今日学习安排</h2><p>每天推进一个主节点，也留一点时间复习。改变时间只会调整任务安排。</p><label>每天计划学习<select value={budget} onChange={e => setBudget(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120, 180].map(v => <option key={v} value={v}>{v} 分钟</option>)}</select></label><div className={styles.planList}>{state?.plan.tasks.map(task => <Link key={`${task.node_id}:${task.task}`} href={focusStudyHref(state.id, task.node_id, task.task)}><BookOpen /><span>{task.title}<small>{task.continued ? "今日推进一部分，下次接着学" : task.task === "review" ? "复习不会清除已通过的记录" : "按当前进度继续"}</small></span><strong>{task.minutes} 分钟</strong></Link>)}{state?.plan.tasks.length === 0 && <p>当前主线已经完成，可以选择拓展节点继续学习。</p>}</div><button className={styles.primary} disabled={busy || !state || state.status !== "published"} onClick={async () => { if (await act({ action: "budget", daily_minutes: budget })) setDialog(null); }}>保存学习时间<Check size={20} /></button></>}
      {error && <p role="alert" className={styles.formError}>{error}</p>}
    </section></div>}
  </div>;
}
