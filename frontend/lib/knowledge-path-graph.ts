import type { PathStep } from "./types.ts";

export const KNOWLEDGE_NODE_WIDTH = 144;
export const KNOWLEDGE_NODE_HEIGHT = 174;

export interface KnowledgeGraphNode {
  id: string;
  index: number;
  step: PathStep;
  column: number;
  lane: number;
  x: number;
  y: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  from: string;
  to: string;
  inferred: boolean;
}

export interface KnowledgePathGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  width: number;
  height: number;
  usesExplicitPrerequisites: boolean;
}

function normalizeKnowledge(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s，。；、：:·・\-—_（）()\[\]]+/g, "")
    .replace(/(?:基础|入门|进阶|学习|掌握|理解|应用|方法|知识点)$/u, "")
    .trim();
}

function stepTerms(step: PathStep): string[] {
  return [step.title, ...(step.knowledge_points ?? [])]
    .map(normalizeKnowledge)
    .filter(Boolean);
}

function matchPrerequisite(
  prerequisite: string,
  priorSteps: readonly PathStep[],
): number | null {
  const needle = normalizeKnowledge(prerequisite);
  if (!needle) return null;
  let bestIndex: number | null = null;
  let bestScore = 0;
  priorSteps.forEach((step, index) => {
    const score = Math.max(
      ...stepTerms(step).map((term) => {
        if (term === needle) return 4;
        if (term.includes(needle) || needle.includes(term)) return 3;
        const shared = Array.from(needle).filter((char) => term.includes(char)).length;
        return shared >= Math.min(3, needle.length) ? 1 : 0;
      }),
      0,
    );
    if (score >= bestScore && score > 0) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function uniqueEdges(edges: KnowledgeGraphEdge[]): KnowledgeGraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackEdges(ids: string[]): KnowledgeGraphEdge[] {
  if (ids.length < 6) {
    return ids.slice(1).map((id, index) => ({
      id: `edge-${ids[index]}-${id}`,
      from: ids[index],
      to: id,
      inferred: true,
    }));
  }

  const edges: KnowledgeGraphEdge[] = [{
    id: `edge-${ids[0]}-${ids[1]}`,
    from: ids[0],
    to: ids[1],
    inferred: true,
  }];
  const branchIds = ids.slice(2, -2);
  const lanes = [branchIds.filter((_, index) => index % 2 === 0), branchIds.filter((_, index) => index % 2 === 1)]
    .filter((lane) => lane.length > 0);
  const mergeId = ids.at(-2)!;
  const goalId = ids.at(-1)!;
  lanes.forEach((lane) => {
    edges.push({ id: `edge-${ids[1]}-${lane[0]}`, from: ids[1], to: lane[0], inferred: true });
    lane.slice(1).forEach((id, index) => {
      edges.push({ id: `edge-${lane[index]}-${id}`, from: lane[index], to: id, inferred: true });
    });
    edges.push({ id: `edge-${lane.at(-1)}-${mergeId}`, from: lane.at(-1)!, to: mergeId, inferred: true });
  });
  edges.push({ id: `edge-${mergeId}-${goalId}`, from: mergeId, to: goalId, inferred: true });
  return edges;
}

export function buildKnowledgePathGraph(path: readonly PathStep[]): KnowledgePathGraph {
  const ids = path.map((step, index) => `${step.day || "node"}-${index}`);
  const usesExplicitPrerequisites = path.some((step) => (step.prerequisites?.length ?? 0) > 0);
  const explicitEdges: KnowledgeGraphEdge[] = [];

  if (usesExplicitPrerequisites) {
    path.forEach((step, index) => {
      if (index === 0) return;
      const matched = (step.prerequisites ?? [])
        .map((item) => matchPrerequisite(item, path.slice(0, index)))
        .filter((value): value is number => value !== null);
      const parents = matched.length > 0 ? Array.from(new Set(matched)) : [index - 1];
      parents.forEach((parentIndex) => {
        explicitEdges.push({
          id: `edge-${ids[parentIndex]}-${ids[index]}`,
          from: ids[parentIndex],
          to: ids[index],
          inferred: matched.length === 0,
        });
      });
    });
  }

  const edges = uniqueEdges(usesExplicitPrerequisites ? explicitEdges : fallbackEdges(ids));
  const columns = ids.map(() => 0);
  ids.forEach((id, index) => {
    if (index === 0) return;
    const parents = edges
      .filter((edge) => edge.to === id)
      .map((edge) => ids.indexOf(edge.from))
      .filter((parentIndex) => parentIndex >= 0 && parentIndex < index);
    columns[index] = parents.length > 0
      ? Math.max(...parents.map((parentIndex) => columns[parentIndex] + 1))
      : columns[index - 1] + 1;
  });

  const groups = new Map<number, number[]>();
  columns.forEach((column, index) => groups.set(column, [...(groups.get(column) ?? []), index]));
  const largestGroup = Math.max(1, ...Array.from(groups.values()).map((group) => group.length));
  const rowGap = 440;
  const columnGap = 178;
  const height = Math.max(
    520,
    (largestGroup - 1) * rowGap + KNOWLEDGE_NODE_HEIGHT + 88,
  );
  const nodes: KnowledgeGraphNode[] = path.map((step, index) => {
    const column = columns[index];
    const peers = groups.get(column) ?? [index];
    const peerIndex = peers.indexOf(index);
    const lane = peerIndex - (peers.length - 1) / 2;
    return {
      id: ids[index],
      index,
      step,
      column,
      lane,
      x: 32 + column * columnGap,
      y: (height - KNOWLEDGE_NODE_HEIGHT) / 2 + lane * rowGap,
    };
  });
  const maxColumn = Math.max(0, ...columns);

  return {
    nodes,
    edges,
    width: Math.max(760, 64 + maxColumn * columnGap + KNOWLEDGE_NODE_WIDTH),
    height,
    usesExplicitPrerequisites,
  };
}
