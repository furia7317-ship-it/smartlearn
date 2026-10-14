"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Code2, FolderCheck, Terminal } from "lucide-react";
import { useTrainingPath } from "./use-training-path";
import { useTraining } from "./training-provider";
import { TaskRow, trainingHref, taskStatus, TrainingLoading } from "./training-shell";
import s from "./training.module.css";

function QueueIllustration() {
  return <div className={s.diagram} role="img" aria-label="循环队列示意：元素入队、出队，尾指针沿数组循环移动">
    <div className={s.diagramTop}><span><Terminal size={15} /> LAB / 001</span><span>数据结构手记</span></div>
    <svg viewBox="0 0 460 210" aria-hidden="true">
      <defs><marker id="queue-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      <g fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M75 138 Q75 172 110 172 H365 Q394 172 394 130" strokeDasharray="4 5" markerEnd="url(#queue-arrow)"/><path d="M18 91 H61 M397 91 H442" markerEnd="url(#queue-arrow)"/></g>
      {["12", "24", "36", "—", "—"].map((value, i) => <g key={i}><rect x={68 + i * 65} y="61" width="58" height="59" rx="3" fill={i < 3 ? "#d9e5d7" : "#fffaf0"} stroke="currentColor" strokeWidth="1.2"/><text x={97 + i * 65} y="97" fill="currentColor" textAnchor="middle" fontSize="20" fontFamily="monospace">{value}</text><text x={97 + i * 65} y="143" fill="currentColor" textAnchor="middle" fontSize="11" opacity=".6">{i}</text></g>)}
      <g fill="currentColor" fontSize="11" fontFamily="monospace"><text x="71" y="43">head</text><text x="267" y="43">tail</text><text x="178" y="199">(tail + 1) % capacity</text></g>
    </svg>
    <div className={s.diagramCaption}><span>有限空间，无限循环。</span><span>FIG. 01</span></div>
  </div>;
}

export function TrainingOverview() {
  const { state, ready, tasks } = useTraining();
  const learningPath = useTrainingPath();
  const pathStep = learningPath.path[learningPath.currentIndex];
  const started = tasks.filter((task) => state[task.id]).sort((a, b) => state[b.id].updatedAt.localeCompare(state[a.id].updatedAt));
  const current = started.find((task) => taskStatus(state[task.id]) !== "自测通过") ?? started[0];
  const featured = current ?? tasks[0];
  const checked = started.filter((task) => taskStatus(state[task.id]) === "自测通过").length;
  return <>
    <section className={s.hero}>
      <div className={s.heroCopy}><p className={s.overline}>学以致用 · 计算机课程实训</p><h1>让知识，<br />在代码里<span>真正发生。</span></h1><p className={s.heroDescription}>沿着学习路径，练习编写、补全与 Bug 排查。<br className={s.desktopBreak} />把每一次尝试，变成看得见的学习积累。</p><div className={s.buttonRow}><Link href="/desktop/training/generate/" className={s.primary}>根据学习路径生成实训 <ArrowUpRight size={17} /></Link><Link href="/desktop/training/tasks/" className={s.secondary}>浏览任务库</Link></div></div>
      <QueueIllustration />
    </section>
    <div className={s.pathBanner}><div><span className={s.overline}>当前学习节点</span><strong>{!learningPath.hydrated ? "正在读取学习路径…" : pathStep ? `${pathStep.day} · ${pathStep.title}` : "尚未建立学习路径"}</strong><p>{pathStep ? pathStep.objective || pathStep.desc : "建立课程学习路径后，可按当前节点生成不同形式的实训。"}</p></div><Link href={pathStep ? "/desktop/training/generate/" : "/desktop/path/"} className={s.secondary}>{pathStep ? "选择题型并生成" : "建立学习路径"} <ArrowRight size={16} /></Link></div>
    <section className={s.overviewBody} aria-label="我的实训">
      <div className={s.mainColumn}>
        <div className={s.sectionHeading}><h2>{current ? "继续你的实训" : featured.source ? "最近生成" : "体验预置实训"}</h2><span className={s.muted}>{current ? "接着上次的思路，向前一步" : featured.source ? "来自你的学习路径" : "预置题可直接体验；路径实训需点击上方生成"}</span></div>
        {!ready ? <TrainingLoading /> : <Link href={trainingHref(current ? "workbench" : "task", featured.id)} className={s.featured}>
          <div><p className={s.overline}>LAB {featured.number} <span> / PYTHON</span></p><h3>{featured.title}</h3><p>{featured.subtitle}</p><span className={s.featuredAction}>{current ? "继续实训" : "查看任务要求"} <ArrowRight size={16} /></span></div>
          <div className={s.featuredMark} aria-hidden="true">{current ? <Code2 size={50} strokeWidth={1} /> : <span>知<br />行</span>}</div>
        </Link>}
        <div className={s.sectionHeading}><h2>更多实训任务</h2><Link href="/desktop/training/tasks/">浏览任务库 <ArrowUpRight size={14} /></Link></div>
        <div className={s.taskList}>{tasks.filter((task) => task.id !== featured.id).slice(0, 3).map((task) => <TaskRow key={task.id} task={task} progress={state[task.id]} />)}</div>
      </div>
      <aside className={s.sideColumn}>
        <section className={s.progressSheet}><div className={s.sectionHeading}><h2>我的实训手记</h2><FolderCheck size={18} /></div><div className={s.stats}><div><strong>{ready ? started.length : "—"}</strong><span>已开始</span></div><div><strong>{ready ? checked : "—"}</strong><span>当前代码自测通过</span></div></div><p>{started.length ? "每一次运行与自测，都可以回到档案里复盘。" : "你的第一份实训记录，将从一次亲手尝试开始。"}</p><Link href="/desktop/training/records/">打开实训档案 <ArrowRight size={15} /></Link></section>
        <section className={s.method}><p className={s.overline}>一次完整的练习</p><ol>{[["01", "读懂任务", "确认输入、输出与边界。"], ["02", "动手实现", "编写代码，用运行反馈修正。"], ["03", "验证与回看", "完成平台自测，留下实践记录。"]].map(([n, title, detail]) => <li key={n}><span>{n}</span><div><h3>{title}</h3><p>{detail}</p></div></li>)}</ol><Link href="/desktop/resources/"><BookOpen size={15} /> 需要补充知识？去资源中心 <ArrowUpRight size={14} /></Link></section>
      </aside>
    </section>
  </>;
}
