"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Edit3,
  Flag,
  GraduationCap,
  ListChecks,
  Medal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  X,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { KnowledgeMasteryGraph } from "@/components/desktop/knowledge-mastery-graph";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { AvatarPicker, UserAvatar } from "@/components/user-avatar";
import { useUserSettings } from "@/hooks/use-user-settings";
import {
  listAssessments,
  listPapers,
  type AssessmentRecord,
  type PaperSummary,
} from "@/lib/library";
import {
  getProfileIdentity,
  saveProfileIdentity,
  type ProfileIdentity,
} from "@/lib/profile-identity";
import { buildProfileInsights, type ProfileEvidenceRow } from "@/lib/profile-insights";
import { setUserSettings } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import { getDesktopViewSwap } from "@/lib/web-motion";

import styles from "./profile.module.css";

type EvidenceKind = "all" | "diagnostic" | "practice" | "review";
type ProfileTab = "overview" | "records" | "achievements" | "settings";

const PROFILE_TABS: Array<{ value: ProfileTab; label: string }> = [
  { value: "overview", label: "个人概览" },
  { value: "records", label: "学习记录" },
  { value: "achievements", label: "成果档案" },
  { value: "settings", label: "账号设置" },
];

const DEFAULT_MOTTO = "管理个人头脑，并查看由诊断、练习和学习行为形成的知识掌握图谱；聚焦基础，稳步提升，构建系统化的知识体系。";
const DEFAULT_STRENGTHS = ["逻辑思维", "系统构建", "稳步提升"];

const graphPositions = [
  { x: 50, y: 13 },
  { x: 17, y: 42 },
  { x: 83, y: 42 },
  { x: 26, y: 81 },
  { x: 74, y: 81 },
];

function isProfileTab(value: string | null): value is ProfileTab {
  return PROFILE_TABS.some((tab) => tab.value === value);
}

function identityUpdatedLabel(value: string | null | undefined): string {
  if (!value) return "资料已同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "资料已同步";
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)}`;
}

function evidenceIcon(kind: ProfileEvidenceRow["kind"]) {
  if (kind === "diagnostic") return <ClipboardCheck aria-hidden />;
  if (kind === "practice") return <CheckCircle2 aria-hidden />;
  return <BookOpen aria-hidden />;
}

export default function DesktopProfilePage() {
  const { user } = useAuth();
  const orchestrator = useOrchestratorContext();
  const localSettings = useUserSettings();
  const reducedMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind>("all");
  const [graphOpen, setGraphOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [identity, setIdentity] = useState<ProfileIdentity | null>(null);
  const [identityState, setIdentityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [draftName, setDraftName] = useState("");
  const [draftMotto, setDraftMotto] = useState("");
  const [draftStrengths, setDraftStrengths] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [papers, setPapers] = useState<PaperSummary[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const fallbackName = localSettings.name.trim() || user?.display_name || "同学";
  const displayName = identity?.display_name || fallbackName;
  const major = identity?.major || localSettings.major || user?.major || "尚未填写专业";
  const grade = identity?.grade || localSettings.grade || user?.grade || "尚未填写年级";
  const motto = identity?.motto || DEFAULT_MOTTO;
  const strengths = identity?.strengths.length ? identity.strengths : DEFAULT_STRENGTHS;

  const insights = useMemo(() => buildProfileInsights({
    profile: orchestrator.profile,
    practiceAttempts: orchestrator.practiceAttempts,
    taskEvidence: orchestrator.taskEvidence,
    completedMaterials: orchestrator.completedMaterials,
    watchedVideos: orchestrator.watchedVideos,
    subjectPaths: orchestrator.subjectPaths,
    assessments,
    papers,
  }), [
    assessments,
    orchestrator.completedMaterials,
    orchestrator.practiceAttempts,
    orchestrator.profile,
    orchestrator.subjectPaths,
    orchestrator.taskEvidence,
    orchestrator.watchedVideos,
    papers,
  ]);

  const { summary, focus } = insights;
  const mastery = summary.mastery;
  const weakest = [...orchestrator.profile].sort((a, b) => a.value - b.value)[0];
  const weakestLabel = weakest?.label || "栈与队列";
  const dataReady = orchestrator.hydrated && historyLoaded;
  const viewSwap = getDesktopViewSwap(Boolean(reducedMotion));

  useEffect(() => {
    if (!orchestrator.hydrated || orchestrator.mode === "checking") return;
    let active = true;
    setHistoryLoaded(false);
    void Promise.all([
      listAssessments(orchestrator.mode),
      listPapers(orchestrator.mode),
    ]).then(([nextAssessments, nextPapers]) => {
      if (!active) return;
      setAssessments(nextAssessments);
      setPapers(nextPapers);
    }).finally(() => {
      if (active) setHistoryLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [orchestrator.hydrated, orchestrator.mode]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setIdentityState("loading");
    void getProfileIdentity(user.id)
      .then((nextIdentity) => {
        if (!active) return;
        setIdentity(nextIdentity);
        setUserSettings({ name: nextIdentity.display_name });
        setIdentityState("ready");
      })
      .catch(() => {
        if (active) setIdentityState("error");
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      setActiveTab(isProfileTab(tab) ? tab : "overview");
      setGraphOpen(params.get("view") === "graph");
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const graphNodes = useMemo(() => {
    const labels = ["数组与链表", "栈与队列", "树与二叉树", "哈希表", "排序与搜索"];
    return labels.map((label, index) => ({
      label,
      score: Math.max(38, Math.min(88, mastery + [6, -8, 2, -2, -10][index])),
      ...graphPositions[index],
    }));
  }, [mastery]);

  const filteredEvidence = evidenceKind === "all"
    ? insights.evidence
    : insights.evidence.filter((item) => item.kind === evidenceKind);
  const recentEvidence = insights.evidence.slice(0, 5);

  const achievements = useMemo(() => [
    {
      title: "本月投入突破 20 小时",
      description: `已累计 ${summary.studyHoursLabel} 小时学习记录`,
      progress: Math.min(100, Math.round((summary.studyMinutes / 1200) * 100)),
      earned: summary.studyMinutes >= 1200,
      href: "/desktop/path",
    },
    {
      title: "知识掌握稳定在 80% 以上",
      description: `当前综合掌握度 ${summary.mastery}%`,
      progress: Math.min(100, Math.round((summary.mastery / 80) * 100)),
      earned: summary.mastery >= 80,
      href: "/desktop/profile?view=graph",
    },
    {
      title: "完成 15 道有效练习",
      description: `最近 30 天完成 ${summary.completedQuestions} 题`,
      progress: Math.min(100, Math.round((summary.completedQuestions / 15) * 100)),
      earned: summary.completedQuestions >= 15,
      href: "/desktop/practice",
    },
    {
      title: "学习路径推进至 70%",
      description: focus ? `${focus.subjectTitle}当前进度 ${focus.progress}%` : "启用学习路径后开始记录",
      progress: Math.min(100, Math.round(((focus?.progress || 0) / 70) * 100)),
      earned: Boolean(focus && focus.progress >= 70),
      href: "/desktop/path",
    },
  ], [focus, summary.completedQuestions, summary.mastery, summary.studyHoursLabel, summary.studyMinutes]);

  const selectTab = (tab: ProfileTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    url.searchParams.delete("view");
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const openEditor = () => {
    setDraftName(displayName);
    setDraftMotto(motto);
    setDraftStrengths(strengths.join("、"));
    setSaveState("idle");
    setSaveError("");
    setEditorOpen(true);
  };

  const saveEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user?.id || !draftName.trim()) return;
    const nextStrengths = draftStrengths
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 5);
    setSaveState("saving");
    setSaveError("");
    try {
      const nextIdentity = await saveProfileIdentity(user.id, {
        display_name: draftName.trim(),
        motto: draftMotto.trim(),
        strengths: nextStrengths,
      });
      setIdentity(nextIdentity);
      setUserSettings({ name: nextIdentity.display_name });
      setSaveState("saved");
      window.setTimeout(() => setEditorOpen(false), 480);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "个人资料保存失败，请稍后重试");
    }
  };

  const openGraph = () => {
    setGraphOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "graph");
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const closeGraph = () => {
    setGraphOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.get("view") !== "graph") return;
    url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    if (!editorOpen && !graphOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editorOpen) setEditorOpen(false);
      else closeGraph();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className={cn(styles.page, "thin-scroll")}>
      <div className={styles.frame}>
        <section className={styles.identity} aria-labelledby="profile-identity-title">
          <div className={styles.identityAvatar}>
            <UserAvatar userId={user?.id} name={displayName} size={112} />
          </div>
          <div className={styles.identityCopy}>
            <h1 id="profile-identity-title">{displayName}</h1>
            <p className={styles.identityMeta}>
              <GraduationCap aria-hidden />
              {major} <i aria-hidden /> {grade}
            </p>
            <p className={styles.identityMotto}>{motto}</p>
            <div className={styles.identityTags} aria-label="学习特点">
              {strengths.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
          <div className={styles.identityActions}>
            <button type="button" onClick={openEditor}>
              <Edit3 aria-hidden /> 编辑资料
            </button>
            <small className={cn(identityState === "error" && styles.syncError)}>
              {identityState === "loading"
                ? "正在同步资料"
                : identityState === "error"
                  ? "当前使用本机资料"
                  : identityUpdatedLabel(identity?.updated_at)}
            </small>
          </div>
        </section>

        <nav className={styles.tabs} aria-label="个人主页分区">
          {PROFILE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={cn(activeTab === tab.value && styles.activeTab)}
              aria-current={activeTab === tab.value ? "page" : undefined}
              onClick={() => selectTab(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className={styles.stage}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} {...viewSwap} className={styles.stageView}>
              {activeTab === "overview" && (
                <OverviewTab
                  dataReady={dataReady}
                  summary={summary}
                  focus={focus}
                  recentEvidence={recentEvidence}
                  graphNodes={graphNodes}
                  weakestLabel={weakestLabel}
                  onOpenGraph={openGraph}
                  onOpenRecords={() => selectTab("records")}
                />
              )}

              {activeTab === "records" && (
                <RecordsTab
                  dataReady={dataReady}
                  evidenceKind={evidenceKind}
                  evidence={filteredEvidence}
                  onKindChange={setEvidenceKind}
                />
              )}

              {activeTab === "achievements" && (
                <AchievementsTab achievements={achievements} evidence={insights.evidence} />
              )}

              {activeTab === "settings" && (
                <SettingsTab
                  displayName={displayName}
                  major={major}
                  grade={grade}
                  motto={motto}
                  preferences={user?.preferences || []}
                  goals={[user?.long_term_goal, user?.mid_term_goal, user?.short_term_goal].filter(Boolean) as string[]}
                  onEdit={openEditor}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {editorOpen && (
          <motion.div
            className={styles.modalBackdrop}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEditorOpen(false)}
          >
            <motion.form
              className={styles.editor}
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-editor-title"
              initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: reducedMotion ? 0 : 0.2 }}
              onSubmit={saveEditor}
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <span>PERSONAL DOSSIER</span>
                  <h2 id="profile-editor-title">编辑个人资料</h2>
                </div>
                <button type="button" onClick={() => setEditorOpen(false)} aria-label="关闭编辑资料">
                  <X aria-hidden />
                </button>
              </header>

              <AvatarPicker userId={user?.id} name={draftName || displayName} />

              <div className={styles.editorFields}>
                <label>
                  <span>显示名称</span>
                  <input
                    value={draftName}
                    maxLength={40}
                    required
                    onChange={(event) => setDraftName(event.target.value)}
                  />
                </label>
                <label>
                  <span>个人签名</span>
                  <textarea
                    value={draftMotto}
                    maxLength={120}
                    rows={3}
                    onChange={(event) => setDraftMotto(event.target.value)}
                  />
                </label>
                <label>
                  <span>学习特点</span>
                  <input
                    value={draftStrengths}
                    maxLength={80}
                    placeholder="使用顿号或逗号分隔，最多 5 项"
                    onChange={(event) => setDraftStrengths(event.target.value)}
                  />
                </label>
                <p>专业与年级由学情设置统一管理，避免个人主页和学习路径使用两套数据。</p>
              </div>

              {saveError && <p className={styles.formError} role="alert">{saveError}</p>}
              <footer>
                <button type="button" onClick={() => setEditorOpen(false)}>取消</button>
                <button type="submit" disabled={saveState === "saving" || !draftName.trim()}>
                  {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存资料"}
                </button>
              </footer>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {graphOpen && (
          <motion.div
            className={styles.graphBackdrop}
            role="dialog"
            aria-modal="true"
            aria-label="完整知识掌握图谱"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeGraph}
          >
            <motion.div
              className={styles.graphPanel}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" className={styles.graphClose} onClick={closeGraph}>
                <X aria-hidden />
                <span className="sr-only">关闭完整图谱</span>
              </button>
              <KnowledgeMasteryGraph />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Summary = ReturnType<typeof buildProfileInsights>["summary"];
type Focus = ReturnType<typeof buildProfileInsights>["focus"];
type GraphNode = { label: string; score: number; x: number; y: number };

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <header className={styles.sectionTitle}>
      <h2>{children}</h2>
      {aside}
    </header>
  );
}

function OverviewTab({
  dataReady,
  summary,
  focus,
  recentEvidence,
  graphNodes,
  weakestLabel,
  onOpenGraph,
  onOpenRecords,
}: {
  dataReady: boolean;
  summary: Summary;
  focus: Focus;
  recentEvidence: ProfileEvidenceRow[];
  graphNodes: GraphNode[];
  weakestLabel: string;
  onOpenGraph: () => void;
  onOpenRecords: () => void;
}) {
  return (
    <div className={styles.overviewGrid}>
      <div className={styles.primaryColumn}>
        <section className={styles.panel}>
          <SectionTitle
            aside={
              <span className={styles.heatLegend}>
                最近 30 天活跃力图 <i /> <i /> <i /> <i /> <i />
              </span>
            }
          >
            成长轨迹
          </SectionTitle>

          <div className={styles.activityStrip} aria-label="最近 30 天学习活跃度">
            {summary.activityLevels.map((level, index) => (
              <span key={index} data-level={level} aria-hidden />
            ))}
            <footer><span>{summary.rangeStartLabel}</span><span>{summary.rangeEndLabel}</span></footer>
          </div>

          <div className={styles.timeline}>
            {recentEvidence.map((item) => (
              <Link href={item.href} key={item.id} className={styles.timelineRow}>
                <time>{item.time}</time>
                <span className={cn(styles.timelineDot, styles[`kind_${item.kind}`])} aria-hidden />
                <span className={styles.timelineIcon}>{evidenceIcon(item.kind)}</span>
                <strong>{item.content}</strong>
                <em>{item.label}</em>
                <span>{item.result}</span>
                <ChevronRight aria-hidden />
              </Link>
            ))}
            {!dataReady && <p className={styles.emptyState}>正在同步学习履历…</p>}
            {dataReady && recentEvidence.length === 0 && (
              <p className={styles.emptyState}>完成一次摸底、练习或学习复盘后，成长轨迹会从这里开始。</p>
            )}
          </div>
        </section>

        <section className={cn(styles.panel, styles.summaryPanel)}>
          <SectionTitle aside={<small>截至今天</small>}>本月小结</SectionTitle>
          <div className={styles.metrics}>
            <div><Clock3 aria-hidden /><span>学习时长</span><strong>{dataReady ? summary.studyHoursLabel : "—"}<small> 小时</small></strong><em>{dataReady ? `日均 ${summary.dailyAverageLabel} 小时` : "同步中"}</em></div>
            <div><Target aria-hidden /><span>知识点掌握度</span><strong>{summary.mastery}<small>%</small></strong><em>{summary.masteryDelta === 0 ? "最近暂无变化" : `较上月 ${summary.masteryDelta > 0 ? "↑" : "↓"} ${Math.abs(summary.masteryDelta)}%`}</em></div>
            <div><ListChecks aria-hidden /><span>完成练习</span><strong>{dataReady ? summary.completedQuestions : "—"}<small> 题</small></strong><em>{summary.accuracy === null ? "暂无评分记录" : `正确率 ${summary.accuracy}%`}</em></div>
          </div>
        </section>

        <section className={cn(styles.panel, styles.compactEvidence)}>
          <SectionTitle aside={<button type="button" onClick={onOpenRecords}>查看全部 <ChevronRight aria-hidden /></button>}>最近学习证据</SectionTitle>
          <EvidenceTable evidence={recentEvidence.slice(0, 3)} compact />
        </section>
      </div>

      <aside className={styles.secondaryColumn}>
        <section className={cn(styles.panel, styles.focusPanel)}>
          <SectionTitle><Flag aria-hidden /> 当前学习重点</SectionTitle>
          <p className={styles.focusStatus}>{focus?.statusLabel || "尚未开始"}</p>
          <h3>{focus?.subjectTitle || "尚未启用学习路径"}</h3>
          <p>{focus?.description || "前往学习路径创建或启用科目后，这里会显示当前阶段和真实完成进度。"}</p>
          <dl>
            <div><dt>当前进度</dt><dd>{focus ? `${focus.progress}%` : "暂无"}</dd></div>
            <div><dt>完成情况</dt><dd>{focus ? `${focus.completedTasks}/${focus.totalTasks} 项` : "等待启用"}</dd></div>
            <div><dt>剩余用时</dt><dd>{focus && focus.remainingMinutes > 0 ? `约 ${(focus.remainingMinutes / 60).toFixed(1)} 小时` : "—"}</dd></div>
          </dl>
          <div className={styles.progressTrack}><span style={{ width: `${focus?.progress || 0}%` }} /></div>
          <Link href={focus?.status === "active" ? "/desktop/path/study" : "/desktop/path"} className={styles.primaryAction}>
            {focus?.status === "active" ? "继续学习" : "查看学习路径"} <ArrowRight aria-hidden />
          </Link>
        </section>

        <section className={cn(styles.panel, styles.masteryPanel)}>
          <SectionTitle aside={<button type="button" onClick={onOpenGraph}>查看完整图谱 <ChevronRight aria-hidden /></button>}>知识掌握图谱</SectionTitle>
          <div className={styles.masteryMap} aria-label="数据结构知识掌握概览">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {graphNodes.map((node) => <line key={node.label} x1="50" y1="53" x2={node.x} y2={node.y} />)}
            </svg>
            <div className={styles.masteryRoot}><strong>数据结构</strong><small>{summary.mastery}%</small></div>
            {graphNodes.map((node) => (
              <div
                key={node.label}
                className={styles.masteryNode}
                style={{ "--node-x": `${node.x}%`, "--node-y": `${node.y}%` } as CSSProperties}
              >
                <strong>{node.label}</strong><small>{node.score}%</small>
              </div>
            ))}
          </div>
          <div className={styles.aiJudgement}>
            <h3><Sparkles aria-hidden /> AI 判断</h3>
            <p>整体掌握良好。建议先复习{weakestLabel}的边界条件，再完成一组综合练习。</p>
          </div>
        </section>
      </aside>
    </div>
  );
}

function RecordsTab({
  dataReady,
  evidenceKind,
  evidence,
  onKindChange,
}: {
  dataReady: boolean;
  evidenceKind: EvidenceKind;
  evidence: ProfileEvidenceRow[];
  onKindChange: (kind: EvidenceKind) => void;
}) {
  return (
    <section className={cn(styles.panel, styles.recordsPanel)}>
      <div className={styles.recordsHeader}>
        <div>
          <span>LEARNING RECORDS</span>
          <h2>学习记录</h2>
          <p>诊断、练习和路径复盘会自动沉淀为可追溯的学习证据。</p>
        </div>
        <div className={styles.filterTabs} aria-label="筛选学习证据">
          {([
            ["all", "全部"],
            ["diagnostic", "诊断"],
            ["practice", "练习"],
            ["review", "复习"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" className={cn(evidenceKind === value && styles.activeFilter)} onClick={() => onKindChange(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <EvidenceTable evidence={evidence} />
      {!dataReady && <p className={styles.emptyState}>正在同步后端学习记录…</p>}
      {dataReady && evidence.length === 0 && <p className={styles.emptyState}>还没有这类记录，完成相应学习活动后会自动归档。</p>}
    </section>
  );
}

function EvidenceTable({ evidence, compact = false }: { evidence: ProfileEvidenceRow[]; compact?: boolean }) {
  return (
    <div className={cn(styles.evidenceTable, compact && styles.compactTable)}>
      <div className={styles.evidenceHead} role="row">
        <span>类型</span><span>内容</span><span>关联知识点</span><span>结果</span><span>时间</span><span />
      </div>
      {evidence.map((item) => (
        <Link href={item.href} key={item.id} className={styles.evidenceRow}>
          <span className={styles[`kind_${item.kind}`]}>{evidenceIcon(item.kind)}{item.label}</span>
          <strong>{item.content}</strong>
          <span>{item.knowledge}</span>
          <span>{item.result}</span>
          <time>{item.time}</time>
          <ChevronRight aria-hidden />
        </Link>
      ))}
    </div>
  );
}

function AchievementsTab({
  achievements,
  evidence,
}: {
  achievements: Array<{ title: string; description: string; progress: number; earned: boolean; href: string }>;
  evidence: ProfileEvidenceRow[];
}) {
  return (
    <div className={styles.achievementLayout}>
      <section className={cn(styles.panel, styles.achievementPanel)}>
        <div className={styles.recordsHeader}>
          <div><span>PORTFOLIO</span><h2>成果档案</h2><p>只展示由真实学习记录计算出的里程碑，不制造虚假的成就数字。</p></div>
        </div>
        <div className={styles.achievementGrid}>
          {achievements.map((item, index) => (
            <Link href={item.href} key={item.title} className={cn(styles.achievementCard, item.earned && styles.earned)}>
              <span>{item.earned ? <Medal aria-hidden /> : <Award aria-hidden />}</span>
              <div><small>{String(index + 1).padStart(2, "0")}</small><h3>{item.title}</h3><p>{item.description}</p></div>
              <strong>{item.earned ? "已达成" : `${item.progress}%`}</strong>
              <div className={styles.achievementProgress}><i style={{ width: `${item.progress}%` }} /></div>
            </Link>
          ))}
        </div>
      </section>
      <aside className={cn(styles.panel, styles.milestones)}>
        <SectionTitle>最近里程碑</SectionTitle>
        {evidence.slice(0, 8).map((item) => (
          <Link href={item.href} key={item.id}>
            <span>{evidenceIcon(item.kind)}</span>
            <div><strong>{item.content}</strong><small>{item.result} · {item.time}</small></div>
            <CheckCircle2 aria-hidden />
          </Link>
        ))}
        {evidence.length === 0 && <p className={styles.emptyState}>完成学习任务后，里程碑会在这里自动形成。</p>}
      </aside>
    </div>
  );
}

function SettingsTab({
  displayName,
  major,
  grade,
  motto,
  preferences,
  goals,
  onEdit,
}: {
  displayName: string;
  major: string;
  grade: string;
  motto: string;
  preferences: string[];
  goals: string[];
  onEdit: () => void;
}) {
  return (
    <div className={styles.settingsLayout}>
      <section className={cn(styles.panel, styles.settingsPanel)}>
        <div className={styles.recordsHeader}>
          <div><span>ACCOUNT & PROFILE</span><h2>账号设置</h2><p>个人资料和学习偏好使用同一账户数据，修改后会同步到桌面端各处。</p></div>
        </div>
        <dl className={styles.identityList}>
          <div><dt><UserRound aria-hidden /> 显示名称</dt><dd>{displayName}</dd></div>
          <div><dt><GraduationCap aria-hidden /> 专业与年级</dt><dd>{major} · {grade}</dd></div>
          <div><dt><Sparkles aria-hidden /> 个人签名</dt><dd>{motto}</dd></div>
        </dl>
        <button type="button" className={styles.editAction} onClick={onEdit}><Edit3 aria-hidden /> 编辑个人资料</button>
      </section>

      <aside className={styles.settingsAside}>
        <section className={styles.panel}>
          <SectionTitle>学习偏好</SectionTitle>
          <div className={styles.preferenceTags}>
            {(preferences.length ? preferences : ["尚未设置学习偏好"]).map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>
        <section className={styles.panel}>
          <SectionTitle>目标摘要</SectionTitle>
          <ul className={styles.goalList}>
            {(goals.length ? goals : ["前往目标与设置补充长期、阶段和近期目标"]).map((item) => <li key={item}><Target aria-hidden />{item}</li>)}
          </ul>
        </section>
        <section className={cn(styles.panel, styles.privacyCard)}>
          <ShieldCheck aria-hidden />
          <div><strong>资料与学习证据只属于当前账户</strong><p>头像保存在当前设备，身份卡与学习数据由本地后端持久化。</p></div>
        </section>
        <Link href="/desktop/settings" className={styles.primaryAction}><Settings2 aria-hidden /> 前往完整设置 <ChevronRight aria-hidden /></Link>
      </aside>
    </div>
  );
}
