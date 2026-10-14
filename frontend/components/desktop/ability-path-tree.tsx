"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { BookOpen, Check, ChevronDown, ChevronRight, Clock3, GitBranch, List, LocateFixed, LockKeyhole, Minus, Play, Plus, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { ABILITY_KIND_LABEL, ABILITY_STATUS_LABEL, abilityStudyHref, buildAbilityTodayQueue, buildAbilityTree, type AbilityCourse, type AbilityEvidence, type AbilityNode } from "@/lib/ability-path";
import { buildChapterKnowledgeGraph, chapterStatus, type KnowledgePathNode } from "@/lib/knowledge-path";
import { getStudentId } from "@/lib/student-identity";
import { knowledgePathPanForZoomAnchor } from "@/lib/knowledge-path-viewport";
import { cn } from "@/lib/utils";
import styles from "./ability-path.module.css";

export function AbilityBadge({ node, size = 116 }: { node: AbilityNode; size?: number }) {
  const asset = node.kind === "milestone" || /验证|验收|检测|复盘|综合/.test(node.step.title)
    ? "milestone" : /实现|代码|编程|栈|队列|算法|对象|开发/.test(node.step.title) ? "cube" : "book";
  return <Image className={styles.medal} src={`/brand/path/focus-${asset}-v1.png`} alt="" width={size} height={size} draggable={false} />;
}

export function AbilityStatusIcon({ status }: { status: AbilityNode["status"] }) {
  const Icon = status === "passed" ? Check : status === "current" ? Play : status === "locked" ? LockKeyhole : BookOpen;
  return <Icon size={12} aria-hidden />;
}

type SavedView = { x: number; y: number; zoom: number; selected?: string; drawer: boolean; course: string; chapters?: string[] };

export default function AbilityPathTree({ courses, completedKeys, evidence, activeCourseId, onCourseChange, reviewCount = 0, onManageGoals }: {
  courses: AbilityCourse[];
  completedKeys: string[];
  evidence: Record<string, AbilityEvidence>;
  activeCourseId: string;
  onCourseChange: (id: string) => void;
  reviewCount?: number;
  onManageGoals: () => void;
}) {
  const visibleCourses = useMemo(() => activeCourseId ? courses.filter((course) => course.id === activeCourseId) : courses, [courses, activeCourseId]);
  const baseTree = useMemo(() => buildAbilityTree(visibleCourses, completedKeys, evidence), [visibleCourses, completedKeys, evidence]);
  const [expandedChapters, setExpandedChapters] = useState<string[] | null>(null);
  const tree = useMemo(() => buildChapterKnowledgeGraph(baseTree, expandedChapters), [baseTree, expandedChapters]);
  const [pendingFocus, setPendingFocus] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 0.9 });
  const [panning, setPanning] = useState(false);
  const [listMode, setListMode] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const viewRef = useRef(view);
  const frame = useRef<number | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const current = tree.nodes.find((node) => node.id === tree.currentId);
  const selected = tree.nodes.find((node) => node.id === selectedId);
  const dailyMinutes = visibleCourses.reduce((sum, course) => sum + (course.paused ? 0 : course.dailyMinutes || 60), 0) || 60;
  const queue = useMemo(() => buildAbilityTodayQueue(baseTree, dailyMinutes), [baseTree, dailyMinutes]);
  const signature = tree.nodes.map((node) => node.id).join("|");
  const persistenceKey = useRef("");

  const updateView = useCallback((next: typeof view) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const focusNode = useCallback((node: KnowledgePathNode, preferredZoom = 0.94) => {
    const element = viewport.current;
    if (!element) return;
    const chapter = tree.chapters.find((item) => item.id === node.chapterId);
    if (!chapter) return;
    const fitZoom = (element.clientWidth - 32) / tree.width;
    const zoom = Math.max(.78, Math.min(preferredZoom, fitZoom));
    updateView({
      zoom,
      x: fitZoom < .78 ? element.clientWidth / 2 - (node.x + 96) * zoom : (element.clientWidth - tree.width * zoom) / 2,
      y: 18 - (node.y > chapter.y + 356 ? node.y - 35 : chapter.y) * zoom,
    });
    setModulesOpen(false);
  }, [tree.chapters, tree.width, updateView]);

  useEffect(() => {
    if (!pendingFocus) return;
    const node = tree.nodes.find((item) => item.id === pendingFocus);
    if (!node?.visible) return;
    const id = requestAnimationFrame(() => { focusNode(node); setPendingFocus(undefined); });
    return () => cancelAnimationFrame(id);
  }, [pendingFocus, tree.nodes, focusNode, drawerOpen]);

  const fitTree = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const zoom = Math.max(0.32, Math.min(1, (element.clientWidth - 60) / tree.width, (element.clientHeight - 90) / tree.height));
    updateView({ zoom, x: (element.clientWidth - tree.width * zoom) / 2, y: 16 });
    setModulesOpen(false);
  }, [tree.height, tree.width, updateView]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const key = `xueshu:ability-view:v2:${getStudentId()}:${activeCourseId || "all"}`;
    persistenceKey.current = key;
    let saved: SavedView | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { /* A fresh view is safe when storage is unavailable. */ }
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= 0.32 && saved.zoom <= 1.6) {
      setExpandedChapters(saved.chapters?.filter((id) => tree.chapters.some((chapter) => chapter.id === id)) || null);
      updateView({ x: saved.x, y: saved.y, zoom: saved.zoom });
      setSelectedId(tree.nodes.some((node) => node.id === saved!.selected) ? saved.selected : undefined);
      setDrawerOpen(Boolean(saved.drawer && tree.nodes.some((node) => node.id === saved!.selected)));
    } else {
      setExpandedChapters(null);
      const target = tree.nodes.find((node) => node.id === tree.currentId) || tree.nodes[0];
      if (target) setPendingFocus(target.id);
      setSelectedId(undefined); setDrawerOpen(false);
    }
    setListMode(window.matchMedia("(max-width: 760px)").matches);
    setReady(true);
    // Progress updates keep the learner's place. Reinitialize only if the node set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, activeCourseId]);

  useEffect(() => {
    if (!ready || !persistenceKey.current) return;
    try {
      sessionStorage.setItem(persistenceKey.current, JSON.stringify({ ...view, selected: selectedId, drawer: drawerOpen, course: activeCourseId, chapters: tree.chapters.filter((chapter) => chapter.expanded).map((chapter) => chapter.id) }));
    } catch { /* Layout remains usable without storage. */ }
  }, [view, selectedId, drawerOpen, activeCourseId, ready, tree.chapters]);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const zoomAt = useCallback((next: number, clientX?: number, clientY?: number) => {
    const element = viewport.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const zoom = Math.max(0.32, Math.min(1.6, next));
    const pan = knowledgePathPanForZoomAnchor({ panX: viewRef.current.x, panY: viewRef.current.y,
      anchorX: clientX === undefined ? rect.width / 2 : clientX - rect.left,
      anchorY: clientY === undefined ? rect.height / 2 : clientY - rect.top,
      currentZoom: viewRef.current.zoom, nextZoom: zoom });
    updateView({ ...pan, zoom });
  }, [updateView]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (listMode || (event.target as HTMLElement).closest("button, a, [data-no-pan]")) return;
      event.preventDefault();
      zoomAt(viewRef.current.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoomAt, listMode]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    start.moved = true; setPanning(true);
    viewRef.current = { ...viewRef.current, x: start.panX + dx, y: start.panY + dy };
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setView({ ...viewRef.current }); });
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pointer.current = null; setPanning(false);
  };
  const revealChapter = (chapterId: string) => {
    setExpandedChapters((previous) => [...new Set([...(previous ?? tree.chapters.filter((chapter) => chapter.expanded).map((chapter) => chapter.id)), chapterId])]);
  };
  const toggleChapter = (chapterId: string) => {
    setExpandedChapters((previous) => {
      const ids = previous ?? tree.chapters.filter((chapter) => chapter.expanded).map((chapter) => chapter.id);
      return ids.includes(chapterId) ? ids.filter((id) => id !== chapterId) : [...ids, chapterId];
    });
  };
  const openNode = (node: KnowledgePathNode) => {
    revealChapter(node.chapterId);
    setSelectedId(node.id); setDrawerOpen(true);
    setPendingFocus(node.id);
    requestAnimationFrame(() => {
      drawer.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-ability-id="${CSS.escape(selectedId || "")}"]`)?.focus({ preventScroll: true }));
  };
  const title = visibleCourses.length === 1 ? visibleCourses[0].title : "我的能力路径";
  const selectedParents = selected ? tree.semanticEdges.filter((edge) => edge.kind === "prerequisite" && edge.to === selected.id).map((edge) => ({ edge, node: tree.nodes.find((node) => node.id === edge.from)! })) : [];
  const selectedChildren = selected ? tree.semanticEdges.filter((edge) => edge.kind === "prerequisite" && edge.from === selected.id).map((edge) => tree.nodes.find((node) => node.id === edge.to)!) : [];
  const selectedRelations = selected ? tree.semanticEdges.filter((edge) => edge.kind === "related" && (edge.from === selected.id || edge.to === selected.id)).map((edge) => ({ edge, node: tree.nodes.find((node) => node.id === (edge.from === selected.id ? edge.to : edge.from))! })) : [];
  const chapterParents = selected ? baseTree.edges.filter((edge) => edge.to === selected.chapterId && !edge.recommended).map((edge) => tree.chapters.find((chapter) => chapter.id === edge.from)!).filter(Boolean) : [];

  return <section className={styles.workspace} data-drawer={Boolean(drawerOpen && selected)} aria-label="能力学习路径" onKeyDown={(event) => {
    if (event.key === "Escape" && drawerOpen) { event.stopPropagation(); closeDrawer(); }
  }}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <h2>{title}<button onClick={onManageGoals} className={styles.editGoal}>调整目标 <ChevronRight size={13} /></button></h2>
        <p>{visibleCourses.length === 1 ? `目标：${visibleCourses[0].path.at(-1)?.objective || visibleCourses[0].path.at(-1)?.title || "完成当前课程"}` : "按能力与前置知识学习，按可用时间安排任务"}</p>
        <div className={styles.filters}>
          <label>课程 <select aria-label="筛选能力课程" value={activeCourseId} onChange={(event) => onCourseChange(event.target.value)}>
            <option value="">全部课程</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}{course.paused ? " · 已暂停" : ""}</option>)}
          </select></label>
          <button onClick={() => setListMode(!listMode)}><List size={14} />{listMode ? "查看路径树" : "知识点列表"}</button>
          {tree.chapters.length > 1 && <button aria-pressed={modulesOpen} onClick={() => setModulesOpen(!modulesOpen)}><GitBranch size={14} />章节目录</button>}
          <span className={styles.structureCount}>{tree.chapters.length} 章 · {tree.nodes.length} 个知识点</span>
        </div>
      </div>
      <div className={styles.goalProgress}>
        <span>主线章节已通过 <strong>{baseTree.passedCount}</strong> / {baseTree.mainCount}</span>
        <small title="按章节的预计工作量计算；章内共用任务只计一次">目标进度 {baseTree.progress}%</small>
        {current ? <Link className={styles.primary} href={abilityStudyHref(current)}>继续学习 <ChevronRight size={16} /></Link> : <span>{baseTree.mainCount && baseTree.passedCount === baseTree.mainCount ? "主线目标已达成" : "可预览知识点与学习要求"}</span>}
      </div>
    </header>

    <div className={cn(styles.main, drawerOpen && selected && styles.withDrawer)}>
      <div className={styles.canvasColumn}>
        <div ref={viewport} className={cn(styles.viewport, panning && styles.panning, listMode && styles.listViewport)}
          data-testid="ability-canvas" data-zoom={Math.round(view.zoom * 100)} data-pan-x={Math.round(view.x)} data-pan-y={Math.round(view.y)}
          tabIndex={0} aria-label="能力路径画布，可拖动平移，使用缩放按钮或滚轮缩放"
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const offsets: Record<string, [number, number]> = { ArrowUp: [0, 64], ArrowDown: [0, -64], ArrowLeft: [64, 0], ArrowRight: [-64, 0] };
            if (offsets[event.key]) { event.preventDefault(); const [dx, dy] = offsets[event.key]; updateView({ ...view, x: view.x + dx, y: view.y + dy }); }
            if (event.key === "+" || event.key === "=") zoomAt(view.zoom + .1);
            if (event.key === "-") zoomAt(view.zoom - .1);
          }}
          onPointerDown={(event) => {
            if (listMode || event.button !== 0 || (event.target as HTMLElement).closest("button, a, [data-no-pan]")) return;
            pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: view.x, panY: view.y, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={move} onPointerUp={release} onPointerCancel={release}>
          {listMode ? <div className={styles.branchList}>
            {tree.chapters.map((chapter) => <section key={chapter.id} className={styles.listChapter}>
              <button className={styles.listChapterHeading} aria-expanded={chapter.expanded} onClick={() => toggleChapter(chapter.id)}>
                <span>{String(chapter.index + 1).padStart(2, "0")}</span><strong>{chapter.title}<small>{chapter.nodes.length} 个知识点 · 本章任务 {chapter.source.completedTasks}/{chapter.source.tasks.length}</small></strong><ChevronDown size={17} className={chapter.expanded ? styles.rotated : ""} />
              </button>
              {chapter.expanded && chapter.nodes.map((node) => <button key={node.id} data-ability-id={node.id} onClick={() => openNode(node)} className={styles.listNode}>
                <span className={styles.status} data-status={node.status}><AbilityStatusIcon status={node.status} /></span>
                <span><strong>{node.step.title}</strong><small>{chapterStatus(node)}{node.reviewDue ? " · 待复习" : ""}</small></span><ChevronRight size={16} />
              </button>)}
            </section>)}
          </div> : <div className={styles.surface} style={{ width: tree.width, height: tree.height, transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}>
            {tree.chapters.map((chapter) => <div key={chapter.id} className={styles.chapterBand} data-expanded={chapter.expanded} style={{ top: chapter.y, height: chapter.height, width: tree.width - 20 }}>
              <button data-chapter-id={chapter.id} className={styles.chapterHeading} aria-expanded={chapter.expanded} onClick={() => toggleChapter(chapter.id)}>
                <span className={styles.chapterNumber}>{String(chapter.index + 1).padStart(2, "0")}</span>
                <span><strong>{chapter.title}</strong><small>{chapter.nodes.length} 个知识点 · {ABILITY_STATUS_LABEL[chapter.source.status]} · 本章任务 {chapter.source.completedTasks}/{chapter.source.tasks.length}</small></span>
                <span className={styles.expandChapter}>{chapter.expanded ? "收起" : "展开知识点"}<ChevronDown size={16} className={chapter.expanded ? styles.rotated : ""} /></span>
              </button>
            </div>)}
            <svg className={styles.connections} width={tree.width} height={tree.height} aria-hidden>
              <defs><marker id="knowledge-prerequisite-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path className={styles.arrow} d="M 1 1 L 9 5 L 1 9 Z" /></marker></defs>
              {tree.edges.map((edge, i) => <path key={`${edge.from}-${edge.to}-${i}`} d={edge.path} data-kind={edge.kind} markerEnd={edge.kind === "prerequisite" ? "url(#knowledge-prerequisite-arrow)" : undefined}><title>{edge.label}</title></path>)}
            </svg>
            {tree.nodes.filter((node) => node.visible).map((node) => <button key={node.id} type="button" data-ability-id={node.id} data-status={node.status}
              className={cn(styles.node, selectedId === node.id && drawerOpen && styles.selected)} style={{ left: node.x, top: node.y }}
              aria-pressed={selectedId === node.id && drawerOpen} aria-current={node.id === tree.currentId ? "step" : undefined}
              onClick={() => openNode(node)}>
              <AbilityBadge node={node} />
              <span className={styles.status} data-status={node.status}><AbilityStatusIcon status={node.status} /></span>
              {node.kind !== "main" && <span className={styles.kind}>{ABILITY_KIND_LABEL[node.kind]}</span>}
              {node.reviewDue && <span className={styles.reviewBadge}>待复习</span>}
              <span className={styles.nodeLabel}><strong>{node.step.title}</strong><small>{chapterStatus(node)}</small><small>本章任务 {node.completedTasks}/{node.tasks.length}</small></span>
            </button>)}
          </div>}
          {!listMode && <>
            <div className={styles.legend} data-no-pan><span><i data-kind="membership" />属于本章</span><span><i data-kind="prerequisite" />前置知识 →</span><span><i data-kind="related" />知识关联</span></div>
            <div className={styles.controls} data-no-pan>
              <button aria-label="放大路径" onClick={() => zoomAt(view.zoom + .12)}><Plus size={16} /></button>
              <span>{Math.round(view.zoom * 100)}%</span>
              <button aria-label="缩小路径" onClick={() => zoomAt(view.zoom - .12)}><Minus size={16} /></button>
              <button aria-label="定位当前学习节点" onClick={() => { const node = current || tree.nodes[0]; if (node) { revealChapter(node.chapterId); setPendingFocus(node.id); } }}><LocateFixed size={17} /></button>
              <button aria-label="查看整条路径" onClick={fitTree}><GitBranch size={17} /></button>
            </div>
          </>}
          {modulesOpen && <div className={styles.modules} data-no-pan>
            <header><strong>章节目录</strong><button aria-label="关闭章节目录" onClick={() => setModulesOpen(false)}><X size={16} /></button></header>
            <p>选择章节，展开其中的知识点及关联。</p>
            {tree.chapters.map((chapter) => <button key={chapter.id} onClick={() => { revealChapter(chapter.id); setListMode(false); setPendingFocus(chapter.nodes[0]?.id); }}>
              <span className={styles.directoryNumber}>{String(chapter.index + 1).padStart(2, "0")}</span><span>{chapter.title}<small>{chapter.nodes.length} 个知识点 · {ABILITY_STATUS_LABEL[chapter.source.status]}</small></span><ChevronRight size={14} />
            </button>)}
          </div>}
        </div>
      </div>

      {drawerOpen && selected && <aside ref={drawer} className={styles.drawer} aria-label={`${selected.step.title}节点详情`}>
        <button className={styles.close} onClick={closeDrawer} aria-label="关闭节点详情"><X size={21} /></button>
        <AbilityBadge node={selected} size={102} />
        <small className={styles.eyebrow}>{selected.chapterTitle} / 知识点</small>
        <h3>{selected.step.title}</h3>
        <h4>学完后能做什么</h4><p>{selected.step.objective || selected.step.desc}</p>
        <h4>前置知识</h4>
        {selectedParents.length || chapterParents.length || selected.unresolved.length ? <div className={styles.relations}>
          {selectedParents.map(({ node, edge }) => <button key={node.id} onClick={() => openNode(node)}><BookOpen size={13} /><span>{node.step.title}</span><small>{edge.label}</small></button>)}
          {chapterParents.map((chapter) => <button key={chapter.id} onClick={() => openNode(chapter.nodes[0])}><AbilityStatusIcon status={chapter.source.status} /><span>{chapter.title}</span><small>{chapter.source.status === "passed" ? "前置章节已通过" : "前置章节待验证"}</small></button>)}
          {selected.unresolved.map((label) => <p key={label}><LockKeyhole size={13} />{label} <small>尚未对应到路径节点</small></p>)}
        </div> : <p className={styles.muted}>本路径未设置额外前置知识。</p>}
        {!!selectedRelations.length && <><h4>关联知识点</h4><div className={styles.relations}>{selectedRelations.map(({ node, edge }) => <button key={node.id} onClick={() => openNode(node)}><GitBranch size={13} /><span>{node.step.title}</span><small>{edge.label}</small></button>)}</div></>}
        <h4>本章学习任务 <small>{selected.completedTasks}/{selected.tasks.length}</small></h4>
        <p className={styles.sharedNote}>本章知识点共用以下资料与练习，任务和学习时长只记录一次。</p>
        <ol className={styles.taskList}>{selected.tasks.map((task, index) => <li key={task.key}>
          <Link href={abilityStudyHref(selected, false, task.key)}><span>{task.completed ? <Check size={15} /> : String(index + 1).padStart(2, "0")}</span><strong>{task.title}</strong><small>{task.minutes} 分钟</small><ChevronRight size={13} /></Link>
        </li>)}</ol>
        <h4>章节验证</h4><p>{selected.step.completion_criteria || (selected.verification === "unprepared" ? "本章尚未配置独立验证，学习产出会保留，不自动判为已通过。" : "完成本章的独立练习，达到题目规定的通过标准。")}</p>
        <p className={styles.verification} data-result={selected.verification}>{selected.verification === "passed" ? "已通过验证" : selected.verification === "failed" ? "需要补练 · 已保留学习进度" : selected.verification === "unprepared" ? "验证内容待准备" : "独立验证尚未通过"}{selected.reviewDue ? " · 待复习" : ""}</p>
        <Link className={styles.primary} href={abilityStudyHref(selected)}>{selected.status === "locked" ? "预览学习内容" : "进入学习"}<ChevronRight size={16} /></Link>
        {selected.verification !== "unprepared" && <Link className={styles.secondary} href={abilityStudyHref(selected, true)}>直接验证</Link>}
        {!!selectedChildren.length && <div className={styles.nextNodes}><h4>下一步能学什么</h4>{selectedChildren.map((node) => <button key={node.id} onClick={() => openNode(node)}>{node.step.title}<ChevronRight size={14} /></button>)}</div>}
      </aside>}
    </div>

    <div className={styles.today}>
      <button className={styles.todayToggle} aria-expanded={todayOpen} onClick={() => setTodayOpen(!todayOpen)}><Clock3 size={19} /><strong>今日任务</strong><span>{queue.entries.length ? `安排约 ${queue.plannedMinutes} 分钟` : "当前没有待完成任务"}</span><small>每日预算 {queue.budget} 分钟</small><ChevronDown size={16} className={todayOpen ? styles.rotated : ""} /></button>
      {!todayOpen && queue.entries[0] && <Link className={styles.nextTask} href={abilityStudyHref(queue.entries[0].node, queue.entries[0].review, queue.entries[0].task.key)}>继续：{queue.entries[0].task.title}<ChevronRight size={15} /></Link>}
      {todayOpen && <div className={styles.todayContent}>
        {queue.entries.map(({ node, task, minutes, continues, review }) => <Link key={task.key} href={abilityStudyHref(node, review, task.key)}><span>{review ? <RotateCcw size={16} /> : <Play size={16} />}</span><strong>{task.title}<small>{node.courseTitle} · {node.step.title}</small></strong><span>{minutes} 分钟{continues ? " · 下次继续" : ""}</span><ChevronRight size={15} /></Link>)}
        {reviewCount > 0 && <button className={styles.reviewAction} onClick={onManageGoals}><RotateCcw size={16} />另有 {reviewCount} 项复习待安排 <ChevronRight size={14} /></button>}
        <p>未做完的任务下次优先继续。调整每天时长或目标，请前往学习计划。</p>
      </div>}
    </div>
  </section>;
}
