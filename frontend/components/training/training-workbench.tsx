"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCheck, Download, History, LoaderCircle, Play, Sparkles, Terminal } from "lucide-react";
import { CODE_LANGUAGES, isCodeLanguage } from "@/lib/code-languages";
import { API_BASE } from "@/lib/api";
import { TRAINING_EVIDENCE_CHANGED } from "@/lib/training-evidence";
import { requireOk } from "@/lib/api-error";
import { createAnonymousUuid } from "@/lib/student-identity";
import { playDesktopInteraction, playDesktopResult } from "@/lib/desktop-sounds";
import type { CodeExecutionResponse, CodeExerciseSubmission } from "@/lib/code-lab";
import { buildTrainingRun, TRAINING_KINDS, type TrainingRun, type TrainingTask } from "@/lib/training";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import { useTraining } from "./training-provider";
import { Breadcrumb, downloadTrainingFile, TaskNotFound, TrainingLoading } from "./training-shell";
import s from "./training.module.css";

export function TrainingWorkbench() {
  const id = useSearchParams().get("id");
  const { ready, tasks } = useTraining();
  const task = tasks.find((item) => item.id === id);
  if (!ready) return <TrainingLoading />;
  if (!task) return <TaskNotFound />;
  return <Workbench key={task.id} task={task} />;
}

function Workbench({ task }: { task: TrainingTask }) {
  const { state, saveDraft, saveRun, storageError, syncStatus } = useTraining();
  const progress = state[task.id];
  const language = progress?.language ?? "python";
  const languageInfo = CODE_LANGUAGES[language];
  const code = progress?.code ?? task.starterCode;
  const stdin = progress?.drafts?.[language]?.stdin ?? "";
  const python = language === "python";
  const [busy, setBusy] = useState<TrainingRun["kind"] | null>(null);
  const [requestError, setRequestError] = useState("");
  const [response, setResponse] = useState<CodeExecutionResponse | null>(null);
  const [tab, setTab] = useState<"output" | "cases" | "trace">("output");
  const [traceIndex, setTraceIndex] = useState(0);
  const [editorScroll, setEditorScroll] = useState(0);
  const [exampleIndex, setExampleIndex] = useState(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const latestRun = progress?.runs.find((run) => (run.language ?? "python") === language);
  const trace = response?.execution.trace ?? [];
  const step = trace[Math.min(traceIndex, Math.max(0, trace.length - 1))];

  useEffect(() => {
    if (!progress) saveDraft(task.id, task.starterCode);
  }, [progress, saveDraft, task]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  async function run(kind: TrainingRun["kind"]) {
    if (request.current || !code.trim()) return;
    if (kind === "check" && !python) return;
    const serverCheck = kind === "check";
    const source = python && kind === "run" ? buildTrainingRun(task, code, exampleIndex) : code;
    if (source.length > 10000) { setRequestError("代码与自测合计不能超过 10,000 字符，请缩短代码后重试。"); playDesktopInteraction("error"); return; }
    playDesktopInteraction("run");
    setBusy(kind);
    setRequestError("");
    setResponse(null);
    setTab("output");
    setTraceIndex(0);
    saveDraft(task.id, code, language, stdin);
    const controller = new AbortController();
    request.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      const result = await fetch(serverCheck ? `${API_BASE}/api/training/${encodeURIComponent(task.id)}/check` : `${API_BASE}/api/code-lab/execute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: source, language, stdin, include_ai_review: false }),
        signal: controller.signal,
      });
      await requireOk(result);
      const body = await result.json() as CodeExecutionResponse & Partial<CodeExerciseSubmission>;
      if (!body.execution || typeof body.execution.stdout !== "string" || !Array.isArray(body.execution.trace)) throw new Error("运行服务返回了无法识别的结果，请重试。");
      if (serverCheck) window.dispatchEvent(new Event(TRAINING_EVIDENCE_CHANGED));
      if (!mounted.current) return;
      setResponse(body);
      const error = body.execution.error;
      const passed = serverCheck && !error && body.passed === true && (body.total_tests ?? 0) > 0 && body.passed_tests === body.total_tests;
      saveRun({
        id: createAnonymousUuid(), taskId: task.id, createdAt: new Date().toISOString(), kind, code, language, stdin, stderr: body.execution.stderr, compileOutput: body.execution.compile_output,
        stdout: body.execution.stdout,
        error: error ? `${error.type}${error.line ? ` · 第 ${error.line} 行` : ""}：${error.message}` : null,
        durationMs: body.execution.execution_time_ms,
        passed,
      });
      playDesktopResult(error || (kind === "check" && !passed) ? "error" : passed ? "success" : "complete");
    } catch (error) {
      if (!mounted.current) return;
      playDesktopResult("error");
      setRequestError(timedOut ? "运行请求超时。代码已保留，请稍后重试。" : error instanceof TypeError ? "无法连接本地代码运行服务，请确认后端已启动后重试。" : error instanceof Error ? error.message : "运行失败，请重试。");
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  return <>
    <Breadcrumb task={task} workbench />
    <div className={s.workbenchKind}><strong>{TRAINING_KINDS[task.kind ?? "implementation"].label}</strong><span>{TRAINING_KINDS[task.kind ?? "implementation"].action}{task.kind === "debugging" ? "；请用代码注释说明错误原因与修复依据。" : "。"}</span>{task.source && <span className={s.muted}>来自：{task.source.node_day} · {task.source.node_title}</span>}</div>
    <div className={s.workbenchHeading}><div><p className={s.overline}>LAB {task.number} / 实训工作台</p><h1>{task.title}</h1></div><Link className={s.secondary} href={`/desktop/training/records/?task=${task.id}`}><History size={15} /> 实训档案</Link></div>
    <div className={s.workbenchGrid}>
      <aside className={s.workbenchBrief}><p className={s.overline}>任务便笺</p><h2>本次要完成什么</h2><p>{task.description}</p><ol className={s.requirements}>{task.requirements.map((item) => <li key={item}>{item}</li>)}</ol><div className={s.briefDivider} /><h3>遇到困难时</h3><p>先查看错误位置和输入边界，再带着具体问题寻求提示。</p><TeacherOpenButton className={s.secondary} context={{ module: "实训中心", title: task.title, entityId: task.id, detail: `实训要求：${task.requirements.join("；")}\n当前语言：${languageInfo.label}\n当前代码：\n${code}\n请优先给出思路和分级提示，帮助我自己实现。` }}><Sparkles size={15} /> 请教智能教师</TeacherOpenButton></aside>
      <section className={s.codeWorkspace} aria-label={`${languageInfo.label} 实训编辑器`}>
        <div className={s.languageBar}><label htmlFor="training-language">编程语言</label><select id="training-language" value={language} disabled={Boolean(busy)} onChange={(event) => {
          const next = event.target.value;
          if (!isCodeLanguage(next)) return;
          const draft = progress?.drafts?.[next];
          saveDraft(task.id, draft?.code ?? (next === "python" ? task.starterCode : CODE_LANGUAGES[next].starter), next, draft?.stdin ?? "");
          setResponse(null); setRequestError(""); setTab("output"); setEditorScroll(0);
        }}>{Object.entries(CODE_LANGUAGES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select><small>每种语言分别保存草稿{!python ? " · C / C++ 使用 C17 / C++17，Java 入口为 Main" : " · 支持逐步执行轨迹"}</small></div>
        {!python && <p className={s.languageNote}>可使用所选语言编译运行，通过下方标准输入验证实现。当前任务的函数接口与自动自测使用 Python；其他语言不会套用 Python 测试。</p>}
        {python && task.source && <div className={s.exampleRunBar}><label htmlFor="training-run-example">运行示例</label><select id="training-run-example" value={exampleIndex} disabled={Boolean(busy)} onChange={(event) => setExampleIndex(Number(event.target.value))}>{task.tests.map((test, index) => <option key={index} value={index}>{test.label}</option>)}</select><small>运行时调用所选示例；平台自测检查全部 {task.testCount} 个案例。</small></div>}
        <div className={s.editorBar}><span><span className={s.greenDot} /> {languageInfo.filename} <small>{languageInfo.label}</small></span><button title="下载当前代码" aria-label="下载当前代码" onClick={() => downloadTrainingFile(language === "java" ? "Main.java" : `${task.id}.${languageInfo.extension}`, code)}><Download size={16} /></button></div>
        <div className={s.editor}><div className={s.lineNumbers} aria-hidden><div style={{ transform: `translateY(-${editorScroll}px)` }}>{code.split("\n").map((_, index) => <div key={index}>{index + 1}</div>)}</div></div><textarea aria-label={`${languageInfo.label} 代码`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={code} maxLength={9000} readOnly={Boolean(busy)} onChange={(event) => saveDraft(task.id, event.target.value, language, stdin)} onScroll={(event) => setEditorScroll(event.currentTarget.scrollTop)} /></div>
        <details className={s.stdinPanel}><summary>标准输入（stdin）{stdin ? " · 已填写" : " · 可选"}</summary><textarea aria-label="标准输入" placeholder="在此输入程序需要的数据，每行一项。运行时一次性传入。" value={stdin} maxLength={10000} readOnly={Boolean(busy)} onChange={(event) => saveDraft(task.id, code, language, event.target.value)} /></details>
        <div className={s.runBar}><span role="status">{storageError ? `${syncStatus}；本机存储不可用` : syncStatus}</span><div className={s.buttonRow} data-desktop-sound="off"><button className={s.runButton} disabled={Boolean(busy) || !code.trim()} onClick={() => void run("run")}>{busy === "run" ? <LoaderCircle size={15} className={s.spinning} /> : <Play size={15} />}运行代码</button><button className={s.primary} title={!python ? "当前任务的平台自测使用 Python 函数接口" : undefined} disabled={Boolean(busy) || !code.trim() || !python} onClick={() => void run("check")}>{busy === "check" ? <LoaderCircle size={15} className={s.spinning} /> : <CheckCheck size={15} />}平台自测</button></div></div>
        <div className={s.console}>
          <div className={s.consoleTabs} role="tablist" aria-label="运行结果">{([["output", "运行输出"], ["cases", `公开案例 · ${task.tests.length}`], ["trace", "执行轨迹"]] as const).map(([value, label]) => <button key={value} role="tab" id={`training-tab-${value}`} aria-controls={`training-panel-${value}`} aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
          <div className={s.consoleContent} role="tabpanel" id={`training-panel-${tab}`} aria-labelledby={`training-tab-${tab}`}>
            {tab === "output" && <div aria-live="polite">
              {requestError && <p className={s.error} role="alert">{requestError}</p>}
              {busy ? <p className={s.muted}>正在本地 {languageInfo.label} 环境中{busy === "check" ? "执行平台自测" : "运行代码"}…</p> : requestError ? <p className={s.muted}>本次没有取得运行结果。之前的结果可在实训档案中查看。</p> : latestRun ? <><div className={s.sectionHeading}><span className={latestRun.error || (latestRun.kind === "check" && !latestRun.passed) ? s.errorText : s.success}>{latestRun.error ? "执行遇到错误" : latestRun.kind === "check" ? latestRun.passed ? "平台自测通过" : "自测未通过" : "运行完成"}</span><span className={s.muted}>{Math.round(latestRun.durationMs)} ms · {new Date(latestRun.createdAt).toLocaleTimeString("zh-CN")}</span></div>{(latestRun.code !== code || (latestRun.stdin ?? "") !== stdin) && <p className={s.muted}>以下是上次运行的结果；代码已修改，请重新运行验证。</p>}<pre className={s.output}>{latestRun.stdout || "程序未产生标准输出，请在代码中添加输出语句。"}</pre>{latestRun.compileOutput && <><p className={s.muted}>编译信息</p><pre className={s.output}>{latestRun.compileOutput}</pre></>}{latestRun.stderr && !latestRun.error && <><p className={s.muted}>标准错误输出</p><pre className={s.output}>{latestRun.stderr}</pre></>}{latestRun.error && <pre className={s.error}>{latestRun.error}</pre>}</> : <div className={s.consoleEmpty}><Terminal size={22} /><p>{task.kind === "debugging" ? "先运行待修复代码，观察错误与实际输出。" : "完成当前代码，再点击运行代码。"}</p><small>运行输出和错误会出现在这里。</small></div>}
            </div>}
            {tab === "cases" && <><p className={s.muted}>{task.source ? `此处展示 ${task.tests.length} 个公开案例；平台自测会在服务端运行全部 ${task.testCount} 个测试（含未公开案例），不代表课程正式评分。` : "公开案例用于辅助检查，不代表正式评分或全部边界条件。首个断言失败时会停止。"}</p><div className={s.cases}>{task.tests.map((test, index) => <div key={test.label}><span>{String(index + 1).padStart(2, "0")} · {test.label}</span><code>{test.expression}</code><small>期望返回：<code>{test.expected}</code></small></div>)}</div></>}
            {tab === "trace" && (step ? <><div className={s.traceControls}><label htmlFor="training-trace">步骤 {traceIndex + 1} / {trace.length}</label><input id="training-trace" type="range" min={0} max={trace.length - 1} value={traceIndex} onChange={(event) => setTraceIndex(Number(event.target.value))} /></div><p className={s.muted}>第 {step.line} 行 · {step.function} · {step.event}{response?.execution.trace_truncated ? " · 轨迹已达采集上限" : ""}</p><pre className={s.codePreview}>{JSON.stringify(step.variables, null, 2)}</pre><small className={s.muted}>自测轨迹包含附加的断言代码。完整轨迹仅在本次页面会话保留。</small></> : <div className={s.consoleEmpty}><p>{python ? "运行代码后，逐步查看变量变化。" : "当前语言提供编译与运行结果，逐步变量轨迹目前支持 Python。"}</p><small>点击“运行代码”采集轨迹；平台测试不展示隐藏案例的轨迹。</small></div>)}
          </div>
        </div>
      </section>
    </div>
  </>;
}
