"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  Binary,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  GitBranch,
  Info,
  Layers3,
  ListTree,
  Lightbulb,
  MessageCircle,
  Network,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import { listAssessments, type AssessmentRecord } from "@/lib/library";
import type { ProfileDim } from "@/lib/types";
import { cn } from "@/lib/utils";

import styles from "./knowledge-graph.module.css";

type MasteryScore = number | null;
type EdgeStrength = "strong" | "medium" | "weak";

interface MasteryNode {
  id: string;
  label: string;
  score: MasteryScore;
  x: number;
  y: number;
  group: string;
  source: string;
  summary: string;
  root?: boolean;
}

interface MasteryEdge {
  source: string;
  target: string;
  strength: EdgeStrength;
}

interface MasteryGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  icon: ComponentType<{ className?: string }>;
}

interface MasteryGraphData {
  title: string;
  nodes: MasteryNode[];
  edges: MasteryEdge[];
  groups: MasteryGroup[];
}

interface CurriculumNode {
  id: string;
  label: string;
  aliases: string[];
  group: string;
  x: number;
  y: number;
  summary: string;
}

const DATA_STRUCTURE_GROUPS: MasteryGroup[] = [
  { id: "linear", label: "线性结构", x: 22, y: 7, icon: Layers3 },
  { id: "tree-graph", label: "树与图", x: 76, y: 7, icon: Network },
  { id: "search-sort", label: "查找与排序", x: 22, y: 58, icon: ListTree },
  { id: "algorithm", label: "算法与应用", x: 76, y: 58, icon: Binary },
];

const DATA_STRUCTURE_NODES: CurriculumNode[] = [
  { id: "array", label: "数组", aliases: ["数组", "线性表"], group: "linear", x: 16, y: 22, summary: "连续存储、随机访问与顺序操作的基础结构。" },
  { id: "linked-list", label: "链表", aliases: ["链表", "线性表"], group: "linear", x: 32, y: 31, summary: "通过指针组织离散节点，适合频繁插入与删除。" },
  { id: "stack", label: "栈", aliases: ["栈"], group: "linear", x: 17, y: 44, summary: "后进先出的受限线性结构，常用于递归与表达式求值。" },
  { id: "queue", label: "队列", aliases: ["队列"], group: "linear", x: 34, y: 48, summary: "先进先出的受限线性结构，是调度与遍历的重要基础。" },
  { id: "binary-tree", label: "二叉树", aliases: ["二叉树", "树"], group: "tree-graph", x: 66, y: 20, summary: "树结构的核心模型，连接递归、查找与层次关系。" },
  { id: "tree-traversal", label: "树的遍历", aliases: ["树的遍历", "二叉树的遍历", "遍历"], group: "tree-graph", x: 82, y: 29, summary: "前序、中序、后序与层序遍历决定树结构的处理顺序。" },
  { id: "graph-model", label: "图的表示", aliases: ["图论", "图的表示", "图"], group: "tree-graph", x: 66, y: 40, summary: "邻接矩阵与邻接表描述复杂对象之间的网络关系。" },
  { id: "graph-traversal", label: "BFS / DFS", aliases: ["广度优先", "深度优先", "bfs", "dfs", "图论"], group: "tree-graph", x: 83, y: 47, summary: "广度与深度优先搜索是图算法的通用访问框架。" },
  { id: "hash", label: "哈希表", aliases: ["哈希表", "哈希"], group: "search-sort", x: 16, y: 68, summary: "通过散列函数建立键到存储位置的快速映射。" },
  { id: "collision", label: "冲突处理", aliases: ["冲突处理", "哈希表与冲突处理"], group: "search-sort", x: 33, y: 75, summary: "开放定址与链地址法解决多个键映射到同一位置的问题。" },
  { id: "sorting", label: "排序算法", aliases: ["排序", "排序算法"], group: "search-sort", x: 17, y: 86, summary: "比较不同排序方法的稳定性、适用场景与复杂度。" },
  { id: "complexity", label: "复杂度分析", aliases: ["复杂度", "时间复杂度", "空间复杂度"], group: "search-sort", x: 35, y: 90, summary: "使用渐进记号衡量算法在规模增长时的时间与空间成本。" },
  { id: "recursion", label: "递归", aliases: ["递归"], group: "algorithm", x: 66, y: 67, summary: "通过自相似子问题构造解法，是树与分治算法的重要表达方式。" },
  { id: "mst", label: "最小生成树", aliases: ["最小生成树", "图论基础与最小生成树"], group: "algorithm", x: 83, y: 72, summary: "在连通图中以最低权值连接全部顶点。" },
  { id: "shortest-path", label: "最短路径", aliases: ["最短路径", "图论"], group: "algorithm", x: 67, y: 86, summary: "寻找网络中代价最小的路径，是图结构的典型综合应用。" },
  { id: "application", label: "综合应用", aliases: ["综合应用", "算法应用"], group: "algorithm", x: 84, y: 89, summary: "把数据结构选择、复杂度与算法设计组合到真实问题中。" },
];

const DATA_STRUCTURE_EDGES: MasteryEdge[] = [
  { source: "array", target: "linked-list", strength: "strong" },
  { source: "array", target: "stack", strength: "medium" },
  { source: "linked-list", target: "queue", strength: "strong" },
  { source: "stack", target: "recursion", strength: "medium" },
  { source: "binary-tree", target: "tree-traversal", strength: "strong" },
  { source: "recursion", target: "tree-traversal", strength: "medium" },
  { source: "graph-model", target: "graph-traversal", strength: "strong" },
  { source: "graph-traversal", target: "mst", strength: "medium" },
  { source: "mst", target: "shortest-path", strength: "medium" },
  { source: "hash", target: "collision", strength: "strong" },
  { source: "sorting", target: "complexity", strength: "strong" },
  { source: "complexity", target: "application", strength: "medium" },
  { source: "subject-root", target: "stack", strength: "weak" },
  { source: "subject-root", target: "tree-traversal", strength: "weak" },
  { source: "subject-root", target: "collision", strength: "weak" },
  { source: "subject-root", target: "application", strength: "weak" },
];

const GENERIC_GROUP_POSITIONS = [
  [{ x: 16, y: 22 }, { x: 32, y: 31 }, { x: 17, y: 44 }, { x: 34, y: 48 }],
  [{ x: 66, y: 20 }, { x: 82, y: 29 }, { x: 66, y: 40 }, { x: 83, y: 47 }],
  [{ x: 16, y: 68 }, { x: 33, y: 75 }, { x: 17, y: 86 }, { x: 35, y: 90 }],
  [{ x: 66, y: 67 }, { x: 83, y: 72 }, { x: 67, y: 86 }, { x: 84, y: 89 }],
];

const GENERIC_GROUPS = [
  { id: "foundation", label: "基础概念", x: 22, y: 7, icon: Layers3 },
  { id: "method", label: "核心方法", x: 76, y: 7, icon: Network },
  { id: "practice", label: "练习与辨析", x: 22, y: 58, icon: ListTree },
  { id: "transfer", label: "综合与迁移", x: 76, y: 58, icon: Binary },
] satisfies MasteryGroup[];

function scoreOf(value: unknown): number {
  const raw = typeof value === "object" && value ? (value as { score?: unknown }).score : value;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric)));
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[\s·：:、，,。()（）/\-_]/g, "");
}

function matchScore(label: string, aliases: string[], seed: Record<string, number>): MasteryScore {
  const candidates = [label, ...aliases].map(normalizeLabel);
  for (const [key, value] of Object.entries(seed)) {
    const normalizedKey = normalizeLabel(key);
    if (candidates.some((candidate) => normalizedKey.includes(candidate) || candidate.includes(normalizedKey))) {
      return scoreOf(value);
    }
  }
  return null;
}

function averageKnown(nodes: MasteryNode[], fallback = 0): number {
  const scores = nodes.flatMap((node) => node.score === null ? [] : [node.score]);
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : fallback;
}

function buildDataStructureGraph(assessment: AssessmentRecord): MasteryGraphData {
  const seed = assessment.analysis?.knowledge_seed ?? {};
  const subjectNodes = DATA_STRUCTURE_NODES.map<MasteryNode>((node) => ({
    id: node.id,
    label: node.label,
    score: matchScore(node.label, node.aliases, seed),
    x: node.x,
    y: node.y,
    group: node.group,
    source: "知识点诊断",
    summary: node.summary,
  }));
  const rootScore = averageKnown(subjectNodes, 0);
  return {
    title: assessment.subject,
    groups: DATA_STRUCTURE_GROUPS,
    nodes: [
      {
        id: "subject-root",
        label: assessment.subject,
        score: rootScore,
        x: 50,
        y: 52,
        group: assessment.subject,
        source: "学情摸底",
        summary: assessment.analysis?.summary ?? assessment.analysis?.narrative ?? "综合各知识点诊断结果形成的课程掌握概览。",
        root: true,
      },
      ...subjectNodes,
    ],
    edges: DATA_STRUCTURE_EDGES,
  };
}

function buildGenericGraph(assessment: AssessmentRecord | undefined, profile: ProfileDim[]): MasteryGraphData {
  const subject = assessment?.subject || "学习画像";
  const seed = assessment?.analysis?.knowledge_seed ?? {};
  const candidates = new Map<string, { score: MasteryScore; source: string }>();
  Object.entries(seed).forEach(([label, value]) => candidates.set(label, { score: scoreOf(value), source: "知识点诊断" }));
  const addUnscored = (labels: string[] | undefined, source: string) => {
    labels?.forEach((label) => {
      const normalized = label.trim();
      if (normalized && !candidates.has(normalized)) candidates.set(normalized, { score: null, source });
    });
  };
  addUnscored(assessment?.analysis?.strengths, "优势分析");
  addUnscored(assessment?.analysis?.gaps, "薄弱点分析");
  addUnscored(assessment?.analysis?.recommended_focus, "推荐重点");
  addUnscored(assessment?.analysis?.suggested_modules, "课程结构");

  if (!candidates.size) {
    profile.forEach((dimension) => candidates.set(dimension.label, { score: scoreOf(dimension.value), source: "学习画像" }));
  }

  const graphNodes = [...candidates.entries()].slice(0, 16).map<MasteryNode>(([label, data], index) => {
    const groupIndex = index % 4;
    const positionIndex = Math.floor(index / 4);
    const position = GENERIC_GROUP_POSITIONS[groupIndex][positionIndex] ?? GENERIC_GROUP_POSITIONS[groupIndex][3];
    return {
      id: `node-${index}`,
      label,
      score: data.score,
      x: position.x,
      y: position.y,
      group: GENERIC_GROUPS[groupIndex].id,
      source: data.source,
      summary: data.score === null ? "已纳入课程结构，完成相关诊断后会补充掌握度。" : `当前掌握度来自${data.source}，会随练习与复盘持续更新。`,
    };
  });
  const rootScore = averageKnown(graphNodes, profile.length ? averageKnown(profile.map((item, index) => ({ id: item.key, label: item.label, score: scoreOf(item.value), x: index, y: 0, group: "", source: "", summary: "" })), 0) : 0);
  const edges: MasteryEdge[] = [];
  GENERIC_GROUPS.forEach((group) => {
    const groupNodes = graphNodes.filter((node) => node.group === group.id);
    if (groupNodes[0]) edges.push({ source: "subject-root", target: groupNodes[0].id, strength: "weak" });
    groupNodes.slice(1).forEach((node, index) => edges.push({ source: groupNodes[index].id, target: node.id, strength: "medium" }));
  });
  return {
    title: subject,
    groups: GENERIC_GROUPS,
    nodes: [
      {
        id: "subject-root",
        label: subject,
        score: rootScore,
        x: 50,
        y: 52,
        group: subject,
        source: assessment ? "学情摸底" : "学习画像",
        summary: assessment?.analysis?.summary ?? assessment?.analysis?.narrative ?? "综合诊断、练习和学习行为形成的掌握概览。",
        root: true,
      },
      ...graphNodes,
    ],
    edges,
  };
}

function buildGraph(assessment: AssessmentRecord | undefined, profile: ProfileDim[]): MasteryGraphData {
  if (assessment && /数据结构|算法与数据结构/i.test(assessment.subject)) return buildDataStructureGraph(assessment);
  return buildGenericGraph(assessment, profile);
}

function nodeStatus(score: MasteryScore): "mastered" | "developing" | "weak" | "unseen" {
  if (score === null) return "unseen";
  if (score >= 80) return "mastered";
  if (score >= 40) return "developing";
  return "weak";
}

function edgePath(from: MasteryNode, to: MasteryNode): string {
  const dx = to.x - from.x;
  return `M ${from.x} ${from.y} C ${from.x + dx * .42} ${from.y}, ${to.x - dx * .42} ${to.y}, ${to.x} ${to.y}`;
}

function scoreLabel(score: MasteryScore): string {
  return score === null ? "待学" : `${score}%`;
}

export function KnowledgeMasteryGraph() {
  const orchestrator = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    mode: state.mode,
    profile: state.profile,
    profileUpdatedAt: state.profileUpdatedAt,
    profileSources: state.profileSources,
  }));
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [range, setRange] = useState("30");
  const [activeAssessmentId, setActiveAssessmentId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [timeAnchor] = useState(() => Date.now());

  useEffect(() => {
    if (!orchestrator.hydrated || orchestrator.mode === "checking") return;
    void listAssessments(orchestrator.mode).then(setAssessments).catch(() => setAssessments([]));
  }, [orchestrator.hydrated, orchestrator.mode]);

  const rangedAssessments = useMemo(() => {
    if (range === "all") return assessments;
    const cutoff = timeAnchor - Number(range) * 24 * 60 * 60 * 1000;
    return assessments.filter((assessment) => {
      const time = new Date(assessment.created_at).getTime();
      return !Number.isFinite(time) || time >= cutoff;
    });
  }, [assessments, range, timeAnchor]);
  const activeAssessment = rangedAssessments.find((item) => item.id === activeAssessmentId) ?? rangedAssessments[0];
  const graph = useMemo(() => buildGraph(activeAssessment, orchestrator.profile), [activeAssessment, orchestrator.profile]);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = nodeMap.get(selectedId) ?? graph.nodes[0];
  const normalizedQuery = normalizeLabel(query);
  const weakest = graph.nodes
    .filter((node) => !node.root && node.score !== null)
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0];
  const knownNodes = graph.nodes.filter((node) => !node.root && node.score !== null);
  const overall = averageKnown(knownNodes, graph.nodes[0]?.score ?? 0);
  const confidence = Math.min(96, 62 + knownNodes.length * 4 + Math.min(assessments.length, 3) * 3);
  const connectedIds = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>([selected.id]);
    graph.edges.forEach((edge) => {
      if (edge.source === selected.id) ids.add(edge.target);
      if (edge.target === selected.id) ids.add(edge.source);
    });
    return ids;
  }, [graph.edges, selected]);
  const related = graph.nodes.filter((node) => node.id !== selected?.id && connectedIds.has(node.id)).slice(0, 4);
  const updated = activeAssessment?.created_at
    ? new Date(activeAssessment.created_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : orchestrator.profileUpdatedAt
      ? new Date(orchestrator.profileUpdatedAt).toLocaleString("zh-CN")
      : "尚无更新记录";
  const evidence = [
    activeAssessment ? `摸底记录 ${assessments.length} 次` : "学习画像",
    ...orchestrator.profileSources,
    knownNodes.length ? `已评估 ${knownNodes.length} 个知识点` : "等待知识点证据",
  ].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 4);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <TeacherOpenButton
            context={{
              module: "profile",
              title: "知识掌握图谱",
              detail: selected
                ? `请结合${graph.title}图谱中“${selected.label}”的掌握情况进行讲解。`
                : `请结合${graph.title}图谱中的掌握情况进行讲解。`,
            }}
            className={styles.back}
          >
            <MessageCircle className="size-3.5" />询问智能教师
          </TeacherOpenButton>
          <div className={styles.titleRow}><h1>学习画像 · 知识掌握图谱</h1><Info className="size-4" aria-label="掌握度会随学习证据持续更新" /></div>
          <p>把诊断、练习与复盘证据连接成一张可追踪的知识网络</p>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.search}>
            <Search className="size-4" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索知识点、题目、概念…" />
          </label>
          <label className={styles.selectWrap}>
            <CalendarDays className="size-4" aria-hidden />
            <select value={range} onChange={(event) => setRange(event.target.value)} aria-label="选择图谱数据范围">
              <option value="30">近 30 天</option>
              <option value="90">近 90 天</option>
              <option value="all">全部记录</option>
            </select>
          </label>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.canvas} aria-label={`${graph.title}知识掌握网络`}>
          <div className={styles.canvasToolbar}>
            <label className={styles.subjectChip}>
              <BookOpen className="size-3.5" aria-hidden />
              {rangedAssessments.length > 1 ? (
                <select value={activeAssessment?.id ?? ""} onChange={(event) => { setActiveAssessmentId(event.target.value); setSelectedId(""); }} aria-label="切换学科图谱">
                  {rangedAssessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.subject}</option>)}
                </select>
              ) : graph.title}
            </label>
            <span className={styles.toolbarHint}><CircleHelp className="size-3.5" />点击节点查看 AI 判断与关联知识</span>
          </div>

          <div className={styles.zoomControls} aria-label="图谱缩放">
            <button type="button" onClick={() => setZoom((value) => Math.min(1.18, value + .08))} aria-label="放大图谱"><ZoomIn className="size-3.5" /></button>
            <button type="button" onClick={() => setZoom(1)} aria-label="恢复图谱大小"><RotateCcw className="size-3.5" /></button>
            <button type="button" onClick={() => setZoom((value) => Math.max(.78, value - .08))} aria-label="缩小图谱"><ZoomOut className="size-3.5" /></button>
          </div>

          <div className={styles.graphStage} style={{ transform: `scale(${zoom})` }}>
            {graph.groups.map((group) => {
              const Icon = group.icon;
              return <div key={group.id} className={styles.groupLabel} style={{ left: `${group.x}%`, top: `${group.y}%` }}><Icon className="size-4" /><span>{group.label}</span></div>;
            })}
            <svg className={styles.edges} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {graph.edges.map((edge) => {
                const from = nodeMap.get(edge.source);
                const to = nodeMap.get(edge.target);
                if (!from || !to) return null;
                const active = selected && (edge.source === selected.id || edge.target === selected.id);
                return (
                  <path
                    key={`${edge.source}-${edge.target}`}
                    d={edgePath(from, to)}
                    className={cn(styles.edge, styles[`edge${edge.strength[0].toUpperCase()}${edge.strength.slice(1)}` as keyof typeof styles], active && styles.edgeActive)}
                  />
                );
              })}
            </svg>
            {graph.nodes.map((node) => {
              const status = nodeStatus(node.score);
              const queryMatch = !normalizedQuery || normalizeLabel(node.label).includes(normalizedQuery);
              const selectedNode = selected?.id === node.id;
              const weakFlag = weakest?.id === node.id;
              return (
                <button
                  type="button"
                  key={node.id}
                  className={cn(
                    styles.node,
                    node.root && styles.nodeRoot,
                    status === "mastered" && styles.nodeMastered,
                    status === "developing" && styles.nodeDeveloping,
                    status === "weak" && styles.nodeWeak,
                    status === "unseen" && styles.nodeUnseen,
                    selectedNode && styles.nodeSelected,
                    !queryMatch && styles.nodeDimmed,
                  )}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onClick={() => setSelectedId(node.id)}
                  aria-pressed={selectedNode}
                  aria-label={`${node.label}，${node.score === null ? "尚未评估" : `掌握度 ${node.score}%`}`}
                >
                  {weakFlag && <span className={styles.weakFlag}>当前薄弱点</span>}
                  <span className={styles.nodeInner}><b>{node.label}</b><small>{scoreLabel(node.score)}</small></span>
                </button>
              );
            })}
          </div>

          <div className={styles.legend} aria-label="图谱图例">
            <span className={styles.legendTitle}>掌握程度</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendMastered)} />优秀 80%+</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendDeveloping)} />中等 40–79%</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendWeak)} />薄弱 &lt;40%</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendUnseen)} />待学习</span>
            <span className={styles.legendLines}><span className={styles.lineLegend}><i className={styles.lineSample} />强关联</span><span className={styles.lineLegend}><i className={cn(styles.lineSample, styles.lineSampleMedium)} />中关联</span><span className={styles.lineLegend}><i className={cn(styles.lineSample, styles.lineSampleWeak)} />弱关联</span></span>
          </div>
        </section>

        <aside className={styles.inspector} aria-label="AI 掌握度判断">
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorTitle}><Sparkles className="size-4" />AI 判断</div>
            <button type="button" className={styles.infoButton} title="判断依据来自真实学习记录"><CircleHelp className="size-3.5" /></button>
          </div>
          <p className={styles.updated}>数据更新时间：{updated}</p>

          <div className={styles.metrics}>
            <div className={styles.metric}><span>整体掌握度</span><strong>{overall}<em>%</em></strong><small>{overall >= 80 ? "优秀" : overall >= 40 ? "中等" : "需加强"}</small></div>
            <div className={styles.metric}><span>判断置信度</span><strong>{confidence}<em>%</em></strong><small>{knownNodes.length >= 4 ? "较高" : "持续积累中"}</small></div>
          </div>

          <h2 className={styles.sectionTitle}>判断依据</h2>
          <div className={styles.evidence}>{evidence.map((item) => <span key={item}><CheckCircle2 className="size-3" />{item}</span>)}</div>

          <h2 className={styles.sectionTitle}>{selected?.label ?? "节点说明"}</h2>
          <p className={styles.explanation}>
            {selected?.score === null
              ? `“${selected.label}”已出现在课程知识结构中，但目前还没有足够的答题或复盘证据。完成一次对应练习后，AI 会补充掌握度和判断依据。`
              : `“${selected?.label}”当前掌握度为 ${selected?.score}%，依据为${selected?.source}。${selected?.summary}`}
          </p>
          {related.length > 0 && <div className={styles.evidence}>{related.map((node) => <span key={node.id}><GitBranch className="size-3" />关联：{node.label}</span>)}</div>}

          <h2 className={styles.sectionTitle}>下一步建议</h2>
          <div className={styles.suggestionCard}>
            <div className={styles.suggestionHeader}><Target className="size-4" /><span>攻克薄弱点 · {weakest?.label ?? selected?.label ?? "等待诊断"}</span></div>
            <p>{weakest ? `当前掌握度 ${weakest.score}%，建议先补概念，再完成定向练习并复盘错因。` : "先完成一次知识点诊断，系统会据此安排学习顺序。"}</p>
            <div className={styles.taskList}>
              <div className={styles.task}><CheckCircle2 className="size-3.5" /><span>概念讲解与例题</span><small>约 8 分钟</small></div>
              <div className={styles.task}><CheckCircle2 className="size-3.5" /><span>针对性练习</span><small>10 道</small></div>
              <div className={styles.task}><CheckCircle2 className="size-3.5" /><span>错题复盘与关联迁移</span><small>1 组</small></div>
            </div>
            <Link href="/desktop/path" className={styles.primaryAction}>查看学习计划 <ChevronRight className="size-3.5" /></Link>
          </div>
          <div className={styles.tipCard}><Lightbulb className="size-4" /><p><b>小贴士</b><span>知识点之间的虚线表示间接关联；点击节点可查看上下游知识与判断依据。</span></p></div>
        </aside>
      </main>
    </div>
  );
}
