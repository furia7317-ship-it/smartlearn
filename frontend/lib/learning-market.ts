import { API_BASE } from "./api.ts";
import { requireOk } from "./api-error.ts";
import type { SubjectLearningPath } from "./master-learning-path.ts";
import type { ResourcePlanRecord } from "./resource-plan.ts";
import { getStudentId } from "./student-identity.ts";
import type { PathStep, ResourceType } from "./types.ts";

type Mode = "checking" | "live" | "offline";
export type MarketKind = "material" | "bundle" | "learning_path" | "agent";
export type MarketFilter = "all" | MarketKind;

export interface MarketPreviewItem {
  type: ResourceType | "learning_path";
  title: string;
}

export interface MarketListing {
  id: string;
  kind: MarketKind;
  title: string;
  description: string;
  tags: string[];
  author_name: string;
  item_count: number;
  saves: number;
  created_at: string;
  owned: boolean;
  already_imported: boolean;
  preview_items: MarketPreviewItem[];
}

export interface MarketPathSnapshot {
  title: string;
  requestSummary: string;
  dailyMinutes: number;
  path: PathStep[];
}

/**
 * 上架的自建智能体是一份「执行者定义」快照，后端已按键名 + 正文双重脱敏。
 * 注意它只带 output_type（既有 9 种 ResourceType 之一），不能凭空造新类型：
 * 导入后写进计划的是 `task.agent = custom:<id>` + `task.type = output_type`。
 */
export interface MarketAgentSnapshot {
  source_id?: string;
  name: string;
  emoji?: string;
  duty?: string;
  system_prompt?: string;
  output_type: ResourceType;
  knowledge_scope?: string[];
  config?: Record<string, unknown>;
}

export interface PublishMarketInput {
  kind: MarketKind;
  title: string;
  description?: string;
  tags?: string[];
  materialIds?: string[];
  pathSnapshot?: MarketPathSnapshot;
  agentId?: string;
  authorName?: string;
}

export interface MarketImportResult {
  ok: true;
  already_imported: boolean;
  kind: MarketKind;
  target_ids: string[];
  path_snapshot?: MarketPathSnapshot | null;
  agent_snapshot?: MarketAgentSnapshot | null;
  listing: MarketListing;
}

export function subjectToMarketSnapshot(subject: SubjectLearningPath): MarketPathSnapshot {
  return {
    title: subject.title,
    requestSummary: subject.requestSummary,
    dailyMinutes: subject.dailyMinutes,
    path: structuredClone(subject.path),
  };
}

export async function listMarket(
  mode: Mode,
  options: { q?: string; kind?: MarketFilter } = {},
): Promise<MarketListing[]> {
  if (mode !== "live") return [];
  const params = new URLSearchParams({ student_id: getStudentId() });
  if (options.q?.trim()) params.set("q", options.q.trim());
  if (options.kind && options.kind !== "all") params.set("kind", options.kind);
  const response = await requireOk(await fetch(`${API_BASE}/api/market?${params}`, { cache: "no-store" }));
  return (await response.json()) as MarketListing[];
}

export async function publishToMarket(mode: Mode, input: PublishMarketInput): Promise<MarketListing> {
  if (mode !== "live") throw new Error("后端未连接，暂时无法发布到学习市场。");
  const response = await requireOk(await fetch(`${API_BASE}/api/market`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: getStudentId(),
      author_name: input.authorName?.trim() || "学习者",
      kind: input.kind,
      title: input.title,
      description: input.description ?? "",
      tags: input.tags ?? [],
      material_ids: input.materialIds ?? [],
      path_snapshot: input.pathSnapshot ?? null,
      // agent 类只上架一份智能体定义，后端按 agent_id 做归属校验，不需要 material_ids。
      agent_id: input.agentId ?? "",
    }),
  }));
  return (await response.json()) as MarketListing;
}

export async function importFromMarket(mode: Mode, listingId: string): Promise<MarketImportResult> {
  if (mode !== "live") throw new Error("后端未连接，暂时无法添加学习市场资源。");
  const response = await requireOk(await fetch(`${API_BASE}/api/market/${encodeURIComponent(listingId)}/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: getStudentId() }),
  }));
  return (await response.json()) as MarketImportResult;
}

function marketSchedule(path: PathStep[]): Record<string, unknown>[] {
  return path.map((stage, stageIndex) => ({
    day: `D${stageIndex + 1}`,
    title: stage.title,
    objective: stage.objective || stage.desc,
    minutes: stage.minutes,
    steps: (stage.steps ?? []).map((task, taskIndex) => ({
      id: `market-task-${stageIndex + 1}-${taskIndex + 1}`,
      title: task.title,
      detail: task.detail,
      minutes: task.minutes,
      resource_types: task.resource_types,
      kind: task.kind,
      prompts: task.prompts,
      completion_kind: task.completion_kind,
      resources: [],
    })),
  }));
}

/**
 * Convert a market snapshot to a standalone plan record. Its plan ID and title
 * both carry market provenance, so the subject grouper cannot replace a local
 * path that happens to have the same original title.
 */
export function createMarketPathRecord(
  listingId: string,
  authorName: string,
  snapshot: MarketPathSnapshot,
  studentId = typeof window === "undefined" ? "market-import" : getStudentId(),
): ResourcePlanRecord {
  const planId = `market-${listingId}`;
  const title = `${snapshot.title.trim() || "学习路径"} · 市场版（${authorName.trim() || "学习者"}）`;
  const days = snapshot.path.map((stage, index) => ({
    day: `D${index + 1}`,
    title: stage.title,
    knowledge_points: [],
    objective: stage.objective || stage.desc || stage.title,
    minutes: Math.max(1, stage.minutes || snapshot.dailyMinutes || 30),
    prerequisites: [],
    task_ids: (stage.steps ?? []).map((_, taskIndex) => `market-task-${index + 1}-${taskIndex + 1}`),
    actions: [],
  }));
  const tasks = snapshot.path.flatMap((stage, stageIndex) =>
    (stage.steps ?? []).map((task, taskIndex) => ({
      task_id: `market-task-${stageIndex + 1}-${taskIndex + 1}`,
      day: `D${stageIndex + 1}`,
      agent: (task.resource_types[0] || "reading") as ResourceType,
      type: (task.resource_types[0] || "reading") as ResourceType,
      title: task.title,
      knowledge_points: [],
      difficulty: "适中",
      audience: "当前学习者",
      outline: { objective: task.detail || task.title, sections: [] },
      quality_criteria: [],
      source_ids: [],
      depends_on: [],
      status: "ready" as const,
      review: { approved: true, score: 100, issues: [], fixes: [] },
      retry_count: 0,
    })),
  );
  return {
    plan: {
      plan_id: planId,
      student_id: studentId,
      version: 1,
      status: "completed",
      request_summary: `学习主题：${title}\n类型：学习路径\n来源：学习市场 ${listingId}\n原始说明：${snapshot.requestSummary || snapshot.title}`,
      complexity: { level: "complex", reasons: ["学习市场导入"], auto_execute: false },
      constraints: {
        days: Math.max(1, days.length),
        daily_minutes: Math.max(10, snapshot.dailyMinutes || 30),
        difficulty: "适中",
        material_types: Array.from(new Set(tasks.map((task) => task.type))),
      },
      days,
      tasks,
      validation: { valid: true, errors: [], warnings: [] },
      learner_context: { source: "learning_market", level: "imported", summary: `来自 ${authorName}` },
    },
    execution: {
      resources: [],
      schedule: marketSchedule(snapshot.path),
      task_progress: {},
      coverage: {},
      integration: { source: "learning_market", listing_id: listingId },
      reviews: {},
    },
  };
}
