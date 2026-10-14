"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { TRAINING_KINDS } from "@/lib/training";
import { useTraining } from "./training-provider";
import { useTrainingPath } from "./use-training-path";
import { TaskRow, taskStatus, TrainingLoading } from "./training-shell";
import s from "./training.module.css";

export function TrainingCatalog() {
  const { state, tasks: allTasks, ready, refreshTasks } = useTraining();
  const learningPath = useTrainingPath();
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("全部难度");
  const [status, setStatus] = useState("全部任务");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("all");
  const tasks = allTasks.filter((task) => `${task.title} ${task.course} ${task.tags.join(" ")} ${task.source?.node_title ?? ""} python`.toLowerCase().includes(query.trim().toLowerCase()) && (difficulty === "全部难度" || task.difficulty === difficulty) && (status === "全部任务" || taskStatus(state[task.id]) === status)
    && (!kind || (task.kind ?? "implementation") === kind) && (source === "all" || (source === "preset" ? !task.source : source === "path" ? task.source : task.source?.path_signature === learningPath.signature)));
  const generated = tasks.filter((task) => task.source);
  const presets = tasks.filter((task) => !task.source);
  return <>
    <div className={s.catalogHeading}><div className={s.pageTitle}><p className={s.overline}>THE PRACTICE COLLECTION</p><h1>把学过的，练成自己的。</h1><p>按学习路径积累实训，也可以随时回到以前的任务。</p></div><Link className={s.primary} href="/desktop/training/generate/"><Sparkles size={16} /> 生成实训</Link></div>
    <div className={s.filterBar}>
      <label className={s.search}><Search size={17} aria-hidden /><input aria-label="搜索实训任务" placeholder="搜索任务、课程或知识点" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className={s.select} aria-label="按来源筛选" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option><option value="current">当前学习路径</option><option value="path">所有路径生成</option><option value="preset">预置体验</option></select>
      <select className={s.select} aria-label="按题型筛选" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">全部题型</option>{Object.entries(TRAINING_KINDS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
      <select className={s.select} aria-label="按难度筛选" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>{["全部难度", "基础", "进阶"].map((item) => <option key={item}>{item}</option>)}</select>
      <select className={s.select} aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}>{["全部任务", "未开始", "进行中", "自测通过"].map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    {!ready ? <TrainingLoading /> : <>
      <div className={s.sectionHeading}><h2>学习路径实训 <span className={s.muted}>{generated.length} 项</span></h2><button className={s.secondary} onClick={refreshTasks}>刷新任务库</button></div>
      {generated.length ? <div className={s.taskList}>{generated.map((task) => <TaskRow key={task.id} task={task} progress={state[task.id]} />)}</div> : <section className={s.pathBanner}><div><strong>{allTasks.some((task) => task.source) ? "没有符合筛选条件的路径实训" : "还没有根据路径生成实训"}</strong><p>选择学习节点与题型，生成完整编写、代码补全或 Bug 排查任务。</p></div><Link className={s.secondary} href="/desktop/training/generate/">去生成实训</Link></section>}
      {presets.length > 0 && <section className={s.presetSection}><div className={s.sectionHeading}><h2>预置体验 <span className={s.muted}>{presets.length} 项</span></h2><span className={s.muted}>固定示例，保留已有草稿</span></div><div className={s.taskList}>{presets.map((task) => <TaskRow key={task.id} task={task} progress={state[task.id]} />)}</div></section>}
      {!tasks.length && <div className={s.empty}><h2>没有符合条件的任务</h2><button className={s.secondary} onClick={() => { setQuery(""); setDifficulty("全部难度"); setStatus("全部任务"); setKind(""); setSource("all"); }}>重置筛选</button></div>}
    </>}
    <p className={s.catalogNote}>路径任务、代码草稿与运行记录按账户保存到学习档案，本机同时保留草稿。平台自测作为实训证据参与学情整理。</p>
  </>;
}
