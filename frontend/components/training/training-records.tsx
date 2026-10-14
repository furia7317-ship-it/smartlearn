"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, Check, Download, FileCode2, History, Terminal } from "lucide-react";
import { CODE_LANGUAGES } from "@/lib/code-languages";
import type { TrainingRun } from "@/lib/training";
import { useTraining } from "./training-provider";
import { downloadTrainingFile, trainingHref, TrainingLoading, TaskNotFound } from "./training-shell";
import s from "./training.module.css";

const ASSESSMENT_NOTE = "平台自测仅验证任务中的平台测试，不代表课程正式评分或独立完成证明。";

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function runStatus(run: TrainingRun) {
  if (run.kind === "check") return run.passed ? "平台自测通过" : "平台自测未通过";
  return run.error ? "运行出错" : "运行结束";
}

function RunRecord({ run }: { run: TrainingRun }) {
  const { tasks } = useTraining();
  const task = tasks.find((item) => item.id === run.taskId);
  if (!task) return null;
  const language = CODE_LANGUAGES[run.language ?? "python"];
  const successfulCheck = run.kind === "check" && run.passed;
  return <details className={s.record}>
    <summary className={s.recordSummary}>
      <span>{run.kind === "check" ? <Check size={17} aria-hidden /> : <Terminal size={17} aria-hidden />}</span>
      <span><strong>{task.title}</strong><span className={s.recordMeta}><time dateTime={run.createdAt}>{formatTime(run.createdAt)}</time><span>{run.kind === "check" ? "平台自测" : "代码运行"}</span><span>{language.label}</span><span>{Math.round(run.durationMs)} ms</span></span></span>
      <span className={successfulCheck ? s.success : s.status}>{runStatus(run)}</span>
    </summary>
    <div>
      <div className={s.sectionHeading}><h3>这次运行的输出</h3><span className={s.muted}>保留运行当时的代码与结果</span></div>
      <pre className={s.codePreview}>{run.stdout || "（本次运行没有标准输出）"}</pre>
      {run.stdin && <><h3>标准输入</h3><pre className={s.codePreview}>{run.stdin}</pre></>}{run.compileOutput && <><h3>编译信息</h3><pre className={s.codePreview}>{run.compileOutput}</pre></>}{run.stderr && !run.error && <pre className={s.error}>{run.stderr}</pre>}
      {run.error && <p className={s.error}>{run.error}</p>}
      <div className={s.sectionHeading}><h3>代码快照</h3><span className={s.muted}>{language.label}</span></div>
      <pre className={s.codePreview}><code>{run.code}</code></pre>
      <div className={s.buttonRow}>
        <button type="button" className={s.secondary} onClick={() => downloadTrainingFile(run.language === "java" ? "Main.java" : `${task.id}-${run.createdAt.replace(/[^0-9]/g, "")}.${language.extension}`, run.code)}><Download size={15} aria-hidden />下载这次的代码</button>
        <Link className={s.secondary} href={trainingHref("workbench", task.id)}>打开当前草稿 <ArrowUpRight size={15} aria-hidden /></Link>
      </div>
      <p className={s.muted}>打开工作台会继续当前草稿，历史代码快照可单独下载。{run.kind === "check" && ASSESSMENT_NOTE}</p>
    </div>
  </details>;
}

export function TrainingRecords() {
  const { state, ready, storageError, tasks } = useTraining();
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("task") || "";
  const selectedTask = selectedId ? tasks.find((item) => item.id === selectedId) : undefined;

  if (!ready) return <TrainingLoading />;
  if (selectedId && !selectedTask) return <TaskNotFound />;

  const runs = tasks
    .filter((task) => !selectedId || task.id === selectedId)
    .flatMap((task) => (state[task.id]?.runs ?? []).slice(0, 20))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const taskCount = new Set(runs.map((run) => run.taskId)).size;
  const exportRecords = () => {
    downloadTrainingFile(`training-records-${selectedId || "all"}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      source: "当前账户实训运行记录",
      scope: selectedTask?.title ?? "全部任务",
      assessmentNote: ASSESSMENT_NOTE,
      records: runs,
    }, null, 2), "application/json;charset=utf-8");
  };

  return <>
    <div className={s.pageTitle}>
      <span className={s.overline}>LEARNING BY DOING / ARCHIVE</span>
      <h1>每一次尝试，都有迹可循。</h1>
      <p>回看代码、输出与错误，找到自己如何一步步解决问题。</p>
    </div>
    <div className={s.filterBar}>
      <label htmlFor="training-record-task">实训任务</label>
      <select id="training-record-task" className={s.select} value={selectedId} onChange={(event) => {
        const next = event.target.value;
        router.replace(`/desktop/training/records/${next ? `?task=${encodeURIComponent(next)}` : ""}`, { scroll: false });
      }}>
        <option value="">全部任务</option>
        {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select>
      {runs.length > 0 && <button type="button" className={s.secondary} onClick={exportRecords}><Download size={15} aria-hidden />导出当前档案</button>}
    </div>
    {runs.length === 0 ? <section className={s.empty}>
      <History size={34} aria-hidden />
      <h2>{selectedTask ? "这项实训还没有运行记录" : "从第一次运行开始，留下你的实训足迹"}</h2>
      <p>在工作台运行代码或发起平台自测后，实际结果会自动出现在这里。每个任务保留最近 20 次记录。</p>
      <div className={s.buttonRow}>
        {selectedTask ? <Link className={s.primary} href={trainingHref("workbench", selectedTask.id)}>进入工作台 <ArrowUpRight size={16} aria-hidden /></Link> : <Link className={s.primary} href="/desktop/training/tasks/">选择第一项实训 <ArrowUpRight size={16} aria-hidden /></Link>}
      </div>
    </section> : <section aria-label="实训运行记录">
      <div className={s.sectionHeading}><h2><FileCode2 size={18} aria-hidden />运行记录</h2><span className={s.muted}>{taskCount} 项实训 · {runs.length} 次尝试</span></div>
      <p className={s.muted}>每个任务展示最近 20 次记录，点击展开代码与结果；已同步的完整运行历史保存在学习档案中。{storageError ? "本机存储暂不可用，请留意同步状态。" : "平台自测结果会作为学情整理的依据。"}</p>
      <div className={s.recordList}>{runs.map((run) => <RunRecord key={run.id} run={run} />)}</div>
    </section>}
    <p className={s.muted}>{ASSESSMENT_NOTE}</p>
  </>;
}
