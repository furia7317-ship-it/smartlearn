import { ABILITY_HEIGHT, ABILITY_WIDTH, type AbilityNode, type AbilityTree } from "./ability-path.ts";
import type { PathKnowledgeNode, PathKnowledgeRelation, PathStep } from "./types.ts";

export interface KnowledgePathNode extends AbilityNode {
  chapterId: string;
  chapterTitle: string;
  knowledgeId: string;
  sharedChapter: true;
  visible: boolean;
}

export interface KnowledgeChapter {
  id: string;
  title: string;
  index: number;
  source: AbilityNode;
  nodes: KnowledgePathNode[];
  expanded: boolean;
  y: number;
  height: number;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  kind: "membership" | "prerequisite" | "related";
  label: string;
  path: string;
}

const normalize = (value: string) => value.normalize("NFKC").replace(/[\s，。；、：:·—_（）()]/g, "").toLowerCase();
const clean = (value: string) => value.trim()
  .replace(/^(?:通过.+?(?:建立|理解|掌握)|建立|掌握|理解|分析|比较|区分|熟悉|学习|完成|整理)/, "")
  .replace(/(?:直觉|的区别|的核心区别|等典型应用|及典型应用)$/, "").trim();
const split = (value: string) => value.split(/(?:以及|并且|并(?=比较|区分|掌握|理解|分析|完成|整理)|与|和|及|、|，|；|,|;)/).map(clean).filter(Boolean);

/** Old saves have a title and objective, but often no separate concept list. */
export function chapterKnowledge(step: PathStep): { points: PathKnowledgeNode[]; relations: PathKnowledgeRelation[]; inferred: boolean } {
  if (step.knowledge_nodes?.length) {
    const seen = new Set<string>();
    const points = step.knowledge_nodes.filter((point) => {
      if (!point.id || !point.title || seen.has(point.id)) return false;
      seen.add(point.id); return true;
    });
    if (points.length) return { points, relations: step.knowledge_relations || [], inferred: false };
  }
  const explicit = step.knowledge_points?.filter((point) => point.trim()) || [];
  let labels = explicit.length ? explicit : [...split(step.title), ...split(step.objective || step.desc || "")];
  // Restore the shared suffix in literal parallel phrases, e.g. 归并与快速排序.
  if (!explicit.length) {
    const suffix = /(排序|复杂度|回归|分布|方程)$/.exec(step.title)?.[1];
    const titleParts = split(step.title);
    if (suffix && titleParts.length > 1) labels = labels.map((label) => titleParts.includes(label) && !label.endsWith(suffix) ? `${label}${suffix}` : label);
    if (labels.some((label) => label.endsWith("复杂度"))) labels = labels.map((label) => /^(时间|空间)$/.test(label) ? `${label}复杂度` : label);
  }
  const seen = new Set<string>();
  labels = labels.filter((label) => label.length <= 36 && !/^(典型应用|应用|基本概念|学习重点|阶段测验|错题)$/.test(label) && !seen.has(normalize(label)) && Boolean(seen.add(normalize(label))));
  // Do not repeat the complete chapter title as a child if more specific concepts exist.
  if (labels.length > 1) labels = labels.filter((label) => normalize(label) !== normalize(step.title));
  if (!labels.length) labels = [step.title];
  const points = labels.slice(0, 12).map((title) => ({ id: `topic-${encodeURIComponent(normalize(title))}`, title }));
  const relations = [...(step.knowledge_relations || [])];
  const comparison = /(?:比较|区分)([^。；]+)/.exec(step.objective || step.desc || "")?.[1];
  if (comparison && !relations.length) {
    const compared = points.filter((point) => split(comparison).some((label) => normalize(point.title) === normalize(label) || normalize(point.title).startsWith(normalize(label))));
    for (let i = 1; i < compared.length; i++) relations.push({ from: compared[i - 1].id, to: compared[i].id, kind: "related", label: "对比" });
  }
  return { points, relations, inferred: !explicit.length };
}

/** Chapters own scheduling/evidence. Their knowledge children are not duplicated tasks. */
export function buildChapterKnowledgeGraph(base: AbilityTree, expandedIds?: readonly string[] | null) {
  const expanded = new Set(expandedIds ?? [base.currentId || base.nodes[0]?.id]);
  const nodes: KnowledgePathNode[] = [];
  const definitions = new Map<string, ReturnType<typeof chapterKnowledge>>();
  const chapters: KnowledgeChapter[] = base.nodes.map((source, index) => {
    const definition = chapterKnowledge(source.step);
    definitions.set(source.id, definition);
    const children: KnowledgePathNode[] = definition.points.map((point) => ({
      ...source, id: `${source.id}/knowledge/${point.id}`, chapterId: source.id,
      chapterTitle: source.step.title, knowledgeId: point.id, sharedChapter: true,
      visible: expanded.has(source.id),
      step: { ...source.step, title: point.title, objective: point.objective || `本知识点属于「${source.step.title}」。本章目标：${source.step.objective || source.step.desc}`, knowledge_points: [point.title] },
      x: 0, y: 0, depth: 0,
    }));
    nodes.push(...children);
    return { id: source.id, title: source.step.title, index, source, nodes: children, expanded: expanded.has(source.id), y: 0, height: 0 };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const semantic: Omit<KnowledgeEdge, "path">[] = [];
  const edgeKeys = new Set<string>();
  for (const chapter of chapters) {
    const resolve = (label: string) => {
      const exact = nodes.filter((node) => node.knowledgeId === label || normalize(node.step.title) === normalize(label));
      const local = exact.filter((node) => node.chapterId === chapter.id);
      return local.length === 1 ? local[0] : exact.length === 1 ? exact[0] : undefined;
    };
    for (const relation of definitions.get(chapter.id)!.relations) {
      const from = resolve(relation.from), to = resolve(relation.to);
      if (!from || !to || from.id === to.id) continue;
      const key = relation.kind === "related" ? [from.id, to.id].sort().join("|") : `${from.id}|${to.id}`;
      if (edgeKeys.has(`${relation.kind}:${key}`)) continue;
      edgeKeys.add(`${relation.kind}:${key}`);
      semantic.push({ from: from.id, to: to.id, kind: relation.kind, label: relation.label || (relation.kind === "prerequisite" ? "前置知识" : "知识关联") });
    }
  }

  const width = Math.max(800, Math.min(4, Math.max(1, ...chapters.map((chapter) => chapter.nodes.length))) * 228 + 64);
  let cursor = 20;
  const edges: KnowledgeEdge[] = [];
  for (const chapter of chapters) {
    chapter.y = cursor;
    if (!chapter.expanded) { chapter.height = 82; cursor += 104; continue; }
    const localEdges = semantic.filter((edge) => edge.kind === "prerequisite" && byId.get(edge.from)!.chapterId === chapter.id && byId.get(edge.to)!.chapterId === chapter.id);
    const placed = new Set<string>();
    for (let round = 0; round < chapter.nodes.length; round++) {
      for (const node of chapter.nodes) {
        if (placed.has(node.id)) continue;
        const parents = localEdges.filter((edge) => edge.to === node.id);
        if (parents.some((edge) => !placed.has(edge.from))) continue;
        node.depth = parents.length ? Math.max(...parents.map((edge) => byId.get(edge.from)!.depth + 1)) : 0;
        placed.add(node.id);
      }
    }
    // Cycles remain visible as relations; they never fabricate an unlock condition.
    for (const node of chapter.nodes) if (!placed.has(node.id)) node.depth = 0;
    let row = 0;
    for (const level of [...new Set(chapter.nodes.map((node) => node.depth))].sort((a, b) => a - b)) {
      const peers = chapter.nodes.filter((node) => node.depth === level);
      for (let start = 0; start < peers.length; start += 4) {
        const batch = peers.slice(start, start + 4);
        batch.forEach((node, index) => {
          node.x = (width - (batch.length - 1) * 228 - ABILITY_WIDTH) / 2 + index * 228;
          node.y = cursor + 120 + row * 236;
        });
        row++;
      }
    }
    chapter.height = 120 + Math.max(1, row) * 236 + 20;
    const roots = chapter.nodes.filter((node) => !localEdges.some((edge) => edge.to === node.id));
    for (const node of roots.length ? roots : chapter.nodes) {
      const x = node.x + ABILITY_WIDTH / 2;
      edges.push({ from: chapter.id, to: node.id, kind: "membership", label: "属于本章", path: `M ${width / 2} ${cursor + 72} V ${cursor + 102} H ${x} V ${node.y + 18}` });
    }
    cursor += chapter.height + 22;
  }
  for (const edge of semantic) {
    const a = byId.get(edge.from)!, b = byId.get(edge.to)!;
    if (!a.visible || !b.visible) continue;
    let path: string;
    if (edge.kind === "related" && a.y === b.y) {
      const left = a.x < b.x ? a : b, right = left === a ? b : a;
      const y = a.y + ABILITY_HEIGHT + 8;
      path = `M ${left.x + ABILITY_WIDTH / 2} ${a.y + ABILITY_HEIGHT} V ${y} H ${right.x + ABILITY_WIDTH / 2} V ${a.y + ABILITY_HEIGHT}`;
    } else {
      const y1 = a.y + ABILITY_HEIGHT, y2 = b.y + 18, middle = (y1 + y2) / 2;
      path = `M ${a.x + ABILITY_WIDTH / 2} ${y1} V ${middle} H ${b.x + ABILITY_WIDTH / 2} V ${y2}`;
    }
    edges.push({ ...edge, path });
  }
  return { nodes, chapters, edges, semanticEdges: semantic, width, height: Math.max(480, cursor), currentId: chapters.find((chapter) => chapter.id === base.currentId)?.nodes[0]?.id || nodes[0]?.id };
}

export function chapterStatus(node: KnowledgePathNode) {
  return node.status === "passed" ? "本章已通过" : node.status === "current" ? "本章学习中" : node.status === "locked" ? "本章待解锁" : "可学习";
}
