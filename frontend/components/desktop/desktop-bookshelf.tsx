"use client";

import { useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  GitBranch,
  Library,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { generateBookGraph, previewBook } from "@/lib/api";
import { openInBrowser } from "@/lib/browser-bus";
import type { BookGraphNode, BookKnowledgeGraph, ShelfBook } from "@/lib/bookshelf";
import { cn } from "@/lib/utils";

import styles from "./knowledge-graph.module.css";

interface Position { x: number; y: number }
interface ChapterLabel { id: string; label: string; x: number; y: number }

const CHAPTER_SLOTS: Position[] = [
  { x: 18, y: 24 },
  { x: 50, y: 17 },
  { x: 82, y: 24 },
  { x: 18, y: 72 },
  { x: 50, y: 83 },
  { x: 82, y: 72 },
  { x: 8, y: 48 },
  { x: 92, y: 48 },
];

const CHILD_OFFSETS: Position[] = [
  { x: -10, y: -10 },
  { x: 10, y: -8 },
  { x: -11, y: 10 },
  { x: 11, y: 11 },
  { x: 0, y: 15 },
  { x: 0, y: -15 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildBookLayout(graph: BookKnowledgeGraph): { positions: Map<string, Position>; chapters: ChapterLabel[] } {
  const root = graph.nodes.find((node) => node.kind === "root") ?? graph.nodes[0];
  const explicitChapters = graph.nodes.filter((node) => node.kind === "chapter" && node.id !== root?.id);
  const rootChildren = root
    ? graph.edges.filter((edge) => edge.source === root.id).map((edge) => graph.nodes.find((node) => node.id === edge.target)).filter((node): node is BookGraphNode => Boolean(node))
    : [];
  const chapters = explicitChapters.length ? explicitChapters : rootChildren.slice(0, 8);
  const positions = new Map<string, Position>();
  const owner = new Map<string, string>();
  if (root) positions.set(root.id, { x: 50, y: 50 });

  chapters.forEach((chapter, index) => {
    const slot = CHAPTER_SLOTS[index] ?? {
      x: 50 + Math.cos((Math.PI * 2 * index) / chapters.length - Math.PI / 2) * 40,
      y: 50 + Math.sin((Math.PI * 2 * index) / chapters.length - Math.PI / 2) * 36,
    };
    positions.set(chapter.id, slot);
    owner.set(chapter.id, chapter.id);
  });

  const outgoing = new Map<string, string[]>();
  graph.edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]));
  chapters.forEach((chapter) => {
    const queue = [...(outgoing.get(chapter.id) ?? [])];
    const visited = new Set<string>();
    while (queue.length) {
      const id = queue.shift();
      if (!id || visited.has(id) || id === root?.id || chapters.some((item) => item.id === id)) continue;
      visited.add(id);
      if (!owner.has(id)) owner.set(id, chapter.id);
      queue.push(...(outgoing.get(id) ?? []));
    }
  });

  const remaining = graph.nodes.filter((node) => node.id !== root?.id && !chapters.some((chapter) => chapter.id === node.id));
  remaining.forEach((node, index) => {
    if (!owner.has(node.id) && chapters.length) owner.set(node.id, chapters[index % chapters.length].id);
  });
  chapters.forEach((chapter) => {
    const slot = positions.get(chapter.id) ?? { x: 50, y: 50 };
    const children = remaining.filter((node) => owner.get(node.id) === chapter.id);
    children.forEach((node, index) => {
      const base = CHILD_OFFSETS[index % CHILD_OFFSETS.length];
      const ring = Math.floor(index / CHILD_OFFSETS.length);
      const spread = 1 + ring * .55;
      positions.set(node.id, {
        x: clamp(slot.x + base.x * spread, 5, 95),
        y: clamp(slot.y + base.y * spread, 10, 94),
      });
    });
  });

  return {
    positions,
    chapters: chapters.map((chapter) => {
      const position = positions.get(chapter.id) ?? { x: 50, y: 50 };
      return { id: chapter.id, label: chapter.label, x: position.x, y: clamp(position.y - 13, 5, 92) };
    }),
  };
}

function bookEdgePath(from: Position, to: Position): string {
  const dx = to.x - from.x;
  return `M ${from.x} ${from.y} C ${from.x + dx * .42} ${from.y}, ${to.x - dx * .42} ${to.y}, ${to.x} ${to.y}`;
}

function kindLabel(kind: BookGraphNode["kind"]): string {
  return ({ root: "全书主题", chapter: "章节", concept: "核心概念", example: "示例 / 应用" } as const)[kind];
}

function BookGraphView({ graph }: { graph: BookKnowledgeGraph }) {
  const layout = useMemo(() => buildBookLayout(graph), [graph]);
  const root = graph.nodes.find((node) => node.kind === "root") ?? graph.nodes[0];
  const [selectedId, setSelectedId] = useState(root?.id ?? "");
  const [query, setQuery] = useState("");
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? root;
  const normalizedQuery = query.trim().toLowerCase();
  const connectedIds = useMemo(() => {
    const ids = new Set<string>(selected ? [selected.id] : []);
    if (!selected) return ids;
    graph.edges.forEach((edge) => {
      if (edge.source === selected.id) ids.add(edge.target);
      if (edge.target === selected.id) ids.add(edge.source);
    });
    return ids;
  }, [graph.edges, selected]);
  const related = graph.nodes.filter((node) => node.id !== selected?.id && connectedIds.has(node.id)).slice(0, 6);
  const chapterCount = graph.nodes.filter((node) => node.kind === "chapter").length;
  const conceptCount = graph.nodes.filter((node) => node.kind === "concept").length;

  return (
    <div className={styles.bookGraphLayout}>
      <div className={styles.bookGraphCanvas}>
        <div className={styles.bookGraphToolbar}>
          <label><Search className="size-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节、概念或示例…" /></label>
          <span>点击节点查看全书中的位置与关联</span>
        </div>
        <div className={styles.bookGraphStage}>
          {layout.chapters.map((chapter) => <div key={chapter.id} className={styles.chapterLabel} style={{ left: `${chapter.x}%`, top: `${chapter.y}%` }}>{chapter.label}</div>)}
          <svg className={styles.edges} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {graph.edges.map((edge, index) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);
              if (!source || !target) return null;
              const active = selected && (edge.source === selected.id || edge.target === selected.id);
              return <path key={`${edge.source}-${edge.target}-${index}`} d={bookEdgePath(source, target)} className={cn(styles.edge, styles.edgeMedium, active && styles.edgeActive)} />;
            })}
          </svg>
          {graph.nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            const queryMatch = !normalizedQuery || `${node.label} ${node.group} ${node.summary}`.toLowerCase().includes(normalizedQuery);
            return (
              <button
                type="button"
                key={node.id}
                className={cn(
                  styles.bookNode,
                  node.kind === "root" && styles.bookNodeRoot,
                  node.kind === "chapter" && styles.bookNodeChapter,
                  node.kind === "example" && styles.bookNodeExample,
                  selected?.id === node.id && styles.bookNodeSelected,
                  !queryMatch && styles.bookNodeDimmed,
                )}
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => setSelectedId(node.id)}
                aria-pressed={selected?.id === node.id}
              >
                <b>{node.label}</b><small>{node.importance}</small>
              </button>
            );
          })}
        </div>
        <div className={styles.bookLegend}>
          <span className={styles.rootLegend}><i />全书主题</span>
          <span className={styles.chapterLegend}><i />章节</span>
          <span className={styles.conceptLegend}><i />核心概念</span>
          <span className={styles.exampleLegend}><i />示例 / 应用</span>
          <span style={{ marginLeft: "auto" }}>共 {graph.nodes.length} 个节点 · {graph.edges.length} 条关系</span>
        </div>
      </div>
      <aside className={styles.bookInspector}>
        <span className={styles.bookInspectorEyebrow}>{selected?.group || "全书结构"}</span>
        <h3>{selected?.label || graph.title}</h3>
        <p>{selected?.summary || graph.overview}</p>
        <div className={styles.bookStats}>
          <div><strong>{chapterCount}</strong><small>章节</small></div>
          <div><strong>{conceptCount}</strong><small>核心概念</small></div>
          <div><strong>{graph.edges.length}</strong><small>知识关系</small></div>
        </div>
        <div className={styles.detailRow}><small>节点层级</small><strong>{selected ? kindLabel(selected.kind) : "全书"}</strong></div>
        <div className={styles.detailRow}><small>重要程度</small><strong>{selected?.importance ?? 5} / 5</strong></div>
        <div className={styles.detailRow}><small>直接关联</small><strong>{Math.max(0, connectedIds.size - 1)} 个节点</strong></div>
        {related.length > 0 && <><div className={styles.sectionTitle}><GitBranch className="mr-1 inline size-3" />关联知识</div><div className={styles.relatedList}>{related.map((node) => <button type="button" key={node.id} onClick={() => setSelectedId(node.id)}>{node.label}</button>)}</div></>}
        <div className={styles.sectionTitle}>全书概览</div>
        <p>{graph.overview || "图谱按全书主题、章节、概念与应用四层组织，点击任一节点可追踪上下游关系。"}</p>
      </aside>
    </div>
  );
}

export function DesktopBookshelf({ books, onChange }: { books: ShelfBook[]; onChange: (books: ShelfBook[]) => void }) {
  const [activeBook, setActiveBook] = useState<ShelfBook | null>(null);
  const [view, setView] = useState<"preview" | "graph">("preview");
  const [busy, setBusy] = useState<"preview" | "graph" | null>(null);
  const [error, setError] = useState("");

  const updateBook = (id: string, patch: Partial<ShelfBook>) => {
    const next = books.map((book) => book.id === id ? { ...book, ...patch } : book);
    onChange(next);
    setActiveBook((current) => current?.id === id ? { ...current, ...patch } : current);
  };

  const showPreview = async (book: ShelfBook) => {
    setActiveBook(book);
    setView("preview");
    setError("");
    if (book.preview && book.previewVersion === 2) return;
    setBusy("preview");
    try {
      const result = await previewBook(book.url, book.title, book.summary);
      updateBook(book.id, { preview: result.excerpt, previewNotice: result.notice || "", previewVersion: 2 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预览失败");
    } finally {
      setBusy(null);
    }
  };

  const showGraph = async (book: ShelfBook, force = false) => {
    setActiveBook(book);
    setView("graph");
    setError("");
    if (!force && book.graph && book.graphVersion === 2) return;
    setBusy("graph");
    try {
      const graph = await generateBookGraph(book.url, book.title, book.summary);
      updateBook(book.id, { graph, graphVersion: 2 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "知识图谱生成失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className={styles.shelfSection}>
        <div className={styles.shelfHeading}><Library className="size-4" /><h2>我的书架</h2><p>保存教材、预览正文，并生成覆盖全书的章节知识图谱</p><code>{books.length} 本</code></div>
        {books.length === 0 ? <p className={styles.emptyShelf}>书架还是空的。先在下方搜索教材，再点击“加入书架”。</p> : (
          <div className={styles.shelfGrid}>{books.map((book) => (
            <article key={book.id} className={styles.shelfCard}>
              <div className={styles.bookCover}><BookOpen className="size-6" /></div>
              <div className={styles.bookMeta}>
                <h3 title={book.title}>{book.title}</h3><p>{book.site || "网络教材"}</p>
                <div className={styles.bookActions}>
                  <button type="button" onClick={() => showPreview(book)}><BookOpen className="size-3" />预览</button>
                  <button type="button" onClick={() => showGraph(book)}><Network className="size-3" />{book.graph && book.graphVersion === 2 ? "查看全书图谱" : "生成全书图谱"}</button>
                  <button type="button" aria-label={`从书架移除 ${book.title}`} onClick={() => onChange(books.filter((item) => item.id !== book.id))}><Trash2 className="size-3" /></button>
                </div>
              </div>
            </article>
          ))}</div>
        )}
      </section>

      {activeBook && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setActiveBook(null)}>
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={`${activeBook.title}预览`} onMouseDown={(event) => event.stopPropagation()}>
            <header className={styles.modalHeader}>
              <div><span className={styles.modalEyebrow}>我的书架 · {view === "preview" ? "内容预览" : "全书知识图谱"}</span><h2>{activeBook.title}</h2></div>
              <div className={styles.modalHeaderActions}>
                {view === "graph" && <button type="button" disabled={busy === "graph"} onClick={() => showGraph(activeBook, true)}><RefreshCw className={cn("size-3.5", busy === "graph" && "animate-spin")} />重新分析全书</button>}
                <button type="button" onClick={() => openInBrowser(activeBook.url)}><ExternalLink className="size-3.5" />原文</button>
                <button type="button" aria-label="关闭" onClick={() => setActiveBook(null)}><X className="size-4" /></button>
              </div>
            </header>
            <nav className={styles.modalTabs}>
              <button type="button" className={view === "preview" ? styles.activeTab : ""} onClick={() => showPreview(activeBook)}>内容预览</button>
              <button type="button" className={view === "graph" ? styles.activeTab : ""} onClick={() => showGraph(activeBook)}>全书知识图谱</button>
              <span>全书 → 章节 → 核心概念 → 示例 / 应用</span>
            </nav>
            <main className={styles.modalMain}>
              {busy ? (
                <div className={styles.loading}><Loader2 className="size-6 animate-spin" /><b>{busy === "preview" ? "正在抓取可读正文…" : "Agent 正在分析全书结构…"}</b><p>{busy === "graph" ? "扫描章节层级、核心概念、示例与跨章节依赖关系" : "清理导航与广告，生成阅读预览"}</p></div>
              ) : error ? (
                <div className={styles.error}><b>暂时无法完成</b><p>{error}</p><button type="button" onClick={() => openInBrowser(activeBook.url)}>在内置浏览器打开原文</button></div>
              ) : view === "preview" ? (
                <article className={styles.preview}>
                  {activeBook.previewNotice && <div className={styles.previewNotice}>{activeBook.previewNotice}</div>}
                  <p>{activeBook.preview || activeBook.summary || "暂无可预览内容"}</p>
                </article>
              ) : activeBook.graph ? <BookGraphView graph={activeBook.graph} /> : null}
            </main>
          </section>
        </div>
      )}
    </>
  );
}
