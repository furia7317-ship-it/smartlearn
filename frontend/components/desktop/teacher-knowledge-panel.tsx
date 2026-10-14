"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { Info, Maximize2, Minimize2, Network, RotateCcw } from "lucide-react";
import { buildKnowledgePathGraph } from "@/lib/knowledge-path-graph";
import { moveGraphNode } from "@/lib/graph-node-drag";
import type { PathStep } from "@/lib/types";
import styles from "./teacher-workspace.module.css";

export function TeacherKnowledgePanel({ path, expanded, onExpand, onAsk }: {
  path: PathStep[]; expanded: boolean; onExpand: () => void; onAsk: (step: PathStep) => void;
}) {
  const graph = useMemo(() => buildKnowledgePathGraph(path), [path]);
  const graphKey = graph.nodes.map((node) => `${node.id}:${node.step.title}`).join("|");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [layout, setLayout] = useState<{ key: string; points: Record<string, { x: number; y: number }> }>({ key: "", points: {} });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; x: number; y: number; width: number; height: number; radiusX: number; radiusY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const maxColumn = Math.max(1, ...graph.nodes.map((node) => node.column));
  const maxLane = Math.max(.5, ...graph.nodes.map((node) => Math.abs(node.lane)));
  const points = Object.fromEntries(graph.nodes.map((node) => [node.id,
    (layout.key === graphKey && layout.points[node.id]) || { x: 50 + node.lane / maxLane * 28, y: 10 + node.column / maxColumn * 78 },
  ]));
  const edges = graph.edges.filter((edge) => filter === "all" || (filter === "prerequisite" ? !edge.inferred : edge.inferred));
  const visibleIds = filter === "all" ? new Set(graph.nodes.map((node) => node.id)) : new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const selected = graph.nodes.find((node) => node.id === selectedId);
  function startDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0) return;
    const bounds = stage.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    const bubble = event.currentTarget.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = { id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...points[id], width: bounds.width, height: bounds.height, radiusX: bubble.width / 2 + 4, radiusY: bubble.height / 2 + 4, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.clientX, dy = event.clientY - current.clientY;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    current.moved = true;
    const point = moveGraphNode(current, dx, dy);
    setLayout((last) => ({ key: graphKey, points: { ...(last.key === graphKey ? last.points : {}), [current.id]: point } }));
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <aside className={styles.knowledgePanel} aria-label="教师知识图谱">
    <header className={styles.panelHeading}><h2><Network />知识图谱</h2><div>
      <button aria-label="重置图谱布局" title="重置图谱布局" onClick={() => { setLayout({ key: "", points: {} }); setSelectedId(""); }}><RotateCcw size={17} /></button>
      <button aria-label={expanded ? "还原图谱布局" : "放大知识图谱"} onClick={onExpand}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
    </div></header>
    <div className={styles.graphFilters}><span>关系筛选</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setSelectedId(""); }} aria-label="知识图谱关系筛选">
      <option value="all">全部</option><option value="prerequisite">先修关系</option><option value="sequence">学习顺序</option>
    </select></div>
    <div ref={stage} className={styles.graphStage} aria-label="可拖动的知识节点">
      {visibleIds.size === 0 ? <div className={styles.graphEmpty}><Network size={32} /><strong>{path.length ? "暂无这类关系" : "知识图谱等待点亮"}</strong><p>{path.length ? "切换关系筛选，查看其他知识关联。" : "创建学习路径后，这里会呈现知识点与学习关系。"}</p></div> : <>
        <svg className={styles.graphEdges} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {edges.map((edge) => <line key={edge.id} x1={points[edge.from].x} y1={points[edge.from].y} x2={points[edge.to].x} y2={points[edge.to].y} stroke={selected && [edge.from, edge.to].includes(selected.id) ? "#946e39" : "#c4b694"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" strokeDasharray={edge.inferred ? "4 4" : undefined} />)}
        </svg>
        {graph.nodes.filter((node) => visibleIds.has(node.id)).map((node) => <button key={node.id} className={styles.graphNode}
          style={{ left: `${points[node.id].x}%`, top: `${points[node.id].y}%` }}
          aria-pressed={node.id === selectedId} aria-label={`知识点：${node.step.title}`}
          onPointerDown={(event) => startDrag(event, node.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
          onClick={() => { if (!suppressClick.current) setSelectedId(node.id); suppressClick.current = false; }}>
          <span>{String(node.index + 1).padStart(2, "0")}</span><b>{node.step.title}</b>
        </button>)}
      </>}
    </div>
    {selected && <div className={styles.graphDetail} key={selected.id}><strong>{selected.step.title}</strong><p>{selected.step.objective || selected.step.desc}</p><button onClick={() => onAsk(selected.step)}>向老师请教这个知识点 →</button></div>}
    <footer className={styles.graphFooter}><Info size={17} /><strong>{visibleIds.size} 个节点 · {edges.length} 条关系</strong><p>点击节点查看详情，拖拽可调整布局</p></footer>
  </aside>;
}
