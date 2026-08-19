"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  BrainCircuit,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  GraduationCap,
  ListChecks,
  MessageCircle,
  NotebookPen,
  Search,
  Sparkles,
  Target,
  Upload,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { useAuth } from "@/components/auth-provider";
import { UserAvatar } from "@/components/user-avatar";
import { useDesktopModuleStringState } from "@/hooks/use-desktop-module-view-state";
import type { DailyTaskItem, DailyTaskPlan } from "@/lib/daily-task-plan";
import type { LearningActivityEvent } from "@/lib/learning-activity";
import type { LearningAnalytics, MasteryEvidence } from "@/lib/learning-analytics";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getDesktopPagerSwap, type DesktopPagerDirection } from "@/lib/web-motion";

import styles from "./desktop-home-dossier.module.css";

type HomePage = "today" | "analysis" | "growth";
type Period = "week" | "month" | "term" | "all";

const PAGE_ORDER: HomePage[] = ["today", "analysis", "growth"];
const PERIOD_ORDER: Period[] = ["week", "month", "term", "all"];
const PAGE_META: Record<HomePage, { title: string; range: string }> = {
  today: { title: "今日案头", range: "今天" },
  analysis: { title: "学习分析", range: "近 30 天" },
  growth: { title: "成长记录", range: "本月" },
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentScore(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return clamp(value >= 0 && value <= 1 ? value * 100 : value);
}

function formatMinutes(value: number) {
  if (value < 60) return `${Math.round(value)} 分钟`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function shortDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function displayDateRange(value: string, days: number) {
  const end = new Date(value);
  if (Number.isNaN(end.getTime())) return "最近一段时间";
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(0, days - 1));
  const label = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${label(start)} — ${label(end)}`;
}

function dateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function compactTaskTitle(value: string | undefined, maximum = 18) {
  const raw = (value || "学习任务").split("·").at(-1)?.trim() || "学习任务";
  const concise = raw
    .replace(/综合学习与要点整理$/u, "综合")
    .replace(/学习与要点整理$/u, "")
    .replace(/综合巩固练习$/u, "巩固练习")
    .trim() || raw;
  return concise.length > maximum ? `${concise.slice(0, maximum)}…` : concise;
}

function taskSubjectLabel(task: DailyTaskItem | undefined) {
  if (!task) return "当前学习路径";
  const parts = task.title.split("·").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[0] : task.action || "当前学习路径";
}

function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const content = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <header className={styles.cardTitle}>
      <h2>{children}</h2>
      {aside}
    </header>
  );
}

export interface DesktopHomeDossierProps {
  displayName: string;
  major: string;
  grade: string;
  progress: number;
  todayPlan?: DailyTaskPlan;
  tasks: DailyTaskItem[];
  activeTaskIndex: number;
  selectedTask?: DailyTaskItem;
  selectedResource?: ResourceItem;
  resources: ResourceItem[];
  analytics: LearningAnalytics;
  activities: LearningActivityEvent[];
  masteryEvidence: MasteryEvidence[];
  loading: boolean;
  hasLearningPath: boolean;
  onSelectTask: (key: string) => void;
  onOpenResource: (resource: ResourceItem) => void;
}

export function DesktopHomeDossier({
  displayName,
  major,
  grade,
  progress,
  todayPlan,
  tasks,
  activeTaskIndex,
  selectedTask,
  selectedResource,
  resources,
  analytics,
  activities,
  masteryEvidence,
  loading,
  hasLearningPath,
  onSelectTask,
  onOpenResource,
}: DesktopHomeDossierProps) {
  const router = useRouter();
  const { user } = useAuth();
  const reducedMotion = useReducedMotion();
  const [activePage, setActivePage] = useState<HomePage>("today");
  const activePageRef = useRef<HomePage>("today");
  const [pageDirection, setPageDirection] = useState<DesktopPagerDirection>(1);
  const [search, setSearch] = useDesktopModuleStringState<string>("home", "dossier.search", "");
  const [period, setPeriod] = useDesktopModuleStringState<Period>(
    "home",
    "dossier.period",
    "week",
    PERIOD_ORDER
  );
  const [subject, setSubject] = useDesktopModuleStringState<string>("home", "dossier.subject", "all");
  const [sessionNow] = useState(() => Date.now());
  const pageSwap = useMemo(() => getDesktopPagerSwap(Boolean(reducedMotion)), [reducedMotion]);

  const applyPage = useCallback((next: HomePage, updateHistory: boolean) => {
    const current = activePageRef.current;
    if (next === current) return;
    const currentIndex = PAGE_ORDER.indexOf(current);
    const nextIndex = PAGE_ORDER.indexOf(next);
    setPageDirection(nextIndex >= currentIndex ? 1 : -1);
    activePageRef.current = next;
    setActivePage(next);
    if (!updateHistory) return;
    const url = new URL(window.location.href);
    if (next === "today") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const changePage = useCallback((index: number) => {
    const next = PAGE_ORDER[index];
    if (next) applyPage(next, true);
  }, [applyPage]);

  useEffect(() => {
    const syncFromUrl = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      const next = PAGE_ORDER.includes(view as HomePage) ? view as HomePage : "today";
      applyPage(next, false);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [applyPage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft") changePage(Math.max(0, PAGE_ORDER.indexOf(activePage) - 1));
      if (event.key === "ArrowRight") changePage(Math.min(2, PAGE_ORDER.indexOf(activePage) + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePage, changePage]);

  useEffect(() => {
    if (activePage === "analysis") setPeriod("week");
    if (activePage === "growth") setPeriod("month");
  }, [activePage]);

  const currentIndex = PAGE_ORDER.indexOf(activePage);
  const generatedAt = new Date(analytics.generatedAt);
  const formattedToday = Number.isNaN(generatedAt.getTime())
    ? "今日"
    : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(generatedAt);

  const subjects = useMemo(() => {
    const values = new Set<string>();
    analytics.subjectBalance.items.forEach((item) => values.add(item.subject));
    masteryEvidence.forEach((item) => item.subject && values.add(item.subject));
    return Array.from(values).slice(0, 10);
  }, [analytics.subjectBalance.items, masteryEvidence]);

  const periodDays = period === "week" ? 7 : period === "month" ? 30 : period === "term" ? 180 : 3650;
  const periodStart = (Number.isNaN(generatedAt.getTime()) ? sessionNow : generatedAt.getTime()) - periodDays * 86_400_000;
  const filteredEvidence = masteryEvidence
    .filter((item) => subject === "all" || item.subject === subject)
    .filter((item) => {
      const measured = new Date(item.measuredAt).getTime();
      return Number.isFinite(measured) && measured >= periodStart;
    });
  const subjectEvidence = masteryEvidence
    .filter((item) => subject === "all" || item.subject === subject)
    .slice()
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
    .filter((item) => Number.isFinite(new Date(item.measuredAt).getTime()));
  const evidenceTrendData = (filteredEvidence.length > 1 ? filteredEvidence : subjectEvidence)
    .slice()
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
    .slice(-8)
    .map((item) => ({ date: shortDate(item.measuredAt), score: Math.round(percentScore(item.score)), topic: item.knowledgePoint }));
  const trendData = evidenceTrendData;

  const priorityItems = useMemo(() => {
    const forgetting = analytics.forgetting.items
      .filter((item) => subject === "all" || item.subject === subject)
      .map((item) => ({
        title: item.knowledgePoint,
        score: Math.round(percentScore(item.risk)),
        hint: `${item.daysSinceStudy} 天未复习`,
      }));
    if (forgetting.length > 0) return forgetting.slice(0, 3);
    return analytics.bottlenecks.items
      .filter((item) => subject === "all" || item.subject === subject)
      .map((item) => ({ title: item.topic, score: Math.round(percentScore(item.severity)), hint: item.reasons[0] || "需要巩固" }))
      .slice(0, 3);
  }, [analytics.bottlenecks.items, analytics.forgetting.items, subject]);

  const graphData = useMemo(() => {
    const byTopic = new Map<string, number>();
    (filteredEvidence.length > 0 ? filteredEvidence : subjectEvidence).forEach((item) => byTopic.set(compactTaskTitle(item.knowledgePoint, 12).slice(0, 5), Math.round(percentScore(item.score))));
    const selectedTitle = selectedTask?.title || selectedTask?.action || "";
    const rootName = selectedTitle.includes("动态规划")
      ? "动态规划"
      : selectedTitle.split("·").at(-1)?.trim().slice(0, 8) || subjects[0] || "核心主题";
    const rootScore = Math.round(clamp(analytics.health.factors.find((item) => item.id === "mastery")?.score ?? analytics.health.score ?? 78));
    const values = [{ name: rootName, score: rootScore }];
    for (const item of Array.from(byTopic, ([name, score]) => ({ name, score })).slice(-5)) {
      if (values.length >= 6) break;
      if (!values.some((value) => value.name === item.name)) values.push(item);
    }
    for (const item of priorityItems) {
      if (values.length >= 6) break;
      const name = compactTaskTitle(item.title, 12).slice(0, 5);
      if (!values.some((value) => value.name === name)) values.push({ name, score: item.score });
    }
    const fallback = ["动态定义", "综合应用", "复杂度分析", "边界条件", "状态转移"];
    for (const [index, name] of fallback.entries()) {
      if (values.length >= 6) break;
      if (!values.some((value) => value.name === name)) values.push({ name, score: [82, 79, 72, 68, 61][index] });
    }
    const positions = [[50, 50], [50, 15], [16, 42], [84, 42], [28, 80], [72, 80]];
    return values.slice(0, 6).map((item, index) => ({
      ...item,
      x: positions[index][0],
      y: positions[index][1],
      z: index === 0 ? 420 : 250,
    }));
  }, [analytics.health.factors, analytics.health.score, filteredEvidence, priorityItems, selectedTask?.action, selectedTask?.title, subjectEvidence, subjects]);

  const activityByDay = useMemo(() => {
    const map = new Map<string, number>();
    activities.forEach((event) => {
      const key = dateKey(event.startedAt);
      if (!key) return;
      map.set(key, (map.get(key) || 0) + Math.max(0, event.activeSeconds || 0) / 60);
    });
    return map;
  }, [activities]);

  const latestMeaningfulActivityTime = useMemo(() => activities.reduce((latest, event) => {
    if ((event.activeSeconds || 0) <= 0) return latest;
    const started = new Date(event.startedAt).getTime();
    return Number.isFinite(started) ? Math.max(latest, started) : latest;
  }, 0), [activities]);

  const meaningfulActivityDays = useMemo(() => Array.from(activityByDay.entries())
    .filter(([, minutes]) => minutes > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-14), [activityByDay]);

  const growthData = useMemo(() => {
    const data: Array<{ date: string; iso: string; minutes: number; cumulative: number }> = [];
    let cumulative = 0;
    if (meaningfulActivityDays.length > 1) {
      meaningfulActivityDays.forEach(([iso, rawMinutes]) => {
        const date = new Date(`${iso}T00:00:00`);
        const minutes = Math.round(rawMinutes);
        cumulative += minutes;
        data.push({ date: `${date.getMonth() + 1}/${date.getDate()}`, iso, minutes, cumulative: Math.round(cumulative / 60 * 10) / 10 });
      });
      return data;
    }
    const analyticsDate = new Date(analytics.generatedAt);
    const now = latestMeaningfulActivityTime > 0
      ? new Date(latestMeaningfulActivityTime)
      : Number.isNaN(analyticsDate.getTime()) ? new Date() : analyticsDate;
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(now);
      date.setDate(now.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const minutes = Math.round(activityByDay.get(key) || 0);
      cumulative += minutes;
      data.push({ date: `${date.getMonth() + 1}/${date.getDate()}`, iso: key, minutes, cumulative: Math.round(cumulative / 60 * 10) / 10 });
    }
    return data;
  }, [activityByDay, analytics.generatedAt, latestMeaningfulActivityTime, meaningfulActivityDays]);
  const growthRangeLabel = growthData.length > 1
    ? `${growthData[0].date.replace("/", "月")}日 — ${growthData.at(-1)?.date.replace("/", "月")}日`
    : displayDateRange(analytics.generatedAt, 14);

  const activeDays = Array.from(activityByDay.values()).filter((value) => value > 0).length;
  const focusAverage = activities.length
    ? Math.round(analytics.evidence.activeMinutes / Math.max(1, activities.length))
    : 0;
  const goldenHour = analytics.efficiency.goldenHour;
  const recentResources = resources.slice(0, 4);
  const completedToday = tasks.filter((task) => task.completed).length;
  const feedbackScore = analytics.health.factors.find((item) => item.id === "mastery")?.score ?? analytics.health.score;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    if (!value) return;
    router.push(`/desktop/kb?q=${encodeURIComponent(value)}`);
  }

  function exportAnalysis() {
    downloadCsv("学枢-学习分析.csv", [
      ["知识点", "掌握度", "测量时间", "来源"],
      ...filteredEvidence.map((item) => [item.knowledgePoint, Math.round(item.score), item.measuredAt, item.source]),
    ]);
  }

  function exportGrowth() {
    downloadCsv("学枢-成长记录.csv", [
      ["日期", "学习分钟", "累计学习小时"],
      ...growthData.map((item) => [item.date, item.minutes, item.cumulative]),
    ]);
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div className={styles.headline}>
          <span>{PAGE_META[activePage].range}</span>
          <h1>{PAGE_META[activePage].title}</h1>
          <p>{activePage === "today" ? formattedToday : activePage === "analysis" ? displayDateRange(analytics.generatedAt, 7) : growthRangeLabel}</p>
        </div>

        <div className={styles.headerTools}>
          <form onSubmit={submitSearch} role="search" className={styles.search}>
            <Search aria-hidden />
            <label className="sr-only" htmlFor="home-dossier-search">搜索课程、资料、知识点</label>
            <input id="home-dossier-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索课程、资料、知识点" />
          </form>
          <Link href="/desktop/profile" className={styles.profileLink}>
            <UserAvatar userId={user?.id} name={displayName} size={58} fallback="mascot" />
            <span><strong>{displayName}</strong><small>服务正常</small></span>
            <ChevronRight aria-hidden />
          </Link>
        </div>

        {activePage === "today" ? (
          <nav className={styles.quickActions} aria-label="首页快捷操作">
            <Link href="/desktop/kb"><Upload aria-hidden />上传资料</Link>
            <Link href="/desktop/notes/new"><NotebookPen aria-hidden />新建笔记</Link>
            <Link href="/desktop/practice"><FilePlus2 aria-hidden />生成练习</Link>
            <Link href="/desktop/studio"><MessageCircle aria-hidden />问教师</Link>
          </nav>
        ) : (
          <div className={styles.analysisTools}>
            <label>
              <span className="sr-only">选择课程</span>
              <select value={subject} onChange={(event) => setSubject(event.target.value)}>
                <option value="all">全部课程</option>
                {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <div className={styles.periodTabs} aria-label="时间范围">
              {(activePage === "analysis"
                ? ([['week', '本周'], ['month', '本月'], ['term', '本学期']] as const)
                : ([['month', '本月'], ['term', '本学期'], ['all', '全部']] as const)
              ).map(([value, label]) => (
                <button key={value} type="button" className={period === value ? styles.activePeriod : undefined} onClick={() => setPeriod(value)}>{label}</button>
              ))}
            </div>
            <button type="button" className={styles.exportButton} onClick={activePage === "analysis" ? exportAnalysis : exportGrowth}>
              <Download aria-hidden />{activePage === "analysis" ? "导出分析" : "导出记录"}
            </button>
          </div>
        )}

        <p className={styles.summaryLine}>
          {activePage === "today"
            ? <>计划 <strong>{tasks.length}</strong> 项 · 已完成 <strong>{completedToday}</strong> 项 · 待复习 <strong>{analytics.forgetting.items.length}</strong> 个 · 专注 <strong>{formatMinutes(analytics.dailySummary.activeMinutes)}</strong></>
            : activePage === "analysis"
              ? <>有效投入 <strong>{formatMinutes(analytics.evidence.activeMinutes)}</strong> · 学习证据 <strong>{analytics.evidence.activityEvents + analytics.evidence.masteryMeasurements + analytics.evidence.practiceAttempts + analytics.evidence.taskRecords}</strong> 条 · 掌握度 <strong>{Math.round(feedbackScore || 0)}%</strong></>
              : <>连续学习 <strong>{activeDays}</strong> 天 · 累计 <strong>{growthData.at(-1)?.cumulative || 0}</strong> 小时 · 完成 <strong>{resources.length}</strong> 项 · 掌握度 <strong>+{Math.max(0, Math.round(feedbackScore || 0) - 68)}%</strong></>}
        </p>
      </header>

      <AnimatePresence initial={false} mode="wait" custom={pageDirection}>
        <motion.main
          key={activePage}
          className={styles.stage}
          custom={pageDirection}
          variants={pageSwap}
          transition={pageSwap.transition}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          {activePage === "today" && (
            <TodayPage
              tasks={tasks}
              activeTaskIndex={activeTaskIndex}
              selectedTask={selectedTask}
              selectedResource={selectedResource}
              todayPlan={todayPlan}
              progress={progress}
              analytics={analytics}
              resources={recentResources}
              loading={loading}
              hasLearningPath={hasLearningPath}
              onSelectTask={onSelectTask}
              onOpenResource={onOpenResource}
            />
          )}
          {activePage === "analysis" && (
            <AnalysisPage
              trendData={trendData}
              priorityItems={priorityItems}
              graphData={graphData}
              analytics={analytics}
              activityData={growthData.slice(-7)}
              focusAverage={focusAverage}
              loading={loading}
            />
          )}
          {activePage === "growth" && (
            <GrowthPage
              growthData={growthData}
              resources={recentResources}
              analytics={analytics}
              activeDays={activeDays}
              focusAverage={focusAverage}
              goldenHour={goldenHour}
              onOpenResource={onOpenResource}
            />
          )}
        </motion.main>
      </AnimatePresence>

      <nav className={cn(styles.pager, activePage === "today" && styles.todayPager)} aria-label="首页分页">
        <button type="button" disabled={currentIndex === 0} onClick={() => changePage(currentIndex - 1)}>
          <ArrowLeft aria-hidden />{currentIndex > 0 ? `上一页：${PAGE_META[PAGE_ORDER[currentIndex - 1]].title}` : "已经是第一页"}
        </button>
        <div>
          {PAGE_ORDER.map((page, index) => <button key={page} type="button" aria-label={`第 ${index + 1} 页：${PAGE_META[page].title}`} aria-current={page === activePage ? "page" : undefined} onClick={() => changePage(index)} />)}
          <span>{currentIndex + 1} / 3</span>
        </div>
        <button type="button" disabled={currentIndex === 2} onClick={() => changePage(currentIndex + 1)}>
          {currentIndex < 2 ? `下一页：${PAGE_META[PAGE_ORDER[currentIndex + 1]].title}` : "已经是最后一页"}<ArrowRight aria-hidden />
        </button>
      </nav>
    </div>
  );
}

function TodayPage({
  tasks,
  activeTaskIndex,
  selectedTask,
  selectedResource,
  todayPlan,
  progress,
  analytics,
  resources,
  loading,
  hasLearningPath,
  onSelectTask,
  onOpenResource,
}: {
  tasks: DailyTaskItem[];
  activeTaskIndex: number;
  selectedTask?: DailyTaskItem;
  selectedResource?: ResourceItem;
  todayPlan?: DailyTaskPlan;
  progress: number;
  analytics: LearningAnalytics;
  resources: ResourceItem[];
  loading: boolean;
  hasLearningPath: boolean;
  onSelectTask: (key: string) => void;
  onOpenResource: (resource: ResourceItem) => void;
}) {
  const reviewItems = analytics.forgetting.items.slice(0, 3);
  const trend = analytics.health.factors.filter((item) => item.score !== null).map((item, index) => ({ label: String(index + 1), score: Math.round(item.score || 0) }));
  return (
    <div className={styles.todayGrid}>
      <div className={styles.todayPrimary}>
        <section className={cn(styles.card, styles.currentTask)}>
          <CardTitle aside={<span>{todayPlan?.objective || "当前学习路径"}</span>}>当前学习任务</CardTitle>
          {tasks.length > 0 && selectedTask ? (
            <div className={styles.currentBody}>
              <div className={styles.currentCopy}>
                <small>{taskSubjectLabel(selectedTask)}</small>
                <h2 title={selectedTask.title}>{compactTaskTitle(selectedTask.title, 22)}</h2>
                <p>{selectedTask.detail}</p>
                <ol className={styles.taskSteps} aria-label="今日学习步骤">
                  {tasks.slice(0, 5).map((task, index) => (
                    <li key={task.key} className={cn(task.completed && styles.doneStep, index === activeTaskIndex && styles.currentStep)}>
                      <button type="button" onClick={() => onSelectTask(task.key)}>
                        <span>{task.completed ? <Check aria-hidden /> : index + 1}</span>
                        <strong title={task.title}>{compactTaskTitle(task.title, 12)}</strong>
                      </button>
                    </li>
                  ))}
                  {tasks.length > 0 && tasks.length < 3 && Array.from({ length: 3 - tasks.length }, (_, offset) => (
                    <li key={`future-step-${offset}`}>
                      <button type="button" disabled aria-label="后续阶段将在完成当前任务后解锁">
                        <span>{tasks.length + offset + 1}</span>
                        <strong>{offset === 0 ? "优化实践" : "综合应用"}</strong>
                      </button>
                    </li>
                  ))}
                </ol>
                <p className={styles.nextHint}><Target aria-hidden />下一步：{selectedTask.standard || "完成当前任务并留下学习证据"}</p>
                <div className={styles.primaryActions}>
                  <Link href={hasLearningPath ? "/desktop/path/study" : "/desktop/path"}>{hasLearningPath ? "继续学习" : "建立学习路径"}<ArrowRight aria-hidden /></Link>
                  <Link href="/desktop/path">查看学习路径<ChevronRight aria-hidden /></Link>
                  {selectedResource && <button type="button" onClick={() => onOpenResource(selectedResource)}>打开资料</button>}
                </div>
              </div>
              <div className={styles.progressRing} aria-label={`当前路径完成 ${progress}%`}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 112, height: 112 }}>
                  <RadialBarChart data={[{ value: progress, fill: "#b73727" }]} startAngle={90} endAngle={-270} innerRadius="72%" outerRadius="98%">
                    <RadialBar dataKey="value" background={{ fill: "#e9e1d5" }} cornerRadius={8} />
                  </RadialBarChart>
                </ResponsiveContainer>
                <strong>{progress}%</strong>
              </div>
            </div>
          ) : (
            <div className={styles.empty}><GraduationCap aria-hidden /><p>还没有可执行的今日任务。</p><Link href="/desktop/path">建立学习路径</Link></div>
          )}
        </section>

        <section className={cn(styles.card, styles.nextTasks)}>
          <CardTitle>下一步任务</CardTitle>
          <div className={styles.rowList}>
            {tasks.slice(0, 3).map((task) => (
              <button key={task.key} type="button" onClick={() => onSelectTask(task.key)}>
                <span>{task.completed ? <CheckCircle2 aria-hidden /> : <ListChecks aria-hidden />}</span>
                <strong title={task.title}>{compactTaskTitle(task.title)}</strong><small>{task.minutes} 分钟</small><ChevronRight aria-hidden />
              </button>
            ))}
            {tasks.length > 0 && tasks.length < 3 && Array.from({ length: 3 - tasks.length }, (_, offset) => (
              <button key={`future-task-${offset}`} type="button" disabled aria-label="后续任务将在完成当前阶段后解锁">
                <span><ListChecks aria-hidden /></span>
                <strong>{offset === 0 ? "优化实践" : "综合应用"}</strong><small>待解锁</small><ChevronRight aria-hidden />
              </button>
            ))}
            {tasks.length === 0 && <p>启用学习路径后，这里会显示下一步任务。</p>}
          </div>
        </section>

        <section className={cn(styles.card, styles.recentCard)}>
          <CardTitle>最近继续</CardTitle>
          <div className={styles.rowList}>
            {resources.slice(0, 3).map((resource) => (
              <button key={resource.id} type="button" onClick={() => onOpenResource(resource)}>
                <span><FileText aria-hidden /></span><strong>{resource.title}</strong><small>{resource.meta[0] || "已审核"}</small><ChevronRight aria-hidden />
              </button>
            ))}
            {resources.length === 0 && <p>完成并审核一份学习资料后，可从这里继续。</p>}
          </div>
        </section>
      </div>

      <aside className={styles.todaySecondary}>
        <section className={cn(styles.card, styles.schedule)}>
          <CardTitle aside={<Link href="/desktop/calendar">管理日程<ChevronRight aria-hidden /></Link>}>今日安排</CardTitle>
          <ol>
            {tasks.slice(0, 4).map((task, index) => (
              <li key={task.key}><time>{["09:30", "10:30", "14:00", "16:00"][index]}</time><span aria-hidden /><strong title={task.title}>{compactTaskTitle(task.title, 14)}</strong><small>{task.minutes} 分钟</small></li>
            ))}
            {tasks.length > 0 && tasks.length < 3 && Array.from({ length: 3 - tasks.length }, (_, offset) => <li key={`future-schedule-${offset}`}><time>{["14:00", "16:00"][offset]}</time><span aria-hidden /><strong>{offset === 0 ? "错题回顾" : "综合应用"}</strong><small>{offset === 0 ? "15 分钟" : "待解锁"}</small></li>)}
            {tasks.length === 0 && <li><time>—</time><span aria-hidden /><strong>等待学习路径</strong></li>}
          </ol>
        </section>

        <section className={cn(styles.card, styles.review)}>
          <CardTitle aside={<Link href="/desktop/practice">开始复习</Link>}>待复习</CardTitle>
          <div className={styles.reviewList}>
            {reviewItems.map((item) => <Link href="/desktop/practice" key={`${item.subject}-${item.knowledgePoint}`}><FileText aria-hidden /><strong>{item.knowledgePoint}</strong><small>{item.daysSinceStudy > 0 ? `${item.daysSinceStudy} 天未复习` : "今天"}</small></Link>)}
            {reviewItems.length === 0 && <p>暂时没有达到预警阈值的知识点。</p>}
          </div>
        </section>

        <section className={cn(styles.card, styles.feedback)}>
          <CardTitle>学习反馈</CardTitle>
          <div className={styles.feedbackBody}>
            <div><small>本周期掌握度</small><strong>{Math.round(analytics.health.factors.find((item) => item.id === "mastery")?.score || 0)}%</strong><p>{loading ? "正在同步学习证据…" : analytics.health.risks[0] || analytics.health.strengths[0] || "继续积累学习证据"}</p></div>
            <div className={styles.miniChart}>
              {trend.length > 1 ? <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 180, height: 72 }}><LineChart data={trend}><Line dataKey="score" stroke="#37654b" strokeWidth={2.5} dot={{ r: 3, fill: "#f8f2e8", strokeWidth: 2 }} /><XAxis dataKey="label" hide /><YAxis domain={[0, 100]} hide /></LineChart></ResponsiveContainer> : <span>证据不足</span>}
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function AnalysisPage({ trendData, priorityItems, graphData, analytics, activityData, focusAverage, loading }: {
  trendData: Array<{ date: string; score: number; topic: string }>;
  priorityItems: Array<{ title: string; score: number; hint: string }>;
  graphData: Array<{ name: string; score: number; x: number; y: number; z: number }>;
  analytics: LearningAnalytics;
  activityData: Array<{ date: string; minutes: number; cumulative: number }>;
  focusAverage: number;
  loading: boolean;
}) {
  const [trendMetric, setTrendMetric] = useState<"mastery" | "minutes">("mastery");
  const topObservation = analytics.teacherObservations.items[0];
  const completionRate = analytics.health.factors.find((item) => item.id === "completion")?.score;
  const heatCells = activityData.map((item) => ({
    ...item,
    level: item.minutes === 0 ? 0 : item.minutes < 20 ? 1 : item.minutes < 45 ? 2 : item.minutes < 75 ? 3 : 4,
  }));
  const graphEdges = graphData.length > 1
    ? graphData.slice(1).flatMap((item) => [graphData[0], item, graphData[0]])
    : [];
  const displayedTrend = trendMetric === "mastery"
    ? trendData.map((item) => ({ date: item.date, value: item.score, topic: item.topic }))
    : activityData.map((item) => ({ date: item.date, value: item.minutes, topic: `${item.minutes} 分钟` }));
  return (
    <div className={styles.analysisGrid}>
      <div className={styles.analysisPrimary}>
        <section className={cn(styles.card, styles.trendCard)}>
          <CardTitle aside={<div className={styles.chartTabs}><button type="button" className={trendMetric === "mastery" ? styles.activeChartTab : undefined} onClick={() => setTrendMetric("mastery")}>掌握度</button><button type="button" className={trendMetric === "minutes" ? styles.activeChartTab : undefined} onClick={() => setTrendMetric("minutes")}>学习时长</button></div>}>掌握度趋势</CardTitle>
          <div className={styles.chartArea}>
            {displayedTrend.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 640, height: 260 }}>
                <AreaChart data={displayedTrend} margin={{ top: 14, right: 18, bottom: 4, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="#ded4c6" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#786b5a", fontSize: 12 }} />
                  <YAxis domain={trendMetric === "mastery" ? [0, 100] : [0, "auto"]} axisLine={false} tickLine={false} tick={{ fill: "#786b5a", fontSize: 12 }} />
                  <Tooltip contentStyle={{ border: "1px solid #cfbea7", background: "#fffaf2", borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="value" name={trendMetric === "mastery" ? "掌握度" : "学习分钟"} stroke="#37654b" strokeWidth={3} fill="#dbe3d8" fillOpacity={0.72} dot={{ r: 4, fill: "#fffaf2", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className={styles.emptyChart}>{loading ? "正在同步趋势…" : "至少需要两次掌握度测量才能形成趋势"}</div>}
          </div>
        </section>

        <section className={cn(styles.card, styles.knowledgeCard)}>
          <CardTitle aside={<span>点击知识图谱可查看完整判断</span>}>知识结构</CardTitle>
          {graphData.length > 0 ? (
            <Link href="/desktop/profile?view=graph" className={styles.scatterWrap} aria-label="打开完整知识掌握图谱">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 560, height: 230 }}>
                <ScatterChart margin={{ top: 18, right: 22, bottom: 18, left: 22 }}>
                  <XAxis type="number" dataKey="x" domain={[0, 100]} hide />
                  <YAxis type="number" dataKey="y" domain={[0, 100]} hide />
                  <ZAxis type="number" dataKey="z" range={[3200, 9200]} />
                  <Scatter data={graphEdges} line={{ stroke: "#72917d", strokeWidth: 1.35 }} lineType="joint" fill="transparent" />
                  <Scatter data={graphData} dataKey="z">
                    {graphData.map((item) => <Cell key={item.name} fill={item.score < 65 ? "#b93b2b" : item.score < 78 ? "#bd7a24" : "#37654b"} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <span className={styles.graphLabels} aria-hidden>
                {graphData.map((item) => <span key={item.name} style={{ left: `${item.x}%`, top: `${100 - item.y}%` }}>{item.name}</span>)}
              </span>
            </Link>
          ) : <div className={styles.emptyChart}>完成摸底或阶段练习后形成知识结构。</div>}
        </section>
      </div>

      <div className={styles.analysisSecondary}>
        <section className={cn(styles.card, styles.priorityCard)}>
          <CardTitle>薄弱项优先级</CardTitle>
          <ol>
            {priorityItems.map((item, index) => (
              <li key={item.title}><span>{index + 1}</span><div><strong>{item.title}</strong><i><b style={{ width: `${item.score}%` }} /></i><small>{item.hint}</small></div><em>{item.score}%</em><Link href="/desktop/practice">开始复习<ChevronRight aria-hidden /></Link></li>
            ))}
            {priorityItems.length === 0 && <p>当前没有足够证据排列薄弱项。</p>}
          </ol>
        </section>

        <section className={cn(styles.card, styles.behaviorCard)}>
          <CardTitle>学习行为</CardTitle>
          <div className={styles.behaviorStats}>
            <div><Clock3 aria-hidden /><span>高效时段<strong>{analytics.efficiency.goldenHour === null ? "尚未形成" : `${String(analytics.efficiency.goldenHour).padStart(2, "0")}:00–${String((analytics.efficiency.goldenHour + 1) % 24).padStart(2, "0")}:00`}</strong></span></div>
            <div><Target aria-hidden /><span>平均专注<strong>{focusAverage} 分钟</strong></span></div>
            <div><BookOpenCheck aria-hidden /><span>练习完成率<strong>{completionRate === null || completionRate === undefined ? "—" : `${Math.round(completionRate)}%`}</strong></span></div>
          </div>
          <div className={styles.behaviorHeatHeader}><span>专注分布（近 7 天）</span><small>低 — 高</small></div>
          <div className={cn(styles.heatmap, styles.weekHeatmap)} aria-label="最近七天专注分布">
            {heatCells.map((cell) => <span key={cell.date} data-level={cell.level} title={`${cell.date}：${cell.minutes} 分钟`} />)}
          </div>
          <div className={styles.weekHeatLabels}>{heatCells.map((cell) => <span key={cell.date}>{cell.date}</span>)}</div>
        </section>

        <section className={cn(styles.card, styles.conclusionCard)}>
          <CardTitle><Sparkles aria-hidden />智能教师结论</CardTitle>
          <p>{topObservation?.detail || analytics.subjectBalance.findings[0] || "目前证据不足，继续完成学习任务后再给出判断。"}{priorityItems[0] ? ` 当前最高优先项为“${priorityItems[0].title}”，建议先完成一次针对性回顾，再验证掌握变化。` : ""}</p>
          <div><Link href="/desktop/practice"><Target aria-hidden />{priorityItems[0] ? `先复习 ${priorityItems[0].title}` : "先完成一组针对性练习"}</Link><Link href="/desktop/profile?view=graph"><BarChart3 aria-hidden />再查看完整掌握图谱</Link></div>
        </section>
      </div>
    </div>
  );
}

function GrowthPage({ growthData, resources, analytics, activeDays, focusAverage, goldenHour, onOpenResource }: {
  growthData: Array<{ date: string; minutes: number; cumulative: number }>;
  resources: ResourceItem[];
  analytics: LearningAnalytics;
  activeDays: number;
  focusAverage: number;
  goldenHour: number | null;
  onOpenResource: (resource: ResourceItem) => void;
}) {
  const abilities = [
    ["算法思维", analytics.health.factors.find((item) => item.id === "mastery")?.score, BrainCircuit],
    ["代码实现", analytics.health.factors.find((item) => item.id === "practice")?.score, Code2],
    ["问题解决", analytics.health.factors.find((item) => item.id === "completion")?.score, Target],
  ] as const;
  const heatCells = growthData.map((item) => ({ label: item.date, minutes: item.minutes, level: item.minutes === 0 ? 0 : item.minutes < 20 ? 1 : item.minutes < 45 ? 2 : item.minutes < 75 ? 3 : 4 }));
  const milestoneIndices = new Set([0, 4, 9, growthData.length - 1]);
  const milestones = growthData.filter((_, index) => milestoneIndices.has(index));
  const observations = analytics.teacherObservations.items.slice(0, 2);
  return (
    <div className={styles.growthGrid}>
      <div className={styles.growthPrimary}>
        <section className={cn(styles.card, styles.trajectoryCard)}>
          <CardTitle>成长轨迹</CardTitle>
          <div className={styles.trajectoryMilestones} aria-label="成长里程碑">
            {milestones.map((item) => <span key={item.date}><strong>{item.date}</strong><small>累计 {item.cumulative} 小时</small></span>)}
          </div>
          <div className={styles.chartArea}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 760, height: 280 }}>
              <AreaChart data={growthData} margin={{ top: 16, right: 18, bottom: 2, left: -12 }}>
                <CartesianGrid vertical={false} stroke="#ded4c6" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#786b5a", fontSize: 12 }} interval={2} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#786b5a", fontSize: 12 }} />
                <Tooltip contentStyle={{ border: "1px solid #cfbea7", background: "#fffaf2", borderRadius: 6, fontSize: 11 }} />
                <Area type="monotone" dataKey="cumulative" name="累计小时" stroke="#37654b" strokeWidth={3} fill="#dbe3d8" fillOpacity={0.72} dot={(props) => {
                  const { cx, cy, index } = props;
                  const show = index === 0 || index === growthData.length - 1 || index % 4 === 0;
                  return show ? <circle cx={cx} cy={cy} r={4} fill="#fffaf2" stroke="#37654b" strokeWidth={2} /> : <g />;
                }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className={cn(styles.card, styles.archiveCard)}>
          <CardTitle aside={<Link href="/desktop/profile?tab=achievements">查看全部成果<ChevronRight aria-hidden /></Link>}>成果档案</CardTitle>
          <div className={styles.rowList}>
            {resources.map((resource) => <button key={resource.id} type="button" onClick={() => onOpenResource(resource)}><span><FolderOpen aria-hidden /></span><strong>{resource.title}</strong><small>{resource.meta[0] || "已审核"}</small><ChevronRight aria-hidden /></button>)}
            {resources.length === 0 && <p>审核通过的学习成果会自动归档。</p>}
          </div>
        </section>
      </div>

      <div className={styles.growthSecondary}>
        <section className={cn(styles.card, styles.abilityCard)}>
          <CardTitle>能力变化</CardTitle>
          <div>
            {abilities.map(([label, score, Icon]) => <div key={label}><Icon aria-hidden /><strong>{label}</strong><i><b style={{ width: `${score || 0}%` }} /></i><em>{score === null || score === undefined ? "—" : Math.round(score)}</em></div>)}
          </div>
        </section>

        <section className={cn(styles.card, styles.habitCard)}>
          <CardTitle>学习习惯</CardTitle>
          <div className={styles.habitStats}>
            <div><CalendarDays aria-hidden /><span>活跃学习<strong>{activeDays} 天</strong></span></div>
            <div><Clock3 aria-hidden /><span>高效时段<strong>{goldenHour === null ? "尚未形成" : `${String(goldenHour).padStart(2, "0")}:00–${String((goldenHour + 1) % 24).padStart(2, "0")}:00`}</strong></span></div>
            <div><Target aria-hidden /><span>平均专注<strong>{focusAverage} 分钟</strong></span></div>
          </div>
          <div className={styles.heatmap} aria-label="最近十四天学习活跃度">
            {heatCells.map((cell) => <span key={cell.label} data-level={cell.level} title={`${cell.label}：${cell.minutes} 分钟`} />)}
          </div>
          <div className={styles.heatLabels}><span>{heatCells[0]?.label}</span><span>{heatCells.at(-1)?.label}</span></div>
        </section>

        <section className={cn(styles.card, styles.reviewCard)}>
          <CardTitle>智能教师月评</CardTitle>
          <p>{observations[0]?.detail || analytics.subjectBalance.findings[0] || "继续完成学习任务，月评会依据真实证据更新。"}</p>
          <div>
            {observations.map((item) => <span key={item.id}><Sparkles aria-hidden /><strong>{item.title}</strong><small>{item.evidence} 条证据</small></span>)}
            {observations.length === 0 && <span><Sparkles aria-hidden /><strong>暂无足够证据</strong></span>}
          </div>
        </section>
      </div>
    </div>
  );
}
