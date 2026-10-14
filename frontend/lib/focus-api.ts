import { API_BASE, markBackendReachable } from "./api";

export type FocusStatus = "available" | "locked" | "active" | "paused" | "passed";
export type FocusModule = { id: string; title: string; description: string; color: string };
export type FocusNode = {
  id: string; title: string; module_id: string; objective: string; knowledge_point_ids: string[];
  prerequisites: { all_of: string[]; any_of_groups: string[][] };
  kind: "core" | "extension" | "milestone"; estimated_minutes: number; icon: string; source_ids: string[]; completion_rule_id: string;
};
export type FocusGraph = {
  title: string; goal: string; modules: FocusModule[]; nodes: FocusNode[]; knowledge_inventory: string[];
  relations: { source: string; target: string; kind: "recommended" | "related"; reason: string }[];
  sources: { id: string; title: string; url: string }[];
};
export type FocusRecord = { status: FocusStatus; available: boolean; tasks: string[]; passed_at: string | null; review_due: boolean; last_score: number | null };
export type FocusSnapshot = {
  id: string; course_id: string; version: number; origin: string; status: string; graph: FocusGraph;
  revision: number; active_node_id: string | null; nodes: Record<string, FocusRecord>; resources: Record<string, string>;
  progress: { passed: number; total: number };
  plan: { daily_minutes: number; focus_node_id: string | null; tasks: { node_id: string; task: string; title: string; minutes: number; continued?: boolean }[] };
};
export type FocusCourse = { id: string; title: string; version: number; status: string; origin: string };
export type FocusJob = { id: string; title: string; kind: string; status: string; result: { graph_id?: string }; error: string | null };
export type FocusPackage = {
  id: string; graph_id: string; node_id: string; content_version: number; lesson: string; example: string;
  questions: { id: string; stem: string; options: string[] }[]; pass_ratio: number; assessment_scope: string; source_ids: string[];
};
export type PackageResponse = { status: string; package?: FocusPackage; job?: FocusJob };
export type AssessmentResult = { score: number; passed: boolean; questions: { id: string; correct: boolean; answer: string; explanation: string }[] };
export type FocusAction = { action: "start" | "pause" | "task" | "budget" | "submit"; node_id?: string; task?: "lesson" | "example"; daily_minutes?: number; package_version?: number; answers?: Record<string, string> };

export class FocusApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function focusRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}/api/focus${path}`, { credentials: "include", signal,
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  markBackendReachable();
  const result = await response.json();
  if (!response.ok) throw new FocusApiError(typeof result.detail === "string" ? result.detail : "请求未完成，请检查输入后重试。", response.status);
  return result as T;
}
export const loadFocus = (id: string, signal?: AbortSignal) => focusRequest<FocusSnapshot>(`/courses/${encodeURIComponent(id)}`, undefined, signal);
export const performFocusAction = (state: FocusSnapshot, action: FocusAction, requestId = crypto.randomUUID()) =>
  focusRequest<{ state: FocusSnapshot; assessment: AssessmentResult | null }>(`/courses/${state.id}/actions`, { ...action, revision: state.revision, request_id: requestId });
export function focusStudyHref(graphId: string, nodeId: string, task = "lesson") {
  return `/desktop/path/study/?${new URLSearchParams({ graph: graphId, node: nodeId, task })}`;
}
export const FOCUS_LABELS: Record<FocusStatus, string> = { available: "可开始", locked: "待解锁", active: "进行中", paused: "已暂停", passed: "已通过" };
export const RESOURCE_LABELS: Record<string, string> = { unprepared: "按需准备", pending: "等待准备", running: "准备中", ready: "资料已就绪", failed: "准备失败" };
export const FOCUS_COLORS: Record<string, string> = { red: "#924a3d", blue: "#375d70", green: "#3f6b55", brown: "#82603b", purple: "#705586", teal: "#347776" };
