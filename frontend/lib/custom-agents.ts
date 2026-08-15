/**
 * 自建智能体（CustomAgent）数据层 —— 对接后端 `/api/custom-agents`。
 *
 * 架构要点：`type` 与 `agent` 是两件事。用户只能从既有 9 种 `output_type`
 * 里挑「产出什么」，不能造新类型；自定义的只是「谁来执行」。前端把返回体的
 * `agent_key`（形如 `custom:<uuid>`）原样写进计划任务的 `task.agent`，同时把
 * `task.type` 写成该智能体的 `output_type`，所以资源查看器的渲染分支无需变更。
 *
 * offline 语义（三选一，这里显式选「读取降级为空 + 写入 throw」）：
 * 自建智能体的价值完全来自「被后端调度执行」——它的系统提示词要交给服务端的
 * 资料生成图，产出还要过统一的质量审核与防幻觉门禁。离线时后端跑不了图，
 * 本地存下来的智能体既不能执行、又会在恢复连接后与服务端记录产生分叉。
 * 因此：`listCustomAgents` 在非 live 下降级为空列表；
 * `createCustomAgent` / `updateCustomAgent` / `deleteCustomAgent` 在非 live 下直接 throw。
 * 不混用 localStorage。
 */

import { API_BASE } from "./api.ts";
import { requireOk } from "./api-error.ts";
import { getStudentId } from "./student-identity.ts";
import type { ResourceType } from "./types.ts";

type Mode = "checking" | "live" | "offline";

export type CustomAgentStatus = "active" | "archived";

/** 后端 `/api/custom-agents` 的统一返回体。 */
export interface CustomAgent {
  id: string;
  name: string;
  emoji: string;
  duty: string;
  system_prompt: string;
  output_type: ResourceType;
  knowledge_scope: string[];
  config: Record<string, unknown>;
  /** 形如 `custom:<uuid>`，原样写进 `task.agent`。 */
  agent_key: string;
  status: CustomAgentStatus;
  source_listing_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomAgentInput {
  name: string;
  emoji?: string;
  duty?: string;
  system_prompt?: string;
  output_type?: ResourceType;
  knowledge_scope?: string[];
  config?: Record<string, unknown>;
}

export interface CustomAgentPatch extends Partial<CustomAgentInput> {
  status?: CustomAgentStatus;
}

/* ── 与后端一致的字段上限（前端先拦一道，错误提示才是中文的） ── */

export const CUSTOM_AGENT_NAME_MAX = 80;
export const CUSTOM_AGENT_DUTY_MAX = 400;
export const CUSTOM_AGENT_PROMPT_MAX = 2000;
export const CUSTOM_AGENT_SCOPE_MAX = 12;
export const CUSTOM_AGENT_EMOJI_MAX = 8;
export const DEFAULT_CUSTOM_AGENT_OUTPUT_TYPE: ResourceType = "reading";

/** 自建智能体在计划任务里的 `agent` 前缀。 */
export const CUSTOM_AGENT_KEY_PREFIX = "custom:";

export function isCustomAgentKey(agent: string | null | undefined): boolean {
  return typeof agent === "string" && agent.startsWith(CUSTOM_AGENT_KEY_PREFIX);
}

/** 用名称首字作为克制的角色标识，避免在业务界面堆叠 emoji 标签。 */
export function customAgentMonogram(name: string | null | undefined): string {
  const normalized = (name ?? "").trim();
  return Array.from(normalized)[0]?.toLocaleUpperCase("zh-CN") ?? "智";
}

function clampText(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function normalizeScope(scope: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const item of scope ?? []) {
    const tag = typeof item === "string" ? item.trim() : "";
    if (tag) seen.add(tag);
    if (seen.size >= CUSTOM_AGENT_SCOPE_MAX) break;
  }
  return [...seen];
}

/** 建智能体时发给后端的完整 body（不含 student_id）。 */
export interface CustomAgentPayload {
  name: string;
  emoji: string;
  duty: string;
  system_prompt: string;
  output_type: ResourceType;
  knowledge_scope: string[];
  config: Record<string, unknown>;
}

export function normalizeCustomAgentInput(input: CustomAgentInput): CustomAgentPayload {
  return {
    name: clampText(input.name, CUSTOM_AGENT_NAME_MAX),
    emoji: clampText(input.emoji, CUSTOM_AGENT_EMOJI_MAX),
    duty: clampText(input.duty, CUSTOM_AGENT_DUTY_MAX),
    system_prompt: clampText(input.system_prompt, CUSTOM_AGENT_PROMPT_MAX),
    output_type: input.output_type ?? DEFAULT_CUSTOM_AGENT_OUTPUT_TYPE,
    knowledge_scope: normalizeScope(input.knowledge_scope),
    config: input.config ?? {},
  };
}

/** PATCH 只带用户真正改过的字段，避免把未填写的字段清空。 */
export function normalizeCustomAgentPatch(patch: CustomAgentPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = clampText(patch.name, CUSTOM_AGENT_NAME_MAX);
  if (patch.emoji !== undefined) body.emoji = clampText(patch.emoji, CUSTOM_AGENT_EMOJI_MAX);
  if (patch.duty !== undefined) body.duty = clampText(patch.duty, CUSTOM_AGENT_DUTY_MAX);
  if (patch.system_prompt !== undefined) {
    body.system_prompt = clampText(patch.system_prompt, CUSTOM_AGENT_PROMPT_MAX);
  }
  if (patch.output_type !== undefined) body.output_type = patch.output_type;
  if (patch.knowledge_scope !== undefined) {
    body.knowledge_scope = normalizeScope(patch.knowledge_scope);
  }
  if (patch.config !== undefined) body.config = patch.config;
  if (patch.status !== undefined) body.status = patch.status;
  return body;
}

/** 手写校验（项目不引入 zod）：通过返回 null，否则返回一条中文错误。 */
export function validateCustomAgentInput(input: CustomAgentInput): string | null {
  const name = (input.name ?? "").trim();
  if (!name) return "请先给智能体起个名字";
  if (name.length > CUSTOM_AGENT_NAME_MAX) {
    return `名称最多 ${CUSTOM_AGENT_NAME_MAX} 字，当前 ${name.length} 字`;
  }
  const duty = (input.duty ?? "").trim();
  if (duty.length > CUSTOM_AGENT_DUTY_MAX) {
    return `职责最多 ${CUSTOM_AGENT_DUTY_MAX} 字，当前 ${duty.length} 字`;
  }
  const prompt = (input.system_prompt ?? "").trim();
  if (!prompt) return "请写清楚这个智能体的系统提示词，它决定写作风格与内容侧重";
  if (prompt.length > CUSTOM_AGENT_PROMPT_MAX) {
    return `系统提示词最多 ${CUSTOM_AGENT_PROMPT_MAX} 字，当前 ${prompt.length} 字`;
  }
  if (!input.output_type) return "请选择这个智能体的输出类型";
  if ((input.knowledge_scope ?? []).length > CUSTOM_AGENT_SCOPE_MAX) {
    return `知识范围最多 ${CUSTOM_AGENT_SCOPE_MAX} 条`;
  }
  return null;
}

/** 「执行者」下拉里代表内置执行者的哨兵值：内置执行者永远由资料类型推导。 */
export const BUILTIN_AGENT_KEY = "__builtin__";

/**
 * 由资料类型推导内置执行者。
 * `solution` 复用出题智能体，这是后端 `normalize_task_type` 的既有约定，
 * 前端必须写成同一份映射，否则保存后会被后端悄悄改写、造成草稿与实际执行不一致。
 */
export function builtinAgentForType(type: ResourceType): string {
  return type === "solution" ? "quiz" : type;
}

/**
 * 计划任务「执行者」下拉选中后要写进任务的补丁。
 *
 * `agent` 决定谁来生成，`type` 决定走哪道审核门、怎么整合、前端用哪个分支渲染。
 * 两者一旦失配（比如 agent="video" 配 type="courseware"），后端不会拦：
 * 它按 agent 取生成器、却按 type 落库送审，结果是「视频生成器的产出被当课件审核」，
 * 审核必然误判并空烧重试额度，查看器也会渲染错分支。
 *
 * 所以这里**不接受任意内置执行者**：内置一律由 `type` 推导，
 * 自建智能体则同时把 `type` 锁成它的 `output_type` —— 用户不能造新类型，
 * 能自定义的只是执行者。两条路径都保证 agent 与 type 一致。
 */
export function planTaskAgentPatch(
  agentKey: string,
  agents: readonly CustomAgent[],
  currentType: ResourceType,
): { agent: string; type: ResourceType } {
  const custom = agents.find((item) => item.agent_key === agentKey);
  if (custom) return { agent: custom.agent_key, type: custom.output_type };
  return { agent: builtinAgentForType(currentType), type: currentType };
}

const OFFLINE_WRITE_MESSAGE =
  "学习服务未连接，自建智能体无法保存：它必须由后端调度执行才有意义。请恢复服务后重试。";

function toCustomAgent(raw: Record<string, unknown>): CustomAgent {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    emoji: String(raw.emoji ?? ""),
    duty: String(raw.duty ?? ""),
    system_prompt: String(raw.system_prompt ?? ""),
    output_type: (raw.output_type as ResourceType) ?? DEFAULT_CUSTOM_AGENT_OUTPUT_TYPE,
    knowledge_scope: Array.isArray(raw.knowledge_scope)
      ? (raw.knowledge_scope as unknown[]).map(String)
      : [],
    config:
      raw.config && typeof raw.config === "object"
        ? (raw.config as Record<string, unknown>)
        : {},
    agent_key: String(raw.agent_key ?? ""),
    status: raw.status === "archived" ? "archived" : "active",
    source_listing_id: (raw.source_listing_id as string | null) ?? null,
    created_at: String(raw.created_at ?? ""),
    updated_at: String(raw.updated_at ?? ""),
  };
}

export async function listCustomAgents(mode: Mode): Promise<CustomAgent[]> {
  if (mode !== "live") return []; // offline/checking：读取类降级为空，不合成本地智能体
  try {
    const studentId = encodeURIComponent(getStudentId());
    const res = await fetch(
      `${API_BASE}/api/custom-agents?student_id=${studentId}&status=active`,
      { cache: "no-store", credentials: "include" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Record<string, unknown>[];
    return Array.isArray(json) ? json.map(toCustomAgent) : [];
  } catch {
    return [];
  }
}

export async function createCustomAgent(
  mode: Mode,
  input: CustomAgentInput,
): Promise<CustomAgent> {
  if (mode !== "live") throw new Error(OFFLINE_WRITE_MESSAGE);
  const response = await requireOk(
    await fetch(`${API_BASE}/api/custom-agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        student_id: getStudentId(),
        ...normalizeCustomAgentInput(input),
      }),
    }),
  );
  return toCustomAgent((await response.json()) as Record<string, unknown>);
}

export async function updateCustomAgent(
  mode: Mode,
  id: string,
  patch: CustomAgentPatch,
): Promise<CustomAgent> {
  if (mode !== "live") throw new Error(OFFLINE_WRITE_MESSAGE);
  const response = await requireOk(
    await fetch(`${API_BASE}/api/custom-agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      // student_id 必带：后端据此做归属校验
      body: JSON.stringify({
        student_id: getStudentId(),
        ...normalizeCustomAgentPatch(patch),
      }),
    }),
  );
  return toCustomAgent((await response.json()) as Record<string, unknown>);
}

export async function deleteCustomAgent(mode: Mode, id: string): Promise<void> {
  if (mode !== "live") throw new Error(OFFLINE_WRITE_MESSAGE);
  await requireOk(
    await fetch(
      `${API_BASE}/api/custom-agents/${encodeURIComponent(id)}?student_id=${encodeURIComponent(getStudentId())}`,
      { method: "DELETE", credentials: "include" },
    ),
  );
}
