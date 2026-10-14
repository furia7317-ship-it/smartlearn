"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, ChevronRight, Clock3, FileText, MessageCircleQuestion, Play, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import { AbilityBadge, AbilityStatusIcon } from "./ability-path-tree";
import { abilityCoursesFromSubjects, abilityStudyHref, buildAbilityTree, resolveAbilityResource, ABILITY_STATUS_LABEL } from "@/lib/ability-path";
import { cn } from "@/lib/utils";
import { chapterKnowledge } from "@/lib/knowledge-path";
import type { ResourceItem } from "@/lib/types";
import styles from "./ability-study.module.css";

const ResourceViewer = dynamic(() => import("@/components/resource-viewer").then((module) => module.ResourceViewer), { ssr: false });

export default function AbilityStudy() {
  const { hydrated, subjectPaths, masterPath, resources, completedMaterials, taskEvidence, recordTaskEvidence } = useOrchestratorContext((state) => ({
    hydrated: state.hydrated, subjectPaths: state.subjectPaths, masterPath: state.masterPath, resources: state.resources,
    completedMaterials: state.completedMaterials, taskEvidence: state.taskEvidence, recordTaskEvidence: state.recordTaskEvidence,
  }));
  const params = useSearchParams();
  const query = useMemo(() => ({ course: params.get("course") || "", node: params.get("node") || "", knowledge: params.get("knowledge") || "", task: params.get("task") || "", verify: params.get("verify") === "1" }), [params]);
  const [activeTaskKey, setActiveTaskKey] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [openResource, setOpenResource] = useState<{ item: ResourceItem; taskKey: string } | null>(null);
  const courses = useMemo(() => abilityCoursesFromSubjects(subjectPaths, masterPath), [subjectPaths, masterPath]);
  const tree = useMemo(() => buildAbilityTree(query.course ? courses.filter((course) => course.id === query.course) : courses, completedMaterials, taskEvidence), [courses, query.course, completedMaterials, taskEvidence]);
  const node = tree.nodes.find((item) => item.id === query.node) || (!query.node ? tree.nodes.find((item) => item.id === tree.currentId) || tree.nodes[0] : undefined);
  const knowledge = node && query.knowledge ? chapterKnowledge(node.step).points.find((point) => point.id === query.knowledge) : undefined;
  const task = node?.tasks.find((item) => item.key === activeTaskKey) || node?.tasks[0];
  const linkedItem = task ? resolveAbilityResource(task, resources) : undefined;
  const item = linkedItem?.data && Object.keys(linkedItem.data).length ? linkedItem : undefined;
  const nextNodes = node ? tree.edges.filter((edge) => edge.from === node.id).map((edge) => tree.nodes.find((item) => item.id === edge.to)!) : [];

  useEffect(() => {
    if (!node) return;
    setActiveTaskKey(query.task || (query.verify ? node.tasks.find((task) => task.completionKind === "quiz_submission")?.key : undefined) || node.tasks.find((task) => !task.completed)?.key || node.tasks[0]?.key || "");
    // Learning events update status without throwing the student back to another task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, query.task, query.verify]);

  useEffect(() => {
    const saved = task ? taskEvidence[task.key] : undefined;
    setAnswer(saved?.kind === "written_response" ? saved.content : "");
    setSubmitted(false);
    setOpenResource(null);
    // Restore the response on task navigation, without replacing an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, task?.key]);

  const selectTask = (key: string) => {
    setActiveTaskKey(key); setAnswer(""); setSubmitted(false);
    const params = new URLSearchParams(window.location.search); params.set("task", key);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`);
  };

  if (!hydrated) return <div className={styles.empty}>正在恢复学习记录…</div>;
  if (!node) return <div className={styles.empty}><h2>这个学习节点暂时不可用</h2><p>课程可能已调整。返回路径选择当前节点，已保存的学习记录仍然保留。</p><Link href="/desktop/path/">返回学习路径</Link></div>;

  return <div className={styles.page}>
    <header className={styles.topbar}><Link href="/desktop/path/"><ArrowLeft size={16} />返回路径</Link><span>{node.courseTitle}</span><TeacherOpenButton context={{ module: "学习路径", title: node.step.title, detail: task?.detail || node.step.objective, entityId: node.id }}><MessageCircleQuestion size={16} />向智能教师提问</TeacherOpenButton></header>
    <div className={styles.hero}>
      <AbilityBadge node={node} size={100} />
      <div><span className={styles.status}><AbilityStatusIcon status={node.status} />{knowledge ? `所属章节：${node.step.title}` : ABILITY_STATUS_LABEL[node.status]}</span><h1>{knowledge?.title || node.step.title}</h1><p>{knowledge?.objective || node.step.objective || node.step.desc}</p></div>
      <div className={styles.progress}><strong>{node.completedTasks}<small>/{node.tasks.length}</small></strong><span>项任务已完成</span><small>{node.verification === "passed" ? "能力验证已通过" : node.verification === "failed" ? "独立验证需要补练" : "独立验证尚未通过"}</small></div>
    </div>
    {node.status === "locked" && <p className={styles.notice}>当前为预览。完成前置能力验证后，节点会正式解锁；已经会的内容可以直接验证。</p>}
    {knowledge && <p className={styles.notice}>正在学习「{knowledge.title}」。下方资料与任务由本章知识点共用，完成情况计入「{node.step.title}」，不会重复累计任务或学习时长。</p>}
    <div className={styles.body}>
      <nav className={styles.taskNav} aria-label="当前能力的学习任务"><h2>本节点怎么学</h2>{node.tasks.map((entry, index) => <button key={entry.key} onClick={() => selectTask(entry.key)} aria-current={task?.key === entry.key ? "step" : undefined} className={cn(task?.key === entry.key && styles.activeTask)}><span>{entry.completed ? <Check size={15} /> : String(index + 1).padStart(2, "0")}</span><strong>{entry.title}<small>{entry.completionKind === "quiz_submission" ? "独立验证" : entry.completionKind === "written_response" ? "学习产出" : "理解与示例"} · {entry.minutes} 分钟</small></strong></button>)}<p>看完、做完与验证通过分别记录。</p></nav>
      <main className={styles.content}>
        {task ? <>
          <div className={styles.taskHeading}><span><Clock3 size={15} />预计 {task.minutes} 分钟</span><span>{task.completed ? "本任务已完成" : "待完成"}</span></div>
          <h2>{task.title}</h2><p className={styles.detail}>{task.detail || node.step.objective}</p>
          {task.completionKind === "quiz_submission" && <div className={styles.validation}><ShieldCheck size={21} /><div><strong>独立完成，检验是否学会</strong><p>通过练习的评分标准后，才会计入主线目标进度。未通过会保留本次答案和已完成任务。</p></div></div>}
          {item ? <section className={styles.material}><FileText size={28} /><div><small>本任务资料</small><h3>{item.title}</h3><p>{item.meta.join(" · ") || "已关联到当前能力节点"}</p></div><button className={styles.primary} onClick={() => setOpenResource({ item, taskKey: task.key })}>{task.completionKind === "quiz_submission" ? "开始验证" : "打开学习内容"}<Play size={14} /></button></section>
            : task.completionKind !== "written_response" ? <section className={styles.preparing}><h3>本任务资料待准备</h3><p>任务与前置要求已经保留，资料准备状态不影响你的学习记录。</p><TeacherOpenButton context={{ module: "学习路径", title: node.step.title, entityId: node.id, detail: `请为当前节点准备所需资料，并保留既有学习路径。任务：${task.title}。要求：${task.detail}` }}>请智能教师协助准备<ChevronRight size={15} /></TeacherOpenButton></section> : null}
          {task.completionKind === "written_response" && <section className={styles.written}><h3>写下你的思考或实现说明</h3>{task.prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}<textarea aria-label="学习产出" value={answer} onChange={(event) => { setAnswer(event.target.value); setSubmitted(false); }} rows={7} placeholder="用自己的话解释关键步骤，写出例子、代码或遇到的问题。" /><button className={styles.primary} disabled={answer.trim().length < 6} onClick={() => { recordTaskEvidence(task.key, answer, "written_response"); setSubmitted(true); }}>保存学习产出</button><span role="status">{submitted ? "已保存。学习产出不自动等同于能力验证通过。" : task.completed ? "此前提交的记录已保留，可以继续补充。" : "至少输入 6 个字后保存。"}</span></section>}
          <section className={styles.taskFooter}><TeacherOpenButton context={{ module: "学习路径", title: node.step.title, detail: `当前任务：${task.title}。${task.detail}`, entityId: node.id }}><MessageCircleQuestion size={16} />卡住了，问一问智能教师</TeacherOpenButton>{node.tasks[node.tasks.indexOf(task) + 1] && <button onClick={() => selectTask(node.tasks[node.tasks.indexOf(task) + 1].key)}>下一项任务<ChevronRight size={16} /></button>}</section>
        </> : <p>本节点的任务正在准备中。</p>}
        {!!nextNodes.length && <section className={styles.next}><h3>完成后继续学什么</h3>{nextNodes.map((next) => <Link key={next.id} href={abilityStudyHref(next)}><span>{next.step.title}</span><small>{ABILITY_STATUS_LABEL[next.status]}</small><ChevronRight size={15} /></Link>)}</section>}
      </main>
    </div>
    {openResource && <ResourceViewer item={openResource.item} taskKey={openResource.taskKey} onClose={() => setOpenResource(null)} />}
  </div>;
}
