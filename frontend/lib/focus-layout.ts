import type { FocusGraph } from "./focus-api";
import type { ElkNode } from "elkjs/lib/elk-api";

export type FocusPlacement = { id: string; x: number; y: number; width: number; height: number; kind: "knowledge" | "module" | "root" };
export type FocusLink = { id: string; source: string; target: string; kind: "required" | "alternative" | "recommended" | "related" | "membership"; group?: number };
export type FocusLayout = { placements: FocusPlacement[]; links: FocusLink[] };
const cache = new Map<string, Promise<FocusLayout>>();
export const FOCUS_LAYOUT_VERSION = 3;

export function graphLinks(graph: FocusGraph): FocusLink[] {
  const links: FocusLink[] = [];
  for (const node of graph.nodes) {
    for (const source of node.prerequisites.all_of) links.push({ id: `required:${source}:${node.id}`, source, target: node.id, kind: "required" });
    node.prerequisites.any_of_groups.forEach((group, index) => group.forEach(source => links.push({ id: `alternative:${index}:${source}:${node.id}`, source, target: node.id, kind: "alternative", group: index })));
  }
  graph.relations.forEach((edge, i) => links.push({ ...edge, id: `relation:${i}:${edge.source}:${edge.target}` }));
  return links;
}

export function focusNeighborhood(graph: FocusGraph, selected: string): Set<string> {
  const links = graphLinks(graph);
  return new Set([selected, ...links.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])]);
}

export function layoutFocusGraph(graphId: string, version: number, graph: FocusGraph): Promise<FocusLayout> {
  const key = `${graphId}:${version}:${FOCUS_LAYOUT_VERSION}`;
  const previous = cache.get(key);
  if (previous) return previous;
  const result = calculate(graph);
  cache.set(key, result);
  result.catch(() => cache.delete(key));
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return result;
}

async function calculate(graph: FocusGraph): Promise<FocusLayout> {
  const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
  const elk = new ELK();
  const links = graphLinks(graph);
  // Chapter membership controls grouping, never availability. Each chapter's
  // actual prerequisites determine its internal split/merge layout. Cross-chapter
  // dependencies remain visible edges in the same, continuous canvas.
  const groups = await Promise.all(graph.modules.map(async module => {
    const members = graph.nodes.filter(n => n.module_id === module.id);
    const ids = new Set(members.map(n => n.id));
    const internal = links.filter(e => ids.has(e.source) && ids.has(e.target) && ["required", "alternative"].includes(e.kind));
    const rootNodes = members.filter(n => !internal.some(e => e.target === n.id));
    const edges = [...internal.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      ...rootNodes.map(n => ({ id: `member:${n.id}`, sources: [`module:${module.id}`], targets: [n.id] }))];
    rootNodes.forEach(n => links.push({ id: `member:${n.id}`, source: `module:${module.id}`, target: n.id, kind: "membership" }));
    const layout: ElkNode = await elk.layout({ id: module.id, layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "16", "elk.layered.spacing.nodeNodeBetweenLayers": "25",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", "elk.padding": "[top=0,left=4,bottom=0,right=4]",
    }, children: [{ id: `module:${module.id}`, width: 190, height: 82 }, ...members.map(n => ({ id: n.id, width: 120, height: 70 }))], edges });
    // Wrap wide parallel ranks without creating prerequisite edges. This is
    // purely spatial packing: five independent entries must remain independent.
    const ranks = new Map<number, ElkNode[]>();
    const ordinary = layout.children!.filter(n => !n.id.startsWith("module:"));
    for (const item of ordinary) {
      const rank = Math.round(item.y!);
      ranks.set(rank, [...(ranks.get(rank) || []), item]);
    }
    const standaloneMilestones = members.filter(n => n.kind === "milestone" && !internal.some(e => e.target === n.id || e.source === n.id));
    if (standaloneMilestones.length) {
      const last = Math.max(...ranks.keys()) + 1;
      for (const node of standaloneMilestones) {
        for (const [rank, items] of ranks) ranks.set(rank, items.filter(n => n.id !== node.id));
        ranks.set(last, [...(ranks.get(last) || []), ordinary.find(n => n.id === node.id)!]);
      }
    }
    let top = 116;
    const compact: ElkNode[] = [{ id: `module:${module.id}`, x: 37, y: 0, width: 190, height: 88 }];
    for (const rank of [...ranks.keys()].sort((a, b) => a - b)) {
      const items = ranks.get(rank)!.sort((a, b) => a.x! - b.x!);
      if (!items.length) continue;
      items.forEach((item, i) => {
        const single = items.length % 2 === 1 && i === items.length - 1;
        compact.push({ id: item.id, x: single ? 72 : i % 2 * 144, y: top + Math.floor(i / 2) * 118, width: 120, height: 94 });
      });
      top += Math.ceil(items.length / 2) * 118;
    }
    return { ...layout, children: compact, width: 264, height: top - 24 };
  }));
  // Pack arbitrary chapter counts with ELK, rather than encoding six lanes or
  // deriving columns from a learner's daily schedule.
  const outer = await elk.layout({ id: "course", layoutOptions: {
    "elk.algorithm": "layered", "elk.direction": "DOWN", "elk.spacing.nodeNode": "16",
    "elk.layered.spacing.nodeNodeBetweenLayers": "32", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  }, children: [{ id: "course:root", width: 270, height: 94 }, ...groups.map(g => ({ id: g.id, width: g.width!, height: g.height! }))],
    edges: groups.map(g => ({ id: `chapter:${g.id}`, sources: ["course:root"], targets: [g.id] })) });
  const placements: FocusPlacement[] = [];
  const root = outer.children!.find(n => n.id === "course:root")!;
  const graphWidth = Math.max(...outer.children!.filter(n => n.id !== root.id).map(n => n.x! + n.width!));
  placements.push({ id: root.id, x: (graphWidth - 270) / 2, y: root.y!, width: 270, height: 94, kind: "root" });
  for (const group of groups) {
    const offset = outer.children!.find(n => n.id === group.id)!;
    for (const n of group.children!) placements.push({ id: n.id, x: offset.x! + n.x!, y: offset.y! + n.y!, width: n.width!, height: n.height!, kind: n.id.startsWith("module:") ? "module" : "knowledge" });
    links.push({ id: `chapter:${group.id}`, source: root.id, target: `module:${group.id}`, kind: "membership" });
  }
  return { placements, links };
}
