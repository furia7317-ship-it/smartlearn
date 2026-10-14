"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Bug, Check, Code2, GitBranch, LoaderCircle, Puzzle, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { generateTrainingTask } from "@/lib/training-api";
import { buildTrainingContext } from "@/lib/training-generation";
import { localDateKey } from "@/lib/path-schedule-clock";
import { TRAINING_KINDS, type TrainingKind, type TrainingTask } from "@/lib/training";
import { playDesktopInteraction, playDesktopResult } from "@/lib/desktop-sounds";
import { useTraining } from "./training-provider";
import { useTrainingPath } from "./use-training-path";
import { TaskRow, TrainingLoading } from "./training-shell";
import s from "./training.module.css";

const kinds = Object.keys(TRAINING_KINDS) as TrainingKind[];
const icons = { implementation: Code2, completion: Puzzle, debugging: Bug };

export function TrainingGenerate() {
  const path = useTrainingPath();
  const { user } = useAuth();
  if (!path.hydrated) return <TrainingLoading />;
  return <GenerateForm key={`${user?.id}:${path.signature}`} learningPath={path} />;
}

function GenerateForm({ learningPath }: { learningPath: ReturnType<typeof useTrainingPath> }) {
  const { addTask, state } = useTraining();
  const [index, setIndex] = useState(learningPath.currentIndex);
  const [selected, setSelected] = useState<TrainingKind[]>([...kinds]);
  const [activeKind, setActiveKind] = useState<TrainingKind | null>(null);
  const [created, setCreated] = useState<TrainingTask[]>([]);
  const [failures, setFailures] = useState<{ kind: TrainingKind; message: string }[]>([]);
  const [done, setDone] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const context = buildTrainingContext(learningPath.path, index);
  const step = learningPath.path[index];
  const busy = activeKind !== null;

  async function generate(requested = selected) {
    if (!context || request.current || !requested.length) return;
    const controller = new AbortController();
    request.current = controller;
    setDone(false);
    setFailures([]);
    playDesktopInteraction("run");
    const failed: typeof failures = [];
    for (const kind of requested) {
      if (controller.signal.aborted) break;
      setActiveKind(kind);
      const timeout = window.setTimeout(() => controller.abort(), 115000);
      try {
        const task = await generateTrainingTask({ learning_date: localDateKey(), learning_context: context.context, exercise_kind: kind, source: context.source }, controller.signal);
        if (controller.signal.aborted) break;
        addTask(task);
        setCreated((previous) => [task, ...previous]);
      } catch (error) {
        if (request.current !== controller) return;
        if (controller.signal.aborted) {
          // A timeout may happen after the server saves. Reload the library before generating again.
          failed.push({ kind, message: "等待超时。请先到任务库刷新，确认是否已保存，再重试。" });
          requested.slice(requested.indexOf(kind) + 1).forEach((pending) => failed.push({ kind: pending, message: "上一题等待超时，本题尚未开始生成。" }));
          break;
        }
        failed.push({ kind, message: error instanceof Error ? error.message : "生成失败，请稍后重试" });
      } finally { window.clearTimeout(timeout); }
    }
    if (request.current !== controller) return;
    request.current = null;
    setActiveKind(null);
    setFailures(failed);
    setDone(true);
    playDesktopResult(failed.length ? "error" : "success");
  }

  return <>
    <nav className={s.breadcrumb} aria-label="面包屑"><Link href="/desktop/training/"><ArrowLeft size={14} /> 实训中心</Link><span>/</span><span>生成实训</span></nav>
    <div className={s.pageTitle}><p className={s.overline}>FROM YOUR LEARNING PATH</p><h1>把正在学的，变成一场实训。</h1><p>沿着当前学习路径，练实现、练补全，也练习发现问题。</p></div>
    {!context ? <section className={s.empty}><GitBranch size={32} /><h2>先建立你的学习路径</h2><p>有了课程目标和节点内容，才能生成与当前学习相关的实训。</p><Link className={s.primary} href="/desktop/path/">前往学习路径 <ArrowRight size={16} /></Link><Link className={s.secondary} href="/desktop/training/tasks/">先体验预置任务</Link></section> : <div className={s.generationGrid}>
      <div className={s.mainColumn}>
        <section className={s.paperSection}>
          <div className={s.sectionHeading}><h2><GitBranch size={18} /> 01 · 确认学习节点</h2><span className={s.muted}>来自当前学习路径</span></div>
          <label className={s.fieldLabel} htmlFor="training-node">出题依据</label>
          <select id="training-node" className={s.nodeSelect} disabled={busy} value={index} onChange={(event) => { setIndex(Number(event.target.value)); setCreated([]); setFailures([]); setDone(false); }}>
            {learningPath.path.map((node, nodeIndex) => <option key={nodeIndex} value={nodeIndex}>{node.day} · {node.title}{nodeIndex === learningPath.currentIndex ? "（当前）" : ""}</option>)}
          </select>
          <div className={s.pathContext}><span className={s.overline}>{context.source.course}</span><h3>{step.objective || step.desc}</h3><div className={s.tags}>{step.knowledge_points?.map((point) => <span key={point}>{point}</span>)}</div><details><summary>查看发送给 AI 的学习内容</summary><pre>{context.context}</pre></details></div>
        </section>
        <section className={s.paperSection}>
          <div className={s.sectionHeading}><h2>02 · 选择练习形式</h2><span className={s.muted}>每种生成 1 题，可多选</span></div>
          <div className={s.kindChoices}>{kinds.map((kind) => {
            const info = TRAINING_KINDS[kind]; const Icon = icons[kind]; const checked = selected.includes(kind);
            return <label key={kind} className={s.kindChoice} data-selected={checked}><input type="checkbox" checked={checked} disabled={busy} onChange={() => setSelected((previous) => checked ? previous.filter((item) => item !== kind) : kinds.filter((item) => item === kind || previous.includes(item)))} /><Icon size={22} /><span><strong>{info.label}</strong><small>{info.description}</small></span><Check size={17} className={s.kindCheck} aria-hidden /></label>;
          })}</div>
          <div className={s.generationAction} data-desktop-sound="off"><button className={s.primary} disabled={busy || !selected.length} onClick={() => void generate()}>{busy ? <LoaderCircle size={17} className={s.spinning} /> : <Sparkles size={17} />}{busy ? `正在生成${TRAINING_KINDS[activeKind!].label}…` : `生成 ${selected.length} 项实训`}</button><span className={s.muted}>Python · 约 15–25 分钟 / 题</span></div>
          <p className={s.muted} role="status" aria-live="polite">{busy ? `正在出题并运行参考实现校验测试；每题可能需要 1–2 分钟。已保存 ${created.length} 题。` : done && !failures.length ? "任务已保存，可在下方查看要求或前往任务库继续。" : "任务生成后会保留在当前账户的任务库中。"}</p>
        </section>
        {failures.length > 0 && <section className={s.generationError} role="alert"><h3>部分任务暂未生成成功</h3>{failures.map((failure) => <p key={failure.kind}><strong>{TRAINING_KINDS[failure.kind].label}：</strong>{failure.message}</p>)}<div className={s.buttonRow}><button className={s.secondary} disabled={busy} onClick={() => void generate(failures.map((item) => item.kind))}>仅重试失败题型</button><Link className={s.secondary} href="/desktop/training/tasks/">查看已保存任务</Link></div></section>}
        {created.length > 0 && <section><div className={s.sectionHeading}><h2>已生成的实训</h2><Link href="/desktop/training/tasks/">前往任务库 <ArrowRight size={14} /></Link></div><div className={s.taskList}>{created.map((task) => <TaskRow key={task.id} task={task} progress={state[task.id]} />)}</div></section>}
      </div>
      <aside className={s.generationAside}><span className={s.overline}>HOW IT WORKS</span><h2>题目从哪里来？</h2><ol className={s.steps}><li><span>01</span><div><h3>读取路径</h3><p>把节点目标、知识点和已有学习任务作为出题依据。</p></div></li><li><span>02</span><div><h3>按形式出题</h3><p>AI 生成任务要求、起始代码、输入输出示例与测试。</p></div></li><li><span>03</span><div><h3>校验并保存</h3><p>用参考实现核对测试输出，检查补全标记与待修复代码，再放入任务库。</p></div></li></ol><p className={s.catalogNote}>当前运行环境支持 Python。生成的测试用于学习自测；题意和知识点契合度仍需结合课程要求复核。</p><Link className={s.secondary} href="/desktop/path/">查看学习路径 <ArrowRight size={14} /></Link></aside>
    </div>}
  </>;
}
