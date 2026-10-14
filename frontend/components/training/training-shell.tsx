"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Check, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { getTrainingStatus, TRAINING_KINDS, type TrainingProgress, type TrainingTask } from "@/lib/training";
import { useTraining } from "./training-provider";
import s from "./training.module.css";

export function trainingHref(page: "task" | "workbench", id: string) {
  return `/desktop/training/${page}/?id=${encodeURIComponent(id)}`;
}

export function TrainingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname().replace(/\/$/, "");
  const { storageError, tasksError, refreshTasks, syncStatus } = useTraining();
  const nav = [["/desktop/training", "实训概览"], ["/desktop/training/tasks", "任务库"], ["/desktop/training/records", "实训档案"]];
  return <div className={`${s.shell} thin-scroll`} data-desktop-scroll-memory="training">
    <div className={s.inner}>
      <header className={s.header}>
        <Link href="/desktop/training/" className={s.identity}><span className={s.seal}>实践</span><span>实训中心<small>COMPUTER SCIENCE LAB</small></span></Link>
        <nav className={s.nav} aria-label="实训中心导航">{nav.map(([href, label]) => {
          const active = pathname === href || (href.endsWith("tasks") && /\/(task|workbench|generate)$/.test(pathname));
          return <Link key={href} href={`${href}/`} aria-current={active ? "page" : undefined}>{label}</Link>;
        })}</nav>
      </header>
      {storageError && <p role="alert" className={s.error}>{storageError}</p>}
      {tasksError && <div className={s.generationError} role="alert"><p>路径实训暂未加载：{tasksError}。已有草稿仍保留在本机。</p><button className={s.secondary} onClick={refreshTasks}>重新加载任务库</button></div>}
      {children}
      <footer className={s.footer}><span>学枢 · 在实践中理解，在验证中进步</span><span role="status">{syncStatus}</span></footer>
    </div>
  </div>;
}

export function TrainingLoading() {
  return <div className={s.empty} role="status">正在打开实训页面…</div>;
}

export function TaskNotFound() {
  return <section className={s.empty}><h1>没有找到这项实训</h1><p>从任务库选择一个任务，继续开始学习。</p><Link className={s.primary} href="/desktop/training/tasks/">返回任务库 <ArrowUpRight size={16} /></Link></section>;
}

export function Breadcrumb({ task, workbench = false }: { task?: TrainingTask; workbench?: boolean }) {
  return <nav className={s.breadcrumb} aria-label="面包屑"><Link href="/desktop/training/tasks/"><ArrowLeft size={14} /> 任务库</Link>{task && <><span>/</span>{workbench ? <Link href={trainingHref("task", task.id)}>{task.title}</Link> : <span>{task.title}</span>}</>}{workbench && <><span>/</span><span>工作台</span></>}</nav>;
}

export function taskStatus(progress?: TrainingProgress) {
  return getTrainingStatus(progress);
}

export function TaskRow({ task, progress }: { task: TrainingTask; progress?: TrainingProgress }) {
  const status = taskStatus(progress);
  return <Link href={trainingHref("task", task.id)} className={s.taskRow}>
    <span className={s.number}>{task.number}</span>
    <span className={s.taskInfo}><span className={s.overline}>{task.course} <span> / {task.difficulty} · {TRAINING_KINDS[task.kind ?? "implementation"].label} · {task.source ? "路径生成" : "预置体验"}</span></span><strong>{task.title}</strong><span className={s.muted}>{task.subtitle}</span><span className={s.tags}>{task.tags.map((tag) => <span key={tag}>{tag}</span>)}</span></span>
    <span className={s.rowMeta}><span className={status === "自测通过" ? s.success : s.status}>{status === "自测通过" && <Check size={13} />}{status}</span><span><Clock3 size={13} /> 约 {task.minutes} 分钟</span></span>
    <ArrowUpRight className={s.rowArrow} size={22} aria-hidden />
  </Link>;
}

export function downloadTrainingFile(filename: string, text: string, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
