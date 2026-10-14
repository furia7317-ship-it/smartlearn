"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle, Clock, Question, SpinnerGap } from "@phosphor-icons/react";
import { focusRequest, loadFocus, performFocusAction, FocusApiError, FOCUS_LABELS, type FocusSnapshot, type FocusAction, type PackageResponse, type AssessmentResult } from "@/lib/focus-api";
import { TeacherOpenButton } from "./teacher-window-provider";
import AbilityStudy from "./ability-study";
import styles from "./focus-study.module.css";

export default function FocusStudyRouter() {
  const params = useSearchParams();
  return params.get("graph") ? <FocusStudy graphId={params.get("graph")!} nodeId={params.get("node") || ""} initialTask={params.get("task") || "lesson"} /> : <AbilityStudy />;
}

function FocusStudy({ graphId, nodeId, initialTask }: { graphId: string; nodeId: string; initialTask: string }) {
  const [state, setState] = useState<FocusSnapshot | null>(null);
  const [content, setContent] = useState<PackageResponse | null>(null);
  const [task, setTask] = useState(initialTask === "review" ? "assessment" : initialTask);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const packagePath = `/courses/${encodeURIComponent(graphId)}/nodes/${encodeURIComponent(nodeId)}`;
  useEffect(() => {
    const controller = new AbortController();
    setState(null); setContent(null); setError(""); setAnswers({}); setResult(null);
    Promise.all([loadFocus(graphId, controller.signal), focusRequest<PackageResponse>(`${packagePath}/package`, undefined, controller.signal)]).then(([s, p]) => { setState(s); setContent(p); }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [graphId, nodeId, packagePath]);
  useEffect(() => {
    if (!content || !["pending", "running"].includes(content.status)) return;
    let disposed = false;
    const timer = setInterval(() => { void focusRequest<PackageResponse>(`${packagePath}/package`).then(result => { if (!disposed) setContent(result); }).catch(() => undefined); }, 2500);
    return () => { disposed = true; clearInterval(timer); };
  }, [content, packagePath]);
  const node = state?.graph.nodes.find(n => n.id === nodeId);
  const record = state?.nodes[nodeId];
  const pack = content?.package;
  const save = async (action: FocusAction) => {
    if (!state || busy) return false;
    setBusy(true); setError("");
    try { const response = await performFocusAction(state, { ...action, node_id: nodeId, package_version: pack?.content_version }); setState(response.state); if (response.assessment) setResult(response.assessment); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "保存未完成"); if (e instanceof FocusApiError && e.status === 409) setState(await loadFocus(graphId)); return false; }
    finally { setBusy(false); }
  };
  const prepare = async () => {
    setBusy(true); setError("");
    try {
      if (content?.job?.status === "failed") await focusRequest(`/jobs/${content.job.id}/retry`, {});
      else await focusRequest(`${packagePath}/prepare`, { request_id: crypto.randomUUID() });
      setContent(await focusRequest<PackageResponse>(`${packagePath}/package`));
    } catch (e) { setError(e instanceof Error ? e.message : "资料准备未完成"); }
    finally { setBusy(false); }
  };
  const changeTask = (id: string) => {
    setTask(id); setResult(null);
    const params = new URLSearchParams(location.search); params.set("task", id);
    history.replaceState(history.state, "", `${location.pathname}?${params}`);
  };
  return <div className={styles.page}>
    <header><Link href={`/desktop/path/?graph=${encodeURIComponent(graphId)}&node=${encodeURIComponent(nodeId)}`}><ArrowLeft />返回课程树</Link><span>{state?.graph.title}</span><TeacherOpenButton context={{ module: "path", title: node?.title || "知识点学习", detail: node?.objective || "围绕当前知识点答疑" }}><Question />向老师提问</TeacherOpenButton></header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!state ? <div className={styles.loading}>正在读取学习包…</div> : !node || !record ? <div className={styles.loading}>这个知识点不存在，请返回课程树选择。</div> : <>
      <div className={styles.heading}><span>{state.graph.modules.find(m => m.id === node.module_id)?.title} · {FOCUS_LABELS[record.status]}</span><h1>{node.title}</h1><p>{node.objective}</p><small><Clock size={15} />预计 {node.estimated_minutes} 分钟 · {record.tasks.length} / 3 项任务</small></div>
      <div className={styles.body}><nav aria-label="学习步骤">{[["lesson", "理解讲解"], ["example", "示例练习"], ["assessment", "独立核验"]].map(([id, title], i) => <button key={id} aria-current={task === id ? "step" : undefined} onClick={() => changeTask(id)}><span>{record.tasks.includes(id) ? <CheckCircle weight="fill" /> : `0${i + 1}`}</span>{title}</button>)}<p>阅读与练习可以分次完成。通过独立核验后，课程树会点亮这个节点。</p>{state.active_node_id === nodeId && <button disabled={busy} onClick={() => save({ action: "pause" })}>暂停，保留当前进度</button>}</nav>
        <article>
          {!record.available ? <div className={styles.notice}><h2>先把前置基础补齐</h2><p>可以查看课程目标；正式学习和核验需要先通过前置知识点。</p><Link href={`/desktop/path/?graph=${graphId}&node=${nodeId}`}>查看前置条件<ArrowRight /></Link></div> : <>
            {state.active_node_id !== nodeId && record.status !== "passed" && <div className={styles.startNotice}><span>将这个知识点设为当前学习任务，其他节点的已有记录会保留。</span><button disabled={busy} onClick={() => save({ action: "start" })}>开始当前节点</button></div>}
            {!pack ? <div className={styles.notice}><BookOpen size={36} /><h2>{content?.status === "pending" || content?.status === "running" ? "正在准备当前知识点" : content?.status === "failed" ? "这次资料没有准备完成" : "准备这一个知识点的学习资料"}</h2><p>{content?.job?.error || "系统会围绕本节点准备讲解、示例与核验题。离开页面后，准备任务仍会继续。"}</p>{content?.status === "pending" || content?.status === "running" ? <span className={styles.preparing}><SpinnerGap />可以稍后回来查看</span> : <button disabled={busy || state.status !== "published"} onClick={prepare}>{content?.status === "failed" ? "重新准备" : "准备学习资料"}</button>}</div> : task !== "assessment" ? <>
              <div className={styles.markdown}><ReactMarkdown remarkPlugins={[remarkGfm]}>{task === "example" ? pack.example : pack.lesson}</ReactMarkdown></div>
              <div className={styles.readActions}><button disabled={busy || state.active_node_id !== nodeId && record.status !== "passed"} onClick={async () => { if (record.status === "passed" || await save({ action: "task", task: task === "example" ? "example" : "lesson" })) changeTask(task === "lesson" ? "example" : "assessment"); }}>{record.tasks.includes(task) || record.status === "passed" ? "继续下一步" : task === "lesson" ? "已理解，进入练习" : "已完成练习，进入核验"}<ArrowRight /></button><span>阅读记录不等于核验通过</span></div>
            </> : <form onSubmit={event => { event.preventDefault(); void save({ action: "submit", answers }); }}><h2>独立核验</h2><p className={styles.scope}>{pack.assessment_scope} · 通过要求 {Math.round(pack.pass_ratio * 100)} 分。</p>{pack.questions.map((q, i) => <fieldset key={q.id}><legend>{i + 1}. {q.stem}</legend>{q.options.map((option, index) => <label key={option}><input type="radio" name={q.id} required value={String.fromCharCode(65 + index)} checked={answers[q.id] === String.fromCharCode(65 + index)} onChange={e => { setAnswers({ ...answers, [q.id]: e.target.value }); setResult(null); }} /><span>{option}</span></label>)}{result && <p className={result.questions.find(r => r.id === q.id)?.correct ? styles.correct : styles.incorrect}>{result.questions.find(r => r.id === q.id)?.correct ? "回答正确" : "需要再想一想"}：{result.questions.find(r => r.id === q.id)?.explanation}</p>}</fieldset>)}<button className={styles.submit} disabled={busy || Object.keys(answers).length !== pack.questions.length}>{busy ? "正在核对…" : "提交核验"}<CheckCircle /></button>{result && <div className={styles.result} role="status"><h3>{result.passed ? "本节点核验通过" : "还需要再巩固一下"} · {result.score} 分</h3><p>{result.passed ? "通过记录已保存，可以返回课程树查看新解锁的知识点。" : "返回讲解和示例，针对错题复习后可以重新提交。"}</p><Link href={`/desktop/path/?graph=${graphId}&node=${nodeId}`}>返回课程树<ArrowRight /></Link></div>}</form>}
          </>}
        </article>
      </div>
    </>}
  </div>;
}
