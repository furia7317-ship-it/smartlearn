"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Focus,
  GraduationCap,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minus,
  Network,
  Plus,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

import type { MindmapNode, ResourceData } from "@/lib/types";
import { cn } from "@/lib/utils";

type FlatNode = {
  key: string;
  node: MindmapNode;
  depth: number;
  parentKey: string | null;
  parentLabel: string | null;
};

type PositionedNode = FlatNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  branchIndex: number;
  side: "left" | "right";
  kind: "branch" | "child";
};

type Connector = {
  key: string;
  path: string;
  color: string;
  width: number;
};

const CANVAS_WIDTH = 1180;
const MIN_CANVAS_HEIGHT = 900;
const ROOT_WIDTH = 210;
const ROOT_HEIGHT = 126;
const BRANCH_WIDTH = 202;
const BRANCH_HEIGHT = 92;
const CHILD_WIDTH = 178;
const CHILD_HEIGHT = 68;

const BRANCH_PALETTE = [
  { line: "#bd7452", wash: "#fbf0e8", dot: "#bd7452" },
  { line: "#c59335", wash: "#fbf5e5", dot: "#c59335" },
  { line: "#72856a", wash: "#eef2e9", dot: "#72856a" },
  { line: "#758b96", wash: "#edf2f3", dot: "#758b96" },
  { line: "#b16f65", wash: "#f8eeeb", dot: "#b16f65" },
  { line: "#8b775f", wash: "#f3eee6", dot: "#8b775f" },
] as const;

function nodeKey(node: MindmapNode, path: number[]) {
  return String(node.id ?? `${path.join("-")}:${node.label}`);
}

export function flattenMindmapNodes(nodes: MindmapNode[], depth = 0, parent: FlatNode | null = null, path: number[] = []): FlatNode[] {
  return nodes.flatMap((node, index) => {
    const currentPath = [...path, index];
    const current: FlatNode = {
      key: nodeKey(node, currentPath),
      node,
      depth,
      parentKey: parent?.key ?? null,
      parentLabel: parent?.node.label ?? null,
    };
    return [
      current,
      ...flattenMindmapNodes(node.children ?? [], depth + 1, current, currentPath),
    ];
  });
}

function childrenOf(node: MindmapNode) {
  return Array.isArray(node.children) ? node.children : [];
}

function semanticDescription(node: MindmapNode, isRoot: boolean) {
  const explicit = (node as MindmapNode & { description?: unknown }).description;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const childCount = childrenOf(node).length;
  if (isRoot) return "从中心主题出发，沿一级分支建立完整知识结构，再进入具体知识点学习。";
  if (childCount > 0) return `这个分支包含 ${childCount} 个直接知识点。选择子节点可继续查看结构，并打开相关学习资源。`;
  return "这是导图中的具体知识点。可以继续查找对应讲义、进入练习，或直接请智能教师结合上下文讲解。";
}

function masteryOf(node: MindmapNode) {
  const value = (node as MindmapNode & { mastery?: unknown }).mastery;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function statusOf(node: MindmapNode) {
  const raw = (node as MindmapNode & { status?: unknown }).status;
  if (raw === "mastered" || raw === "已掌握") return "已掌握";
  if (raw === "learning" || raw === "学习中") return "学习中";
  if (raw === "review" || raw === "待复习") return "待复习";
  return "尚未记录";
}

function buildLayout(nodes: MindmapNode[], expanded: Set<string>) {
  const branchEntries = nodes.map((node, index) => ({
    key: nodeKey(node, [index]),
    node,
    index,
  }));
  const left = branchEntries.filter((_, index) => index % 2 === 0);
  const right = branchEntries.filter((_, index) => index % 2 === 1);
  const maxSide = Math.max(left.length, right.length, 1);
  const canvasHeight = Math.max(MIN_CANVAS_HEIGHT, maxSide * 214 + 120);
  const rootX = (CANVAS_WIDTH - ROOT_WIDTH) / 2;
  const rootY = (canvasHeight - ROOT_HEIGHT) / 2;
  const positioned: PositionedNode[] = [];
  const connectors: Connector[] = [];

  const placeSide = (entries: typeof branchEntries, side: "left" | "right") => {
    const slotHeight = canvasHeight / Math.max(entries.length, 1);
    entries.forEach((entry, sideIndex) => {
      const palette = BRANCH_PALETTE[entry.index % BRANCH_PALETTE.length];
      const centerY = slotHeight * (sideIndex + 0.5);
      const branchX = side === "left" ? 288 : 690;
      const branchY = centerY - BRANCH_HEIGHT / 2;
      positioned.push({
        key: entry.key,
        node: entry.node,
        depth: 0,
        parentKey: null,
        parentLabel: null,
        x: branchX,
        y: branchY,
        width: BRANCH_WIDTH,
        height: BRANCH_HEIGHT,
        branchIndex: entry.index,
        side,
        kind: "branch",
      });

      const rootAnchorX = side === "left" ? rootX : rootX + ROOT_WIDTH;
      const branchAnchorX = side === "left" ? branchX + BRANCH_WIDTH : branchX;
      const rootCenterY = rootY + ROOT_HEIGHT / 2;
      const branchCenterY = branchY + BRANCH_HEIGHT / 2;
      const bend = (rootAnchorX + branchAnchorX) / 2;
      connectors.push({
        key: `root-${entry.key}`,
        path: `M ${rootAnchorX} ${rootCenterY} C ${bend} ${rootCenterY}, ${bend} ${branchCenterY}, ${branchAnchorX} ${branchCenterY}`,
        color: palette.line,
        width: 5,
      });

      if (!expanded.has(entry.key)) return;
      const children = childrenOf(entry.node).slice(0, 4);
      const childGap = 9;
      const totalChildrenHeight = children.length * CHILD_HEIGHT + Math.max(0, children.length - 1) * childGap;
      const childStartY = centerY - totalChildrenHeight / 2;
      children.forEach((child, childIndex) => {
        const key = nodeKey(child, [entry.index, childIndex]);
        const childX = side === "left" ? 40 : 962;
        const childY = childStartY + childIndex * (CHILD_HEIGHT + childGap);
        positioned.push({
          key,
          node: child,
          depth: 1,
          parentKey: entry.key,
          parentLabel: entry.node.label,
          x: childX,
          y: childY,
          width: CHILD_WIDTH,
          height: CHILD_HEIGHT,
          branchIndex: entry.index,
          side,
          kind: "child",
        });
        const parentAnchorX = side === "left" ? branchX : branchX + BRANCH_WIDTH;
        const childAnchorX = side === "left" ? childX + CHILD_WIDTH : childX;
        const childCenterY = childY + CHILD_HEIGHT / 2;
        const childBend = (parentAnchorX + childAnchorX) / 2;
        connectors.push({
          key: `${entry.key}-${key}`,
          path: `M ${parentAnchorX} ${branchCenterY} C ${childBend} ${branchCenterY}, ${childBend} ${childCenterY}, ${childAnchorX} ${childCenterY}`,
          color: palette.line,
          width: 2.5,
        });
      });
    });
  };

  placeSide(left, "left");
  placeSide(right, "right");
  return { canvasHeight, rootX, rootY, positioned, connectors };
}

function MapNodeCard({
  item,
  selected,
  highlighted,
  expanded,
  onSelect,
  onToggle,
}: {
  item: PositionedNode;
  selected: boolean;
  highlighted: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const palette = BRANCH_PALETTE[item.branchIndex % BRANCH_PALETTE.length];
  const childCount = childrenOf(item.node).length;
  return (
    <div
      className={cn(
        "absolute rounded-xl border bg-[#fffdf7] text-[#352b20] shadow-[0_5px_16px_rgba(69,49,26,0.08)] transition-[box-shadow,border-color,transform] duration-150",
        selected && "z-10 -translate-y-0.5 shadow-[0_8px_22px_rgba(117,80,31,0.18)]",
        highlighted && "ring-2 ring-[#c18a3b]/55"
      )}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        borderColor: selected ? palette.line : `${palette.line}88`,
        backgroundColor: palette.wash,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex h-full w-full flex-col items-stretch rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#a26d28]"
        aria-pressed={selected}
        aria-label={`选择节点：${item.node.label}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.dot }} />
          <span className={cn("min-w-0 flex-1 truncate font-semibold", item.kind === "branch" ? "text-sm" : "text-[12.5px]")}>{item.node.label}</span>
          {childCount > 0 && <span className="w-6 shrink-0" />}
        </span>
        <span className="mt-auto flex items-center gap-2 border-t border-black/10 pt-1.5 text-[10px] text-[#776b5d]">
          {childCount > 0 ? `${childCount} 个子节点` : "具体知识点"}
          {masteryOf(item.node) !== null && <span className="ml-auto">掌握 {masteryOf(item.node)}%</span>}
        </span>
      </button>
      {childCount > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-md border border-black/10 bg-white/70 text-[#6e5c46] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[#a26d28]"
          aria-label={expanded ? `收起${item.node.label}` : `展开${item.node.label}`}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export function MindmapWorkspace({
  data,
  title,
  onOpenResource,
  onOpenPractice,
  practiceGenerating = false,
  practiceError = "",
  onAskTeacher,
}: {
  data: ResourceData;
  title: string;
  onOpenResource: (label: string) => void;
  onOpenPractice: (label: string) => void | Promise<void>;
  practiceGenerating?: boolean;
  practiceError?: string;
  onAskTeacher: (label: string) => void;
}) {
  const nodes = useMemo(() => data.nodes ?? [], [data.nodes]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const flatNodes = useMemo(() => flattenMindmapNodes(nodes), [nodes]);
  const branchKeys = useMemo(() => new Set(nodes.map((node, index) => nodeKey(node, [index]))), [nodes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(branchKeys));
  const [selectedKey, setSelectedKey] = useState<string>(() => flatNodes[0]?.key ?? "root");
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(90);
  const layout = useMemo(() => buildLayout(nodes, expanded), [expanded, nodes]);
  const selected = flatNodes.find((entry) => entry.key === selectedKey) ?? null;
  const rootNode: MindmapNode = { label: data.title || title, children: nodes };
  const selectedNode = selected?.node ?? rootNode;
  const selectedLabel = selectedNode.label;
  const selectedChildren = childrenOf(selectedNode);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const highlightedKeys = new Set(
    normalizedQuery
      ? flatNodes.filter((entry) => entry.node.label.toLocaleLowerCase("zh-CN").includes(normalizedQuery)).map((entry) => entry.key)
      : []
  );
  const allExpanded = branchKeys.size > 0 && [...branchKeys].every((key) => expanded.has(key));

  const setZoomSafe = (value: number) => setZoom(Math.max(60, Math.min(140, value)));
  const resetView = () => {
    setZoom(90);
    requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scroller.scrollTo({
        left: Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2),
        top: Math.max(0, (scroller.scrollHeight - scroller.clientHeight) / 2),
        behavior: "smooth",
      });
    });
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    const normalized = value.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return;
    const match = flatNodes.find((entry) => entry.node.label.toLocaleLowerCase("zh-CN").includes(normalized));
    if (!match) return;
    setSelectedKey(match.key);
    if (match.parentKey) setExpanded((current) => new Set(current).add(match.parentKey!));
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (nodes.length === 0) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center bg-[#f7f1e6] px-6 text-center">
        <div className="max-w-sm rounded-2xl border border-dashed border-[#cfc0aa] bg-[#fffaf1] p-8">
          <Network className="mx-auto size-8 text-[#8a6638]" />
          <h3 className="mt-3 font-display text-lg font-semibold">导图结构尚未生成</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">这份资源暂时没有可展示的节点，请返回资源中心重新生成。</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={workspaceRef} className="flex h-full min-h-[560px] flex-col bg-[#f7f1e6] text-[#31271c]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#d8cbb8] bg-[#fbf7ee] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-[#756957]">
          <Network className="size-4 text-[#8d6128]" />
          <span className="font-semibold text-[#493722]">知识画布</span>
          <span className="rounded-full border border-[#d6c5ab] bg-white/60 px-2 py-1">{flatNodes.length} 个节点</span>
          <span className="hidden rounded-full border border-[#bdcfbb] bg-[#eef5eb] px-2 py-1 text-[#4c704d] sm:inline">结构已过审</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <label className="flex h-8 w-44 items-center gap-2 rounded-lg border border-[#d2c4b0] bg-white/75 px-2.5 text-xs text-[#665945] focus-within:ring-2 focus-within:ring-[#bd8a48]/35">
            <Search className="size-3.5 shrink-0" />
            <input
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#9d917e]"
              placeholder="搜索节点"
              aria-label="搜索思维导图节点"
            />
          </label>
          <button
            type="button"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(branchKeys))}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d2c4b0] bg-white/70 px-2.5 text-xs font-medium hover:bg-white"
          >
            {allExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {allExpanded ? "全部收起" : "全部展开"}
          </button>
          <button type="button" onClick={resetView} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#d2c4b0] bg-white/70 px-2.5 text-xs font-medium hover:bg-white">
            <Focus className="size-3.5" />自适应
          </button>
          <div className="flex h-8 items-center rounded-lg border border-[#d2c4b0] bg-white/70">
            <button type="button" onClick={() => setZoomSafe(zoom - 10)} aria-label="缩小导图" className="grid h-full w-8 place-items-center hover:bg-[#f2eadc]"><Minus className="size-3.5" /></button>
            <span className="w-12 text-center text-[11px] tabular-nums text-[#675a48]">{zoom}%</span>
            <button type="button" onClick={() => setZoomSafe(zoom + 10)} aria-label="放大导图" className="grid h-full w-8 place-items-center hover:bg-[#f2eadc]"><Plus className="size-3.5" /></button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void workspaceRef.current?.requestFullscreen();
            }}
            aria-label="全屏查看导图"
            className="grid size-8 place-items-center rounded-lg border border-[#d2c4b0] bg-white/70 hover:bg-white"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="relative min-h-0 overflow-hidden border-r border-[#d8cbb8]">
          <div
            ref={scrollerRef}
            className="thin-scroll h-full overflow-auto overscroll-contain"
            onWheel={(event) => {
              if (!event.ctrlKey) return;
              event.preventDefault();
              setZoomSafe(zoom + (event.deltaY < 0 ? 10 : -10));
            }}
          >
            <div
              className="relative mx-auto origin-center transition-transform duration-150"
              style={{
                width: CANVAS_WIDTH,
                height: layout.canvasHeight,
                transform: `scale(${zoom / 100})`,
                marginBlock: `${Math.max(20, (layout.canvasHeight * (zoom / 100 - 1)) / 2 + 20)}px`,
              }}
            >
              <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${CANVAS_WIDTH} ${layout.canvasHeight}`} fill="none">
                {layout.connectors.map((connector) => (
                  <path key={connector.key} d={connector.path} stroke={connector.color} strokeWidth={connector.width} strokeLinecap="round" opacity="0.84" />
                ))}
              </svg>

              <button
                type="button"
                onClick={() => setSelectedKey("root")}
                className={cn(
                  "absolute flex flex-col items-center justify-center rounded-2xl border-2 border-[#6c5436] bg-[#352a1e] px-5 text-center text-[#fff8ea] shadow-[0_12px_30px_rgba(58,42,25,0.24)] outline-none transition-transform focus-visible:ring-2 focus-visible:ring-[#d9aa65]",
                  selectedKey === "root" && "-translate-y-0.5 ring-2 ring-[#d49a47]/55"
                )}
                style={{ left: layout.rootX, top: layout.rootY, width: ROOT_WIDTH, height: ROOT_HEIGHT }}
                aria-pressed={selectedKey === "root"}
              >
                <BookOpen className="size-8 text-[#ead9b8]" />
                <span className="mt-2 line-clamp-2 font-display text-xl font-semibold leading-tight">{data.title || title}</span>
                <span className="mt-2 text-[10px] text-[#d5c5aa]">{nodes.length} 个一级分支 · {flatNodes.length} 个知识节点</span>
              </button>

              {layout.positioned.map((item) => (
                <MapNodeCard
                  key={item.key}
                  item={item}
                  selected={selectedKey === item.key}
                  highlighted={highlightedKeys.has(item.key)}
                  expanded={expanded.has(item.key)}
                  onSelect={() => setSelectedKey(item.key)}
                  onToggle={() => toggleExpanded(item.parentKey ?? item.key)}
                />
              ))}

            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex w-72 items-end gap-2 rounded-2xl border border-[#d8c7ae] bg-[#fffaf1]/95 p-2.5 shadow-[0_8px_24px_rgba(79,56,31,0.12)] backdrop-blur-sm">
            <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-[#f7f1e6]">
              <Image src="/brand/animals/red-panda-mindmap-guide.png" alt="小浣熊导图老师" fill sizes="80px" className="object-contain" />
            </div>
            <p className="pb-1 text-[11px] leading-5 text-[#66533d]">选中任意节点，查看结构、关联资料，并让浣熊老师结合当前知识点讲解。</p>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-full border border-[#d4c5af] bg-[#fffaf1]/90 px-3 py-1.5 text-[10px] text-[#786a56] shadow-sm md:flex">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#352a1e]" />中心主题</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#bd7452]" />一级分支</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-[#d4c6b3]" />具体知识点</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full ring-2 ring-[#c18a3b]" />当前节点</span>
          </div>
        </div>

        <aside className="thin-scroll min-h-0 overflow-y-auto bg-[#fbf7ee] p-3 lg:block">
          <div className="flex items-start justify-between gap-3 border-b border-[#ddd0bc] pb-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.12em] text-[#8d6b3b]">当前知识节点</div>
              <h3 className="mt-1 truncate font-display text-xl font-semibold">{selectedLabel}</h3>
            </div>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#d2c4b0] bg-white/70"><Target className="size-4 text-[#8b6029]" /></span>
          </div>

          <section className="mt-3 rounded-xl border border-[#d8cbb8] bg-[#fffdf8] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5 text-[#a66d28]" />知识说明</div>
            <p className="mt-2 text-[12.5px] leading-6 text-[#5f5140]">{semanticDescription(selectedNode, selectedKey === "root")}</p>
          </section>

          <section className="mt-3 rounded-xl border border-[#d8cbb8] bg-[#fffdf8] p-3.5">
            <div className="flex items-center justify-between text-xs font-semibold"><span>学习状态</span><span className="rounded-full bg-[#f2e6d2] px-2 py-1 text-[10px] text-[#8b6029]">{statusOf(selectedNode)}</span></div>
            {masteryOf(selectedNode) !== null ? (
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-[#776a58]"><span>掌握度</span><strong>{masteryOf(selectedNode)}%</strong></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e8dfd1]"><div className="h-full rounded-full bg-[#77906e]" style={{ width: `${masteryOf(selectedNode)}%` }} /></div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-5 text-[#7f725f]">完成关联讲义与配套练习后，这里会显示真实掌握情况。</p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected?.parentLabel && <span className="rounded-md border border-[#d8cbb8] bg-[#f7f0e5] px-2 py-1 text-[10px]">上级：{selected.parentLabel}</span>}
              <span className="rounded-md border border-[#d8cbb8] bg-[#f7f0e5] px-2 py-1 text-[10px]">{selectedChildren.length} 个直接子节点</span>
            </div>
          </section>

          {selectedChildren.length > 0 && (
            <section className="mt-3 rounded-xl border border-[#d8cbb8] bg-[#fffdf8] p-3.5">
              <div className="text-xs font-semibold">下级知识点</div>
              <div className="mt-2 space-y-1.5">
                {selectedChildren.slice(0, 5).map((child, index) => {
                  const childEntry = flatNodes.find((entry) => entry.node === child);
                  return (
                    <button key={childEntry?.key ?? index} type="button" onClick={() => childEntry && setSelectedKey(childEntry.key)} className="flex w-full items-center justify-between rounded-lg border border-[#e0d5c5] bg-[#faf5ec] px-2.5 py-2 text-left text-[11px] hover:border-[#bd8a48] hover:bg-white">
                      <span className="truncate">{child.label}</span><ChevronRight className="size-3.5 shrink-0 text-[#8d7d68]" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-3 rounded-xl border border-[#d8cbb8] bg-[#fffdf8] p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold"><GraduationCap className="size-3.5 text-[#8a602c]" />关联学习动作</div>
            <div className="mt-2.5 space-y-2">
              <button type="button" onClick={() => onOpenResource(selectedLabel)} className="flex w-full items-center justify-between rounded-lg border border-[#d6c6ae] bg-[#fffaf1] px-3 py-2.5 text-left text-xs font-medium hover:border-[#b67b35] hover:bg-white"><span className="flex items-center gap-2"><BookOpen className="size-3.5 text-[#9b6230]" />打开相关讲义</span><ChevronRight className="size-3.5" /></button>
              <button
                type="button"
                onClick={() => void onOpenPractice(selectedLabel)}
                disabled={practiceGenerating}
                aria-busy={practiceGenerating}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border border-[#d6c6ae] bg-[#fffaf1] px-3 py-2.5 text-left text-xs font-medium hover:border-[#b67b35] hover:bg-white",
                  practiceGenerating && "cursor-wait opacity-65 hover:border-[#d6c6ae] hover:bg-[#fffaf1]",
                )}
              >
                <span className="flex items-center gap-2">
                  {practiceGenerating
                    ? <Loader2 className="size-3.5 animate-spin text-[#7b8b68]" />
                    : <Target className="size-3.5 text-[#7b8b68]" />}
                  {practiceGenerating ? "正在生成题目…" : "开始配套练习"}
                </span>
                {!practiceGenerating && <ChevronRight className="size-3.5" />}
              </button>
            </div>
            {practiceError && <p className="mt-2 text-[11px] leading-5 text-[#9f3a30]" role="alert">{practiceError}</p>}
          </section>

          <div className="mt-3 overflow-hidden rounded-xl border border-[#c58b45] bg-[#8a571f] text-[#fffaf0]">
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="relative size-10 shrink-0 overflow-hidden rounded-full border border-white/30 bg-[#eadbc5]">
                <Image src="/brand/animals/red-panda-mindmap-guide.png" alt="浣熊老师" fill sizes="40px" className="object-contain" />
              </div>
              <div className="min-w-0 flex-1"><div className="text-xs font-semibold">还没看懂这个节点？</div><p className="mt-0.5 text-[10px] text-white/75">带着导图上下文继续问</p></div>
            </div>
            <button type="button" onClick={() => onAskTeacher(selectedLabel)} className="flex w-full items-center justify-center gap-2 border-t border-white/15 bg-black/10 px-3 py-2.5 text-xs font-semibold hover:bg-black/20"><MessageSquareText className="size-3.5" />向浣熊老师提问</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
