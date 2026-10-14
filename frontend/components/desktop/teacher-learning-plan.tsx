"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarDays, CheckCircle2, Clock3, MessageCircle, SlidersHorizontal } from "lucide-react";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceViewer } from "@/components/resource-viewer";
import { buildPathDashboardPlan, getDailyTaskResourceAction } from "@/lib/daily-task-plan";
import { resolveResourceForTaskTarget } from "@/lib/path-resource-links";
import { getMaterialData } from "@/lib/library";
import type { SubjectLearningPath } from "@/lib/master-learning-path";
import type { ResourceItem } from "@/lib/types";
import styles from "./teacher-tool-window.module.css";

function CoursePace({ subject, disabled, onApply }: {
  subject: SubjectLearningPath;
  disabled: boolean;
  onApply: (id: string, minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(String(subject.dailyMinutes));
  const [saved, setSaved] = useState(false);
  useEffect(() => setMinutes(String(subject.dailyMinutes)), [subject.dailyMinutes]);
  const value = Number(minutes);
  const valid = minutes.trim() !== "" && Number.isInteger(value) && value >= 10 && value <= 240;
  return <form className={styles.paceRow} onSubmit={(event) => {
    event.preventDefault();
    if (!valid || disabled) return;
    onApply(subject.id, value);
    setSaved(true);
  }}>
    <label htmlFor={`teacher-pace-${subject.id}`}>{subject.title}</label>
    <div><input id={`teacher-pace-${subject.id}`} type="number" min={10} max={240} step={1} required value={minutes}
      disabled={disabled} onChange={(event) => { setMinutes(event.target.value); setSaved(false); }} aria-label={`${subject.title}每日学习分钟数`} />
      <span>分钟 / 天</span><button disabled={disabled || !valid || value === subject.dailyMinutes}>应用</button></div>
    {saved && <small role="status">已更新学习节奏</small>}
  </form>;
}

export default function TeacherLearningPlan({ onAsk, onTeacherRequested }: { onAsk: (question: string) => void; onTeacherRequested: () => void }) {
  const session = useOrchestratorContext((state) => ({
    mode: state.mode, hydrated: state.hydrated, subjectPaths: state.subjectPaths,
    masterPath: state.masterPath, masterPathScheduleAnchor: state.masterPathScheduleAnchor,
    completedMaterials: state.completedMaterials, resources: state.resources,
    replanSubjectPath: state.replanSubjectPath,
  }));
  const [subjectId, setSubjectId] = useState("");
  const [openResource, setOpenResource] = useState<{ item: ResourceItem; taskKey: string } | null>(null);
  const [loadingResource, setLoadingResource] = useState("");
  const [resourceError, setResourceError] = useState("");
  const resourceRequest = useRef(0);
  useEffect(() => () => { resourceRequest.current += 1; }, []);
  const viewResource = async (item: ResourceItem, taskKey: string) => {
    const request = ++resourceRequest.current;
    setLoadingResource(item.id);
    setResourceError("");
    try {
      const data = item.data ?? await getMaterialData(session.mode, item.id);
      if (request === resourceRequest.current) setOpenResource({ item: data ? { ...item, data } : item, taskKey });
    } catch {
      if (request === resourceRequest.current) setResourceError("资料暂时未能打开，请稍后重试。");
    } finally {
      if (request === resourceRequest.current) setLoadingResource("");
    }
  };
  const subject = session.subjectPaths.find((item) => item.id === subjectId);
  const path = subject?.path ?? session.masterPath;
  const anchor = subject?.activationDate ?? session.masterPathScheduleAnchor;
  const dashboard = useMemo(() => buildPathDashboardPlan(path, session.completedMaterials, { anchorDate: anchor }), [path, session.completedMaterials, anchor]);
  const today = dashboard.today;
  const tasks = today?.plan.tasks ?? [];
  const totalTasks = dashboard.stages.reduce((sum, stage) => sum + stage.taskCount, 0);
  const completed = dashboard.stages.reduce((sum, stage) => sum + stage.completedTaskCount, 0);

  return <div className={`${styles.plan} thin-scroll`}>
    <div className={styles.planToolbar}><div><small>MY STUDY PLAN</small><h3>{subject?.title || "我的学习安排"}</h3></div>
      <label>查看课程<select aria-label="学习计划课程" value={subject?.id ?? ""} onChange={(event) => setSubjectId(event.target.value)}>
        <option value="">全部课程</option>{session.subjectPaths.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
    </div>
    <div className={styles.planStats}>
      <div><CalendarDays size={19} /><span>今日任务</span><strong>{today?.plan.taskCount ?? 0}<small>项</small></strong></div>
      <div><Clock3 size={19} /><span>预计学习</span><strong>{today?.plan.totalMinutes ?? 0}<small>分钟</small></strong></div>
      <div><CheckCircle2 size={19} /><span>累计完成</span><strong>{completed}<small>/ {totalTasks} 项</small></strong></div>
    </div>
    <div className={styles.planColumns}><main>
      <section className={styles.planCard} aria-label="今日学习任务">
        <div className={styles.cardHeading}><div><small>TODAY</small><h3>{today?.step.title || "今日学习任务"}</h3></div><span>{today?.plan.completedTaskCount ?? 0} / {tasks.length} 已完成</span></div>
        {today ? <><p className={styles.planDescription}>{today.step.desc}</p><div className={styles.progressTrack} role="progressbar" aria-label="今日任务完成进度" aria-valuenow={today.plan.completedTaskCount} aria-valuemin={0} aria-valuemax={Math.max(1, tasks.length)}><span style={{ width: `${tasks.length ? today.plan.completedTaskCount / tasks.length * 100 : 0}%` }} /></div>
          <div className={styles.taskList}>{tasks.map((task, index) => {
            const targets = task.resourceTargets.map((target) => ({ target, item: resolveResourceForTaskTarget(target, task, session.resources) })).filter((entry) => entry.item);
            return <article key={task.key} className={styles.task} data-complete={task.completed}>
              <span className={styles.taskNumber}>{task.completed ? <CheckCircle2 size={18} /> : String(index + 1).padStart(2, "0")}</span>
              <div><header><h4>{task.title}</h4><span>{task.minutes} 分钟</span></header><p>{task.detail}</p>
                <small>{task.completed ? "已完成" : task.standard}</small>
                <div className={styles.taskActions}>{targets.map(({ target, item }) => <button key={target.key} disabled={Boolean(loadingResource)} onClick={() => void viewResource(item!, task.key)}><BookOpen size={14} />{loadingResource === item!.id ? "正在打开…" : getDailyTaskResourceAction(target.type).label}</button>)}
                  <button onClick={() => onAsk(`请帮我完成学习任务“${task.title}”。${task.detail ? `任务要求：${task.detail}` : ""}`)}><MessageCircle size={14} />向教师请教</button>
                </div>
              </div>
            </article>;
          })}</div></> : <div className={styles.empty}><CalendarDays size={30} /><h4>{session.hydrated ? "今天还没有安排" : "正在加载学习计划…"}</h4><p>告诉智能教师想学的课程和每天可用的时间，一起制定学习安排。</p><button onClick={() => onAsk("请帮我制定一份学习计划，先和我确认学习目标与每天可用的时间。")}>请教师帮我规划</button></div>}
      </section>
      <section className={styles.planCard}><div className={styles.cardHeading}><div><small>UP NEXT</small><h3>接下来学什么</h3></div></div>
        {dashboard.upcoming.length ? <ol className={styles.upcoming}>{dashboard.upcoming.slice(0, 5).map((stage, index) => <li key={stage.index}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{stage.title}</strong><p>{stage.desc}</p></div><small>{stage.totalMinutes} 分钟</small></li>)}</ol> : <p className={styles.planDescription}>当前没有待学习的后续节点。</p>}
      </section>
    </main><aside>
      <section className={styles.planCard}><div className={styles.cardHeading}><div><SlidersHorizontal size={20} /><h3>每日学习节奏</h3></div></div><p className={styles.planDescription}>每门课程可安排 10–240 分钟，应用后会更新学习计划。</p>
        {session.subjectPaths.length ? session.subjectPaths.map((item) => <CoursePace key={item.id} subject={item} disabled={session.mode !== "live"} onApply={session.replanSubjectPath} />) : <p className={styles.planDescription}>有了课程后，就可以在这里调整时长。</p>}
        {session.mode === "offline" && <p className={styles.planDescription}>学习服务连接恢复后即可调整。</p>}
      </section>
      <section className={`${styles.planCard} ${styles.planNote}`}><BookOpen size={26} /><h3>学有所序，日有所进</h3><p>从今天的一项任务开始。阅读与练习的完成情况，会同步记录到学习路径中。</p></section>
    </aside></div>
    {resourceError && <p className={styles.planDescription} role="alert">{resourceError}</p>}
    <ResourceViewer item={openResource?.item ?? null} taskKey={openResource?.taskKey} onClose={() => setOpenResource(null)} inTeacherTool onTeacherRequested={onTeacherRequested} />
  </div>;
}
