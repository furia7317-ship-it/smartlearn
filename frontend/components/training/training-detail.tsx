"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, BookOpen, Clock3, Code2, ListChecks } from "lucide-react";
import { TRAINING_KINDS } from "@/lib/training";
import { useTraining } from "./training-provider";
import { Breadcrumb, TaskNotFound, TrainingLoading, trainingHref, taskStatus } from "./training-shell";
import s from "./training.module.css";

export function TrainingDetail() {
  const id = useSearchParams().get("id");
  const { state, tasks, ready } = useTraining();
  const task = tasks.find((item) => item.id === id);
  if (!ready) return <TrainingLoading />;
  if (!task) return <TaskNotFound />;
  return <>
    <Breadcrumb task={task} />
    <div className={s.pathBanner}><div><span className={s.overline}>{TRAINING_KINDS[task.kind ?? "implementation"].label} · {task.source ? "根据学习路径生成" : "预置体验任务"}</span><strong>{task.source ? `${task.source.node_day} · ${task.source.node_title}` : "此题为预置任务，可直接开始体验"}</strong>{task.source && <p>生成依据：{task.source.course} · {task.createdAt ? new Date(task.createdAt).toLocaleDateString("zh-CN") : "已保存"}</p>}</div><Link className={s.secondary} href="/desktop/training/generate/">生成新的实训 <ArrowRight size={14} /></Link></div>
    <div className={s.detailHeading}><div className={s.pageTitle}><p className={s.overline}>LAB {task.number} / {task.course}</p><h1>{task.title}</h1><p>{task.description}</p><div className={s.tags}><span>{task.difficulty}</span><span><Code2 size={13} /> Python</span><span><Clock3 size={13} /> 约 {task.minutes} 分钟</span><span>{taskStatus(state[task.id])}</span></div></div><span className={s.largeNumber} aria-hidden>{task.number}</span></div>
    <div className={s.detailGrid}>
      <div className={s.mainColumn}>
        <section className={s.paperSection}><div className={s.sectionHeading}><h2><ListChecks size={18} /> 任务要求</h2><span className={s.overline}>THE BRIEF</span></div><ol className={s.requirements}>{task.requirements.map((item) => <li key={item}>{item}</li>)}</ol></section>
        <section className={s.paperSection}><div className={s.sectionHeading}><h2>输入与输出示例</h2></div><div className={s.examples}>{task.examples.map((example, index) => <div key={index}><span className={s.overline}>示例 {index + 1}</span><p>调用</p><pre>{example.input}</pre><p>返回</p><pre>{example.output}</pre></div>)}</div></section>
        <section className={s.paperSection}><div className={s.sectionHeading}><h2>建议实训路径</h2><span className={s.muted}>按你的节奏推进</span></div><ol className={s.steps}>{task.steps.map((step, index) => <li key={step.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.description}</p></div></li>)}</ol></section>
      </div>
      <aside className={s.detailAside}><section className={s.startSheet}><p className={s.overline}>准备好开始了吗</p><h2>{TRAINING_KINDS[task.kind ?? "implementation"].action}</h2><p>工作台会保存草稿。运行后，你可以看到真实输出，也可以执行平台自测。</p><Link className={s.primary} href={trainingHref("workbench", task.id)}>{state[task.id] ? "继续实训" : "进入实训工作台"} <ArrowRight size={16} /></Link><small>Python · 本地运行 · 平台自测</small></section><section className={s.prerequisites}><h2><BookOpen size={17} /> 相关知识</h2><div className={s.tags}>{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><Link href="/desktop/resources/">去资源中心补充学习 <ArrowRight size={14} /></Link></section><p className={s.catalogNote}>本任务包含 {task.testCount ?? task.tests.length} 个平台自测案例，展示 {task.tests.length} 个公开案例。通过自测仅表示这些案例通过，建议继续检查复杂度并解释你的实现。</p></aside>
    </div>
  </>;
}
