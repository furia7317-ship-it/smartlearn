"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ReactFlow, ReactFlowProvider, Handle, Position, BaseEdge, getSmoothStepPath, useReactFlow, useNodesInitialized, type Node, type NodeProps, type EdgeProps, type Viewport } from "@xyflow/react";
import { BookOpen, BracketsCurly, Code, CursorClick, Globe, Devices, GitBranch, Package, Lightning, Cube as Cubes, Check, RocketLaunch, Database, Path, TreeStructure, Briefcase, LockKey, Monitor, Gauge, ShieldCheck, ChartBar, Medal, HardDrives, Graph, PersonArmsSpread, Plus, Minus, CornersOut, Crosshair, Pause, CheckCircle } from "@phosphor-icons/react";
import { FOCUS_COLORS, FOCUS_LABELS, type FocusNode, type FocusRecord, type FocusSnapshot } from "@/lib/focus-api";
import { FOCUS_LAYOUT_VERSION, focusNeighborhood, layoutFocusGraph, type FocusLayout } from "@/lib/focus-layout";
import "@xyflow/react/dist/style.css";
import styles from "./focus-workspace.module.css";

const ICONS = { book: BookOpen, html: Code, css: BracketsCurly, code: Code, cursor: CursorClick, globe: Globe, devices: Devices, git: GitBranch, package: Package, bolt: Lightning, cubes: Cubes, check: ShieldCheck, rocket: RocketLaunch, vue: Code, typescript: BracketsCurly, route: Path, database: Database, tree: TreeStructure, briefcase: Briefcase, lock: LockKey, monitor: Monitor, gauge: Gauge, shield: ShieldCheck, chart: ChartBar, medal: Medal, server: HardDrives, network: Graph, person: PersonArmsSpread };
export function KnowledgeIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  if (icon === "vue" || icon === "typescript") return <span className={styles.brandGlyph} style={{ fontSize: size, color: icon === "vue" ? "#367959" : "#3676a0" }}>{icon === "vue" ? "V" : "TS"}</span>;
  const aliases: Record<string, string> = { sitemap: "tree", "chart-line": "chart", "chart-bar": "chart", link: "network", layers: "cubes", "git-branch": "git", "project-diagram": "network", hash: "database", "book-open": "book", list: "code", "sort-amount-down": "chart" };
  const Icon = ICONS[(aliases[icon] || icon) as keyof typeof ICONS] || BookOpen;
  return <Icon size={size} weight="duotone" aria-hidden />;
}

type CardData = { [key: string]: unknown; node?: FocusNode; record?: FocusRecord; title: string; description?: string; color: string; tint: number; faded: boolean; role: "knowledge" | "module" | "root"; highlighted: boolean };
type CardNode = Node<CardData, "focus">;
const FocusCard = memo(function FocusCard({ data, selected }: NodeProps<CardNode>) {
  const special = data.role !== "knowledge";
  const status = data.record?.status;
  return <div className={`${styles.graphCard} ${special ? styles.plaque : styles.knowledgeCard} ${selected ? styles.selected : ""} ${data.faded ? styles.faded : ""}`}
    data-status={status} data-role={data.role} style={{ "--node-color": data.color, "--plaque-tint": `${data.tint}deg` } as CSSProperties}>
    <Handle type="target" position={Position.Top} isConnectable={false} className={styles.handle} />
    <img src={special ? "/brand/path/focus-crest-v2.png" : "/brand/path/focus-node-v2.png"} className={styles.cardArtwork} alt="" draggable={false} />
    {special ? <div className={styles.plaqueText}><strong>{data.title}</strong><small>{data.description}</small></div> : <>
      <span className={styles.nodeSymbol}><KnowledgeIcon icon={data.node?.icon || "book"} size={25} /></span>
      <strong>{data.title}</strong>
      <small>{data.record?.review_due ? "待复习" : status ? FOCUS_LABELS[status] : ""}{status === "active" ? ` · ${data.record?.tasks.length}/3` : ""}</small>
      <span className={styles.nodeState}>{status === "passed" ? <Check size={13} weight="bold" /> : status === "locked" ? <LockKey size={11} weight="fill" /> : status === "paused" ? <Pause size={11} weight="fill" /> : status === "active" ? <span className={styles.activeDot} /> : null}</span>
    </>}
    <Handle type="source" position={Position.Bottom} isConnectable={false} className={styles.handle} />
  </div>;
});

const FocusEdge = memo(function FocusEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 9, offset: 16 });
  return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={0} />;
});
const NODE_TYPES = { focus: FocusCard };
const EDGE_TYPES = { focus: FocusEdge };

function Canvas({ state, selected, onSelect, search }: { state: FocusSnapshot; selected: string; onSelect: (id: string) => void; search: string }) {
  const [layout, setLayout] = useState<FocusLayout | null>(null);
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState(false);
  const flow = useReactFlow();
  const initialized = useNodesInitialized();
  const restored = useRef("");
  const graph = state.graph;
  const key = `xueshu.focus.viewport.${FOCUS_LAYOUT_VERSION}.${state.id}.${state.version}`;
  useEffect(() => {
    let disposed = false;
    setLayout(null); setError("");
    layoutFocusGraph(state.id, state.version, graph).then(result => { if (!disposed) setLayout(result); }).catch(() => { if (!disposed) setError("图谱排版暂时失败，请重试。"); });
    return () => { disposed = true; };
    // Versions are immutable; learner progress must never trigger a layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.id, state.version]);
  const neighbors = useMemo(() => focusNeighborhood(graph, selected), [graph, selected]);
  const matches = useMemo(() => new Set(graph.nodes.filter(n => n.title.toLowerCase().includes(search.trim().toLowerCase())).map(n => n.id)), [graph.nodes, search]);
  const { nodes, edges } = useMemo(() => {
    if (!layout) return { nodes: [], edges: [] };
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    const modules = new Map(graph.modules.map(m => [m.id, m]));
    const nodes: CardNode[] = layout.placements.map(place => {
      const node = nodeMap.get(place.id);
      const chapter = modules.get(node?.module_id || place.id.replace("module:", ""));
      return { id: place.id, type: "focus", position: { x: place.x, y: place.y }, width: place.width, height: place.height,
        draggable: false, selectable: place.kind === "knowledge", focusable: place.kind === "knowledge", selected: place.id === selected,
        ariaLabel: node ? `${chapter?.title}，${node.title}，${FOCUS_LABELS[state.nodes[node.id].status]}` : place.id,
        data: { node, record: state.nodes[place.id], title: node?.title || chapter?.title || (state.course_id === "starter.frontend" ? "前端启程" : "学习启程"), description: chapter?.description || "以知识为经 · 向更大的世界", color: FOCUS_COLORS[chapter?.color || "green"], tint: ({red:-120,blue:85,green:0,brown:-80,purple:155,teal:35}[chapter?.color || "green"] || 0),
          faded: place.kind === "knowledge" && (search.trim() ? !matches.has(place.id) : highlight && !neighbors.has(place.id)), role: place.kind, highlighted: neighbors.has(place.id) } };
    });
    const edges = layout.links.map(link => {
      const target = nodeMap.get(link.target);
      const color = FOCUS_COLORS[modules.get(target?.module_id || link.target.replace("module:", ""))?.color || "green"];
      const important = link.source === selected || link.target === selected;
      const cross = nodeMap.get(link.source)?.module_id !== target?.module_id && link.kind !== "membership";
      const soft = link.kind === "recommended" || link.kind === "related";
      return { ...link, type: "focus", selectable: false, focusable: false, zIndex: important && highlight ? 3 : 0,
        style: { stroke: color, strokeWidth: important && highlight ? 2.7 : link.kind === "membership" ? 1.9 : 1.5,
          strokeDasharray: soft ? "4 5" : link.kind === "alternative" ? "9 3" : undefined,
          opacity: highlight ? important ? 1 : .12 : soft ? .25 : cross ? .38 : .78 },
        markerEnd: link.kind === "membership" ? undefined : { type: "arrowclosed" as const, color, width: 10, height: 10 } };
    });
    return { nodes, edges };
  }, [graph, layout, state.nodes, state.course_id, selected, matches, neighbors, highlight, search]);
  const center = (id: string) => {
    const node = layout?.placements.find(n => n.id === id);
    if (node) void flow.setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1.1, duration: 350 });
  };
  const restore = () => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) { const value = JSON.parse(stored) as Viewport; if ([value.x, value.y, value.zoom].every(Number.isFinite)) { void flow.setViewport(value); return; } }
    } catch { /* A private browser may disable storage. */ }
    if (state.active_node_id) center(state.active_node_id);
    else void flow.fitView({ padding: .025, maxZoom: 1 });
  };
  useEffect(() => {
    if (!layout || !initialized || !flow.viewportInitialized || restored.current === key) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      restored.current = key;
      restore();
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
    // Initial view restoration, not selection or progress, controls the viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, initialized, key, flow.viewportInitialized]);
  if (error) return <div className={styles.canvasMessage} role="alert">{error}<button onClick={() => location.reload()}>重新载入</button></div>;
  if (!layout) return <div className={styles.canvasMessage}>正在铺展知识图…</div>;
  return <div className={styles.canvas} aria-label="课程知识国策树" onKeyDownCapture={event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const id = (event.target as HTMLElement).closest<HTMLElement>(".react-flow__node")?.dataset.id;
    if (id && graph.nodes.some(node => node.id === id)) { event.preventDefault(); event.stopPropagation(); onSelect(id); }
  }}>
    <ReactFlow key={key} nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} minZoom={.25} maxZoom={1.8}
      fitView fitViewOptions={{ padding: .04, maxZoom: 1 }}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable selectNodesOnDrag={false} deleteKeyCode={null}
      autoPanOnNodeFocus={false}
      zoomOnDoubleClick={false} panOnScroll panOnDrag preventScrolling proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => { if (node.data.role === "knowledge") onSelect(node.id); }}
      onMoveEnd={(_, viewport) => { if (restored.current !== key) return; try { sessionStorage.setItem(key, JSON.stringify(viewport)); } catch { /* optional */ } }}
      ariaLabelConfig={{ "node.a11yDescription.default": "使用 Tab 定位知识点，按回车查看详情。", "controls.zoomIn.ariaLabel": "放大", "controls.zoomOut.ariaLabel": "缩小" }}>
    </ReactFlow>
    <div className={styles.legend}><span><i />必须先学</span><span><i className={styles.optionalLine} />任选其一</span><span><i className={styles.softLine} />建议先学</span><span className={styles.legendStatus}><CheckCircle size={13} />通过后点亮</span></div>
    <div className={styles.canvasTools}>
      <button onClick={() => setHighlight(v => !v)} aria-pressed={highlight} title="突出当前知识点的前后关联"><Graph size={17} />关联</button>
      <button aria-label="放大国策树" onClick={() => flow.zoomIn({ duration: 180 })}><Plus size={17} /></button>
      <button aria-label="缩小国策树" onClick={() => flow.zoomOut({ duration: 180 })}><Minus size={17} /></button>
      <button aria-label="查看完整课程树" onClick={() => flow.fitView({ padding: .025, duration: 300 })}><CornersOut size={17} /></button>
      <button aria-label="定位当前学习节点" onClick={() => center(state.active_node_id || selected)}><Crosshair size={17} /></button>
    </div>
    {search.trim() && <div className={styles.searchResult}>{matches.size ? `找到 ${matches.size} 个知识点` : "没有匹配的知识点"}</div>}
  </div>;
}

export default function FocusTreeCanvas(props: Parameters<typeof Canvas>[0]) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
