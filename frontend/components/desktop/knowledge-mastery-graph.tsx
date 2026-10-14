"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  Info,
  MessageCircle,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { TeacherOpenButton } from "@/components/desktop/teacher-window-provider";
import { listAssessments, listPapers, getPaperDetail, type PaperDetail, type AssessmentRecord } from "@/lib/library";
import { buildKnowledgeMastery, knowledgeAdvice, normalizeKnowledgeLabel, type KnowledgeNode as MasteryNode } from "@/lib/knowledge-mastery";
import { LearningProfileRadar } from "./learning-profile-radar";
import { LearningDataCard } from "@/components/learning-data-card";
import { cn } from "@/lib/utils";
import { moveGraphNode } from "@/lib/graph-node-drag";
import { createMasteryForceLayout } from "@/lib/mastery-force-layout";

import styles from "./knowledge-graph.module.css";

function edgePath(from: MasteryNode, to: MasteryNode): string {
  const dx = to.x - from.x;
  return `M ${from.x} ${from.y} C ${from.x + dx * .42} ${from.y}, ${to.x - dx * .42} ${to.y}, ${to.x} ${to.y}`;
}

function scoreLabel(score: number | null): string {
  return score === null ? "待评估" : `${score}%`;
}

export function KnowledgeMasteryGraph({ compact = false }: { compact?: boolean }) {
  const orchestrator = useOrchestratorContext((state) => ({
    hydrated: state.hydrated,
    mode: state.mode,
    profile: state.profile,
    profileUpdatedAt: state.profileUpdatedAt,
    profileSources: state.profileSources,
    subjectPaths: state.subjectPaths,
    trainingEvidence: state.trainingEvidence,
    trainingEvidenceError: state.trainingEvidenceError,
    learningData: state.learningData,
  }));
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [papers, setPapers] = useState<PaperDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [range, setRange] = useState("all");
  const [activeSubjectId, setActiveSubjectId] = useState("");
  const [zoom, setZoom] = useState(1);
  const [timeAnchor] = useState(() => Date.now());
  const stage = useRef<HTMLDivElement>(null);
  const physics = useRef<ReturnType<typeof createMasteryForceLayout> | null>(null);
  const drag = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; x: number; y: number; width: number; height: number; radiusX: number; radiusY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState("");
  const [layout, setLayout] = useState<{ key: string; positions: Record<string, { x: number; y: number }> }>({ key: "", positions: {} });

  useEffect(() => {
    if (!orchestrator.hydrated || orchestrator.mode === "checking") return;
    let active = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([listAssessments(orchestrator.mode), listPapers(orchestrator.mode)]).then(async ([nextAssessments, summaries]) => {
      if (!active) return;
      setAssessments(nextAssessments);
      const details: PaperDetail[] = [];
      let missing = 0;
      // Keep database requests bounded while reading the learner's full archive.
      for (let start = 0; start < summaries.length && active; start += 4) {
        const batch = await Promise.all(summaries.slice(start, start + 4).map((paper) => getPaperDetail(orchestrator.mode, paper.id)));
        batch.forEach((paper) => { if (paper) details.push(paper); else missing += 1; });
      }
      if (active) { setPapers(details); if (missing) setLoadError("部分试卷记录暂未加载，可稍后重新打开图谱。"); }
    }).catch(() => { if (active) setLoadError("测评记录暂未加载，当前先展示课程知识点。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [orchestrator.hydrated, orchestrator.mode]);

  const baseGraph = useMemo(() => buildKnowledgeMastery({
    paths: orchestrator.subjectPaths, assessments, papers, subject: activeSubjectId,
    training: orchestrator.trainingEvidence,
    published: orchestrator.mode === "live" ? orchestrator.learningData?.snapshot.knowledge ?? [] : undefined,
    rangeDays: range === "all" ? undefined : Number(range), now: timeAnchor,
  }), [orchestrator.subjectPaths, orchestrator.trainingEvidence, orchestrator.learningData, orchestrator.mode, assessments, papers, activeSubjectId, range, timeAnchor]);
  const graphKey = JSON.stringify([baseGraph.course?.id, baseGraph.nodes.map((node) => node.id)]);
  useEffect(() => () => {
    physics.current?.stop();
    physics.current = null;
    drag.current = null;
  }, [graphKey, compact]);
  const graph = useMemo(() => ({ ...baseGraph, nodes: baseGraph.nodes.map((node) => ({ ...node, ...(layout.key === graphKey ? layout.positions[node.id] : undefined) })) }), [baseGraph, graphKey, layout]);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selected = nodeMap.get(selectedId) ?? graph.nodes[0];
  const normalizedQuery = normalizeKnowledgeLabel(query);
  const knownNodes = graph.nodes.filter((node) => node.score !== null && !node.provisional);
  const weakest = [...knownNodes].filter((node) => node.score! < 80).sort((a, b) => a.score! - b.score!)[0];
  const overall = baseGraph.overall;
  const related = graph.edges.flatMap((edge) => edge.source === selected?.id ? [nodeMap.get(edge.target)] : edge.target === selected?.id ? [nodeMap.get(edge.source)] : [])
    .filter((node): node is MasteryNode => Boolean(node)).slice(0, 4);
  const advice = knowledgeAdvice(selected, graph.course?.currentStage);
  const teacherContext = {
    module: "profile", title: `${selected?.label || "知识掌握图谱"} · 学习建议`,
    detail: `课程：${graph.title}。当前阶段：${graph.course?.currentStage || "未标记"}。\n知识点：${selected?.label || "未选择"}。掌握度：${selected?.score ?? "待评估"}。来源：${selected?.source || "尚无记录"}。\n最近批阅：${selected?.feedback || "无"}。学习要求：${selected?.summary || "无"}。\n请依据这些真实记录判断当前困难，并给出本知识点的下一步学习建议；不要编造成绩。`,
  };

  function startDrag(event: PointerEvent<HTMLButtonElement>, node: MasteryNode) {
    if (event.button !== 0 || !event.isPrimary || drag.current) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const bubble = event.currentTarget.getBoundingClientRect();
    const width = stage.current!.clientWidth;
    const height = stage.current!.clientHeight;
    if (!physics.current || physics.current.width !== width || physics.current.height !== height) {
      physics.current?.stop();
      physics.current = createMasteryForceLayout(graph.nodes, graph.edges, width, height, compact,
        (positions) => setLayout({ key: graphKey, positions }));
    }
    suppressClick.current = false;
    drag.current = { id: node.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: node.x, y: node.y, width: bounds.width, height: bounds.height, radiusX: bubble.width / 2, radiusY: bubble.height / 2, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.clientX;
    const dy = event.clientY - current.clientY;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    current.moved = true;
    setDraggingId(current.id);
    const position = moveGraphNode(current, dx, dy);
    physics.current?.pin(current.id, position);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    if (drag.current.moved) physics.current?.release(drag.current.id);
    drag.current = null;
    setDraggingId("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className={cn(styles.page, compact && styles.compact)}>
      {!compact && <header className={styles.header}>
        <div className={styles.titleBlock}>
          <TeacherOpenButton
            context={teacherContext}
            className={styles.back}
          >
            <MessageCircle className="size-3.5" />询问智能教师
          </TeacherOpenButton>
          <div className={styles.titleRow}><h1>个人知识掌握图谱</h1><Info className="size-4" aria-label="掌握度会随学习证据持续更新" /></div>
          <p>以知识点为中心，查看掌握程度、学习关联与下一步建议</p>
        </div>
        <div className={styles.headerActions}>
          {graph.courses.length > 1 && <label className={styles.selectWrap}><select aria-label="选择图谱课程" value={graph.course?.id ?? ""} onChange={(event) => { setActiveSubjectId(event.target.value); setSelectedId(""); }}>{graph.courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>}
          <label className={styles.search}>
            <Search className="size-4" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索知识点" placeholder="搜索知识点…" />
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
      </header>}

      <div className={styles.content}>
        <section className={styles.canvas} aria-label={`${graph.title}知识掌握网络`}>
          <div className={styles.canvasToolbar}>
            <span className={styles.networkSummary}>{graph.title} · {graph.nodes.length} 个知识点</span>
            <span className={styles.toolbarHint}>拖动气泡，关联节点跟随移动</span>
          </div>

          <div className={styles.zoomControls} aria-label="图谱缩放">
            <button type="button" onClick={() => setZoom((value) => Math.min(1.18, value + .08))} aria-label="放大图谱"><ZoomIn className="size-3.5" /></button>
            <button type="button" onClick={() => { physics.current?.stop(); physics.current = null; setZoom(1); setLayout({ key: graphKey, positions: {} }); }} aria-label="恢复图谱布局"><RotateCcw className="size-3.5" /></button>
            <button type="button" onClick={() => setZoom((value) => Math.max(.78, value - .08))} aria-label="缩小图谱"><ZoomOut className="size-3.5" /></button>
          </div>

          <div ref={stage} className={styles.graphStage} style={{ transform: `scale(${zoom})` }}>
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
              const status = node.score === null ? "unseen" : node.score >= 80 ? "mastered" : node.score >= 40 ? "developing" : "weak";
              const queryMatch = !normalizedQuery || normalizeKnowledgeLabel(node.label).includes(normalizedQuery);
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
                    draggingId === node.id && styles.nodeDragging,
                  )}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onPointerDown={(event) => startDrag(event, node)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={endDrag}
                  onClick={(event) => {
                    if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
                    setSelectedId(node.id);
                  }}
                  aria-pressed={selectedNode}
                  aria-label={`${node.label}，${node.provisional ? `自评参考 ${node.score}%` : node.score === null ? "尚未评估" : `掌握度 ${node.score}%`}`}
                >
                  {weakFlag && <span className={styles.weakFlag}>当前薄弱点</span>}
                  <span className={styles.nodeInner}><b>{node.label}</b><small>{node.provisional ? "自评 " : ""}{scoreLabel(node.score)}</small></span>
                </button>
              );
            })}
          </div>

          {!graph.nodes.length && <div className={styles.graphEmpty}><h2>{loading ? "正在整理知识点…" : "还没有知识点记录"}</h2><p>建立学习路径或完成一次知识点测评后，这里会展示真实的掌握网络。</p><Link href="/desktop/path/">前往学习路径</Link></div>}
          {normalizedQuery && !graph.nodes.some((node) => normalizeKnowledgeLabel(node.label).includes(normalizedQuery)) && <p className={styles.searchEmpty} role="status">当前课程没有匹配的知识点</p>}
          <div className={styles.legend} aria-label="图谱图例">
            <span className={styles.legendTitle}>掌握程度</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendMastered)} />优秀 80%+</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendDeveloping)} />中等 40–79%</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendWeak)} />薄弱 &lt;40%</span>
            <span className={styles.legendItem}><i className={cn(styles.legendDot, styles.legendUnseen)} />待评估</span>
            <span className={styles.legendLines}><span className={styles.lineLegend}><i className={styles.lineSample} />同节知识</span><span className={styles.lineLegend}><i className={cn(styles.lineSample, styles.lineSampleMedium)} />学习顺序</span><span className={styles.lineLegend}><i className={cn(styles.lineSample, styles.lineSampleWeak)} />共同测评</span></span>
          </div>
        </section>

        {!compact && <aside className={styles.inspector} aria-label="学习画像与教师判断">
          <section className={styles.inspectorSection} aria-labelledby="mastery-overview-title">
            <div className={styles.inspectorHeader}><h2 id="mastery-overview-title" className={styles.inspectorTitle}>目前掌握度</h2><span className={styles.sectionNote}>知识点评估</span></div>
            <div className={styles.metrics}>
              <div className={styles.metric}><span>课程知识点均值</span><strong>{overall ?? "—"}{overall !== null && <em>%</em>}</strong><small>已评估 {knownNodes.length} / {graph.nodes.length} 个</small></div>
              <div className={styles.metric}><span>{selected?.label || "所选知识点"}</span><strong>{selected?.score ?? "—"}{selected?.score != null && <em>%</em>}</strong><small>{selected?.provisional ? "仅自评参考" : selected?.score == null ? "待评估" : selected.score >= 80 ? "已基本掌握" : selected.score >= 40 ? "需要巩固" : "优先补强"}</small></div>
            </div>
            <p className={styles.updated}>{loading ? "正在同步测评记录…" : "均值仅统计已整理的客观测评，自评与待评估项不计入。"}</p>
            {loadError && <p className={styles.dataNotice} role="status">{loadError}</p>}
            {orchestrator.trainingEvidenceError && <p className={styles.dataNotice} role="status">{orchestrator.trainingEvidenceError}</p>}
          </section>

          <section className={styles.inspectorSection} aria-labelledby="learning-profile-title">
            <div className={styles.inspectorHeader}><h2 id="learning-profile-title" className={styles.inspectorTitle}>学习画像</h2><span className={styles.sectionNote}>六维学习特征</span></div>
            <LearningProfileRadar profile={orchestrator.profile} hasEvidence={Boolean(orchestrator.profileUpdatedAt || orchestrator.profileSources.length)} />
            <p className={styles.profileCaption}>反映学习特征，用于调整教学方式。</p>
          </section>

          <section className={styles.inspectorSection} aria-labelledby="teacher-judgement-title">
            <h2 id="teacher-judgement-title" className={styles.inspectorTitle}>教师判断</h2>
            <p className={styles.selectedTopic}>{selected?.label || "等待知识点记录"}</p>
            <p className={styles.explanation}>{advice.judgement}</p>
            <div className={styles.teacherFeedback}><b>学习状况分析</b><p>{advice.review}</p></div>
            {selected?.score != null && <p className={styles.updated}>依据：{selected.source} · {new Date(selected.updatedAt).toLocaleDateString("zh-CN")} · {selected.evidenceCount} 项测评证据</p>}
            {related.length > 0 && <div className={styles.relatedTopics}><span>关联知识</span>{related.map((node) => <button key={node.id} type="button" onClick={() => setSelectedId(node.id)}>{node.label}</button>)}</div>}
          </section>

          <section className={styles.inspectorSection} aria-labelledby="next-advice-title">
            <div className={styles.inspectorHeader}><h2 id="next-advice-title" className={styles.inspectorTitle}>现阶段学习建议</h2></div>
            {graph.course?.currentStage && <p className={styles.stageNote}>当前阶段 · {graph.course.currentStage}</p>}
            <ol className={styles.adviceSteps}>{advice.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <TeacherOpenButton context={teacherContext} className={styles.primaryAction}>请教师进一步指导<ChevronRight className="size-3.5" /></TeacherOpenButton>
            <Link href="/desktop/path/" className={styles.pathAction}>回到学习路径<ChevronRight className="size-3.5" /></Link>
          </section>
          <LearningDataCard />
        </aside>}
      </div>
    </div>
  );
}
