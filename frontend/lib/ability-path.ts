import { buildDailyTaskPlan, QUIZ_PASS_SCORE, resourceCompletionKey, type DailyTaskItem } from "./daily-task-plan.ts";
import type { PathStep, ResourceItem } from "./types.ts";

export interface AbilityEvidence {
  kind: "resource_read" | "quiz_submission" | "written_response";
  content: string;
  completedAt: string;
  passed?: boolean;
  score?: number;
  verifiedAt?: string;
}
export interface AbilityCourse {
  id: string;
  title: string;
  path: PathStep[];
  dailyMinutes?: number;
  paused?: boolean;
}
export type AbilityStatus = "passed" | "current" | "available" | "locked";
export interface AbilityNode {
  id: string;
  courseId: string;
  courseTitle: string;
  index: number;
  step: PathStep;
  module: string;
  kind: NonNullable<PathStep["node_kind"]>;
  tasks: DailyTaskItem[];
  minutes: number;
  weight: number;
  completedTasks: number;
  status: AbilityStatus;
  verification: "passed" | "failed" | "pending" | "unprepared";
  reviewDue: boolean;
  unresolved: string[];
  depth: number;
  x: number;
  y: number;
  paused: boolean;
  chapterId?: string;
  chapterTitle?: string;
  knowledgeId?: string;
}
export interface AbilityEdge { from: string; to: string; recommended: boolean }
export interface AbilityTree {
  nodes: AbilityNode[];
  edges: AbilityEdge[];
  width: number;
  height: number;
  passedCount: number;
  mainCount: number;
  progress: number;
  currentId?: string;
}
export const ABILITY_WIDTH = 192;
export const ABILITY_HEIGHT = 198;
export const ABILITY_STATUS_LABEL: Record<AbilityStatus, string> = {
  passed: "已通过", current: "进行中", available: "可开始", locked: "未满足前置",
};
export const ABILITY_KIND_LABEL: Record<AbilityNode["kind"], string> = {
  main: "主线", reinforcement: "补强", extension: "拓展", milestone: "阶段验收",
};

const term = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[\s，。；、：:·—_（）()\[\]]/g, "").replace(/^(掌握|理解|学习)/, "");
export function abilityNodeId(courseId: string, step: PathStep, index: number): string {
  return `${courseId}/${step.node_id || step.steps?.[0]?.completion_key || `${step.day}-${index}`}`;
}

/** Old clients wrote passed=true for any submission. Read an actual grade instead. */
export function evidenceGrade(evidence?: AbilityEvidence): number | undefined {
  if (!evidence || evidence.kind !== "quiz_submission") return undefined;
  if (Number.isFinite(evidence.score)) return Math.max(0, Math.min(100, evidence.score!));
  const match = /(?:得分|分数)\s*[:：]?\s*(\d+(?:\.\d+)?)/u.exec(evidence.content);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) : undefined;
}

export function mergeAbilityEvidence(
  previous: AbilityEvidence | undefined,
  next: AbilityEvidence,
): AbilityEvidence {
  const grade = evidenceGrade(next);
  const previousGrade = evidenceGrade(previous);
  // A later review failure does not erase the fact that this ability was passed.
  const verifiedAt = previous?.verifiedAt
    || (previousGrade !== undefined && previousGrade >= QUIZ_PASS_SCORE ? previous!.completedAt : undefined)
    || (grade !== undefined && grade >= QUIZ_PASS_SCORE ? next.completedAt : undefined);
  return { ...next, ...(verifiedAt ? { verifiedAt } : {}) };
}

function taskEvidence(task: DailyTaskItem, evidence: Record<string, AbilityEvidence>, owners: Map<string, number>): AbilityEvidence[] {
  return [task.key, ...task.resourceTargets.filter((target) => target.type === "quiz" && (!target.id || (owners.get(target.id) ?? 0) <= 1)).map((target) => target.id ? resourceCompletionKey(target.id) : target.key)]
    .map((key) => evidence[key]).filter((item): item is AbilityEvidence => Boolean(item));
}

export function resolveAbilityResource(task: DailyTaskItem, resources: ResourceItem[]): ResourceItem | undefined {
  // Never attach a random resource of the same media type to a different skill.
  for (const target of task.resourceTargets) {
    const resource = target.id
      ? resources.find((item) => item.id === target.id && item.status === "ready")
      : target.title ? resources.find((item) => item.title === target.title && item.type === target.type && item.status === "ready") : undefined;
    if (resource) return resource;
  }
  return undefined;
}

export function buildAbilityTree(
  courses: AbilityCourse[],
  completedKeys: string[] = [],
  evidence: Record<string, AbilityEvidence> = {},
): AbilityTree {
  const quizOwners = new Map<string, number>();
  for (const course of courses) for (const step of course.path) {
    const ids = new Set((step.steps || []).flatMap((task) => (task.resources || []).filter((item) => item.type === "quiz").map((item) => item.id)));
    for (const id of ids) quizOwners.set(id, (quizOwners.get(id) || 0) + 1);
  }
  const nodes: AbilityNode[] = courses.flatMap((course) => course.path.map((step, index) => {
    const plan = buildDailyTaskPlan(step, index, completedKeys);
    const tasks = plan.tasks.map((task) => {
      const read = task.completionKind === "resource_read" && (
        evidence[task.key]?.kind === "resource_read" ||
        (task.resourceTargets.length > 0 && task.resourceTargets.every((target) =>
          Boolean(evidence[target.id ? resourceCompletionKey(target.id) : target.key]),
        ))
      );
      return { ...task, completed: task.completed || read };
    });
    const tests = tasks.filter((task) => task.completionKind === "quiz_submission");
    const results = tests.map((task) => taskEvidence(task, evidence, quizOwners));
    const passed = tests.length > 0 && results.every((items) => items.some((item) =>
      Boolean(item.verifiedAt) || (evidenceGrade(item) ?? -1) >= QUIZ_PASS_SCORE,
    ));
    const failed = results.some((items) => items.some((item) => {
      const grade = evidenceGrade(item);
      return grade !== undefined && grade < QUIZ_PASS_SCORE;
    }));
    const minutes = Math.max(1, plan.totalMinutes || 30);
    return {
      id: abilityNodeId(course.id, step, index), courseId: course.id, courseTitle: course.title,
      index, step, module: step.module || `${course.title} · 第 ${Math.floor(index / 5) + 1} 组`,
      kind: step.node_kind || "main", tasks, minutes,
      weight: Math.max(1, step.progress_weight || minutes),
      completedTasks: tasks.filter((task) => task.completed).length,
      status: passed ? "passed" : "available",
      verification: passed ? "passed" : failed ? "failed" : tests.length ? "pending" : "unprepared",
      reviewDue: passed && failed,
      unresolved: [], depth: 0, x: 0, y: 0, paused: Boolean(course.paused),
    } satisfies AbilityNode;
  }));
  const edges: AbilityEdge[] = [];
  for (const node of nodes) {
    const match = (label: string): AbilityNode | undefined => {
      const key = term(label);
      const candidates = nodes.filter((other) => other.id !== node.id &&
        [other.step.node_id, other.step.title, ...(other.step.knowledge_points || [])]
          .some((value) => value && term(value) === key));
      const local = candidates.filter((other) => other.courseId === node.courseId);
      return local.length === 1 ? local[0] : local.length === 0 && candidates.length === 1 ? candidates[0] : undefined;
    };
    for (const [labels, recommended] of [
      [node.step.prerequisites || [], false],
      [node.step.recommended_prerequisites || [], true],
    ] as const) {
      for (const label of labels) {
        const parent = match(label);
        if (parent) edges.push({ from: parent.id, to: node.id, recommended });
        else if (!recommended) node.unresolved.push(label);
      }
    }
    if (!node.step.prerequisites?.length && !node.step.recommended_prerequisites?.length) {
      const previous = nodes.find((other) => other.courseId === node.courseId && other.index === node.index - 1);
      // Legacy content has an order, not a verified pedagogical dependency.
      if (previous) edges.push({ from: previous.id, to: node.id, recommended: true });
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const parents = edges.filter((edge) => edge.to === node.id);
      if (!parents.every((edge) => visited.has(edge.from))) continue;
      node.depth = parents.length ? Math.max(...parents.map((edge) => byId.get(edge.from)!.depth + 1)) : 0;
      visited.add(node.id); changed = true;
    }
    if (!changed) break;
  }
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      node.unresolved.push("前置关系存在循环，请调整路径");
      node.depth = node.index;
    }
    if (node.status === "passed") continue;
    const required = edges.filter((edge) => edge.to === node.id && !edge.recommended);
    const requiredResults = required.map((edge) => byId.get(edge.from)?.verification === "passed");
    const ready = node.step.prerequisite_mode === "any"
      ? requiredResults.some(Boolean) || (requiredResults.length === 0 && node.unresolved.length === 0)
      : node.unresolved.length === 0 && requiredResults.every(Boolean);
    node.status = ready ? "available" : "locked";
  }
  const current = nodes.find((node) => !node.paused && node.status === "available" && node.completedTasks > 0)
    || nodes.find((node) => !node.paused && node.status === "available" && node.kind !== "extension")
    || nodes.find((node) => !node.paused && node.status === "available");
  if (current) current.status = "current";
  const maxPeers = Math.max(1, ...nodes.map((node) => nodes.filter((other) => other.depth === node.depth).length));
  const width = Math.max(720, maxPeers * 240 + 48);
  for (const node of nodes) {
    const peers = nodes.filter((other) => other.depth === node.depth);
    node.x = (width - (peers.length - 1) * 240 - ABILITY_WIDTH) / 2 + peers.indexOf(node) * 240;
    node.y = 24 + node.depth * 252;
  }
  const main = nodes.filter((node) => node.kind === "main" || node.kind === "milestone");
  const totalWeight = main.reduce((sum, node) => sum + node.weight, 0);
  return {
    nodes, edges, width, height: Math.max(480, (Math.max(0, ...nodes.map((node) => node.depth)) + 1) * 252 + 28),
    passedCount: main.filter((node) => node.status === "passed").length, mainCount: main.length,
    progress: totalWeight ? Math.round(main.filter((node) => node.status === "passed").reduce((sum, node) => sum + node.weight, 0) / totalWeight * 100) : 0,
    currentId: current?.id,
  };
}

export function abilityStudyHref(node: AbilityNode, verify = false, taskKey?: string): string {
  const query = new URLSearchParams({ course: node.courseId, node: node.chapterId || node.id });
  if (node.knowledgeId) query.set("knowledge", node.knowledgeId);
  if (verify) query.set("verify", "1");
  if (taskKey) query.set("task", taskKey);
  return `/desktop/path/study/?${query}`;
}

export function abilityCoursesFromSubjects(
  subjects: Array<{ id: string; title: string; path: PathStep[]; capabilityPath?: PathStep[]; dailyMinutes: number; controlStatus: string; status: string }>,
  fallback: PathStep[],
): AbilityCourse[] {
  return subjects.length ? subjects.map((subject) => ({
    id: subject.id, title: subject.title, path: subject.capabilityPath ?? subject.path,
    dailyMinutes: subject.dailyMinutes,
    paused: subject.controlStatus !== "active" && subject.status !== "completed",
  })) : [{ id: "master", title: "当前课程", path: fallback, dailyMinutes: 60 }];
}

/** A queue respects the budget and carries unfinished work forward, independently of dates. */
export function buildAbilityTodayQueue(tree: AbilityTree, dailyMinutes = 60) {
  const budget = Math.max(10, Math.min(480, dailyMinutes));
  let remaining = budget;
  const ordered = [...tree.nodes].sort((a, b) =>
    Number(b.reviewDue) - Number(a.reviewDue) || Number(b.status === "current") - Number(a.status === "current") || a.depth - b.depth,
  );
  const entries: Array<{ node: AbilityNode; task: DailyTaskItem; minutes: number; continues: boolean; review: boolean }> = [];
  const used = new Set<string>();
  for (const node of ordered) {
    if (node.paused || node.status === "locked" || node.kind === "extension" || (node.status === "passed" && !node.reviewDue)) continue;
    const tasks = node.reviewDue ? node.tasks.filter((task) => task.completionKind === "quiz_submission") : node.tasks.filter((task) => !task.completed);
    // A submitted failed quiz is a finished task, but still needs another verification attempt.
    if (!tasks.length && node.verification !== "passed") tasks.push(...node.tasks.filter((task) => task.completionKind === "quiz_submission"));
    for (const task of tasks) {
      if (remaining <= 0 || used.has(task.key)) continue;
      const minutes = Math.min(remaining, Math.max(1, task.minutes));
      entries.push({ node, task, minutes, continues: minutes < task.minutes, review: node.reviewDue });
      remaining -= minutes; used.add(task.key);
    }
  }
  return { entries, budget, plannedMinutes: budget - remaining };
}
