/** 后端 API 接入层 — FastAPI (localhost:8000)，SSE 协议见 backend/app/core/sse.py */

import type { AgentResourceAction, AgentResourceCandidate } from "@/lib/agent-action";
import type { AgentTraceProtocolV2 } from "@/lib/generated/agent-run-protocol";
import type { TutorAttachment } from "@/lib/types";

// Keep browser and API on the same hostname.  A page opened through a WSL/LAN
// address must not silently send credentials to `localhost`, which is a
// different browser site and also fails the backend CORS policy.
const browserApiHost =
  typeof window !== "undefined" && window.location.hostname
    ? window.location.hostname
    : "localhost";
const browserApiBase =
  typeof window !== "undefined" && window.location.protocol === "https:"
    ? window.location.origin
    : `http://${browserApiHost}:8000`;
const desktopApiBase =
  typeof window !== "undefined" ? window.desktop?.apiBase?.trim() : undefined;

export const API_BASE =
  desktopApiBase || process.env.NEXT_PUBLIC_API_BASE || browserApiBase;

const BACKEND_STATUS_CACHE_MS = 5_000;
let backendStatusCache: { online: boolean; checkedAt: number } | null = null;
let backendCheckInFlight: Promise<boolean> | null = null;

/** Any HTTP response proves that the local service is reachable. */
export function markBackendReachable(): void {
  backendStatusCache = { online: true, checkedAt: Date.now() };
}

export function getCachedBackendStatus(maxAgeMs = BACKEND_STATUS_CACHE_MS): boolean | null {
  if (!backendStatusCache || Date.now() - backendStatusCache.checkedAt > maxAgeMs) return null;
  return backendStatusCache.online;
}

/** Ask the bounded action planner to select only from real, ready resources. */
export async function resolveAgentResourceAction(
  utterance: string,
  resources: readonly AgentResourceCandidate[],
  signal?: AbortSignal,
): Promise<AgentResourceAction> {
  const response = await fetch(`${API_BASE}/api/voice/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterance, resources }),
    signal,
  });
  if (!response.ok) throw new Error(`界面动作规划失败 HTTP ${response.status}`);
  const action = await response.json() as AgentResourceAction;
  if (action.action !== "open_resource" || !action.resource_id) return { action: "none" };
  if (!resources.some((resource) =>
    resource.status === "ready" && resource.id === action.resource_id
  )) {
    return { action: "none" };
  }
  return action;
}

/** 健康检查：后端根路由返回 {name, version, status} */
export async function checkBackend(timeoutMs = 2500): Promise<boolean> {
  const cached = getCachedBackendStatus();
  if (cached !== null) return cached;
  if (backendCheckInFlight) return backendCheckInFlight;

  backendCheckInFlight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}/`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const online = response.ok;
      backendStatusCache = { online, checkedAt: Date.now() };
      return online;
    } catch {
      backendStatusCache = { online: false, checkedAt: Date.now() };
      return false;
    } finally {
      clearTimeout(timeout);
      backendCheckInFlight = null;
    }
  })();

  return backendCheckInFlight;
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

async function consumeSSE(
  res: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error("后端没有返回流式响应");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      try {
        onEvent({ event, data: JSON.parse(payload) });
      } catch {
        onEvent({ event, data: { text: payload } });
      }
    }
  }
}

export async function streamSSEGet(
  path: string,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`后端响应异常 HTTP ${res.status}`);
  await consumeSSE(res, onEvent);
}

export class SSERequestError extends Error {
  code?: string;
  retryable?: boolean;
  actions?: string[];

  constructor(status: number, detail: unknown) {
    const structured = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
    super(
      typeof structured.message === "string"
        ? structured.message
        : `后端响应异常 HTTP ${status}`,
    );
    this.name = "SSERequestError";
    this.code = typeof structured.code === "string" ? structured.code : undefined;
    this.retryable = structured.retryable === true;
    this.actions = Array.isArray(structured.actions)
      ? structured.actions.filter((action): action is string => typeof action === "string")
      : [];
  }
}

export interface AgentRunCancelResult {
  run_id: string;
  status: "cancelled" | "cancelling";
  acknowledged: boolean;
  message: string;
}

export interface PersistedUsageDay {
  date: string;
  route: string;
  minutes: number;
  questions: number;
  correct: number;
  feedback_count: number;
}

export interface BehaviorDashboard {
  type_counts: Record<string, number>;
  daily_activity: Array<{ date: string; count: number }>;
  usage_history: PersistedUsageDay[];
  resource_feedback: {
    total: number;
    useful: number;
    useful_rate: number;
  };
  period_days: number;
}

/** Restore durable SQLite usage when the learner signs in on a new device. */
export async function fetchBehaviorDashboard(
  studentId: string,
  days = 30,
  signal?: AbortSignal,
): Promise<BehaviorDashboard> {
  const response = await fetch(
    `${API_BASE}/api/dashboard/${encodeURIComponent(studentId)}?days=${days}`,
    { cache: "no-store", credentials: "include", signal },
  );
  if (!response.ok) throw new Error(`读取学习行为失败 HTTP ${response.status}`);
  return response.json() as Promise<BehaviorDashboard>;
}

export interface AgentRunReplay {
  run: {
    run_id: string;
    status: string;
    schema_version: string;
    last_sequence: number;
    event_count: number;
  };
  events: Array<Partial<AgentTraceProtocolV2> & Record<string, unknown>>;
  last_sequence: number;
}

/** Reload a sanitized run after reconnecting or reopening a conversation. */
export async function fetchAgentRunEvents(
  runId: string,
  signal?: AbortSignal,
): Promise<AgentRunReplay> {
  const response = await fetch(
    `${API_BASE}/api/agent-runs/${encodeURIComponent(runId)}/events?include_children=true`,
    {
      cache: "no-store",
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) throw new Error(`读取 AI 运行记录失败 HTTP ${response.status}`);
  const replay = await response.json() as AgentRunReplay;
  return {
    ...replay,
    events: Array.isArray(replay.events)
      ? replay.events.filter(
          (event): event is Partial<AgentTraceProtocolV2> & Record<string, unknown> =>
            Boolean(event) && typeof event === "object" && !Array.isArray(event),
        )
      : [],
  };
}

/** Keep the original SSE open so it can deliver the backend-authored cancelled terminal event. */
export async function cancelAgentRun(runId: string): Promise<AgentRunCancelResult> {
  const response = await fetch(
    `${API_BASE}/api/chat/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw new Error(`停止 AI 运行失败 HTTP ${response.status}`);
  return response.json() as Promise<AgentRunCancelResult>;
}

/**
 * POST + SSE 流式消费（EventSource 仅支持 GET，后端接口均为 POST）。
 * 按 "event:/data:" 行协议解析，事件以空行分隔。
 */
export async function streamSSE(
  path: string,
  body: Record<string, unknown>,
  onEvent: (e: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    credentials: "include",
  });
  if (!res.ok || !res.body) {
    let detail: unknown;
    try {
      detail = (await res.json() as { detail?: unknown }).detail;
    } catch {
      detail = undefined;
    }
    throw new SSERequestError(res.status, detail);
  }

  await consumeSSE(res, onEvent);
}

/* ── 知识库 ── */

export interface KbHit {
  doc: string;
  section: string;
  score: number | null;
  text: string;
}

export async function kbSearch(query: string, n = 5): Promise<KbHit[]> {
  const res = await fetch(
    `${API_BASE}/api/kb/search?query=${encodeURIComponent(query)}&n_results=${n}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`检索失败 HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: {
      content?: string;
      distance?: number;
      metadata?: { source?: string; title?: string };
    }[];
  };
  return (json.results ?? []).map((r) => ({
    doc: r.metadata?.source ?? "未知来源",
    section: r.metadata?.title ?? "",
    // Chroma 余弦距离取值 [0,2] → 相似度 1 - d/2
    score:
      typeof r.distance === "number"
        ? Math.max(0, Math.min(1, 1 - r.distance / 2))
        : null,
    text: r.content ?? "",
  }));
}

/* ── 联网找教材（博查搜索 → 抓取 → 导入 web_kb） ── */

export interface WebResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  site: string;
  site_icon: string;
  date: string;
}

export async function webSearch(query: string, count = 8): Promise<WebResult[]> {
  const res = await fetch(
    `${API_BASE}/api/kb/websearch?query=${encodeURIComponent(query)}&count=${count}`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    let detail = `联网搜索失败 HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { detail?: unknown };
      if (typeof payload.detail === "string" && payload.detail.trim()) {
        detail = payload.detail.trim();
      }
    } catch {
      /* keep the bounded HTTP fallback */
    }
    throw new Error(detail);
  }
  const json = (await res.json()) as { results?: WebResult[] };
  return json.results ?? [];
}

export interface WebImportResult {
  imported: number;
  title: string;
  url: string;
  chars: number;
}

export async function webImport(url: string, title = ""): Promise<WebImportResult> {
  const res = await fetch(`${API_BASE}/api/kb/webimport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as WebImportResult;
}

export async function uploadTutorAttachment(file: File): Promise<TutorAttachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${API_BASE}/api/chat/attachments`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!response.ok) {
    let detail = `附件上传失败 HTTP ${response.status}`;
    try {
      const payload = await response.json() as { detail?: string };
      if (typeof payload.detail === "string" && payload.detail.trim()) detail = payload.detail;
    } catch {
      /* response is not JSON */
    }
    throw new Error(detail);
  }
  return response.json() as Promise<TutorAttachment>;
}

export interface BookPreviewResult {
  title: string;
  url: string;
  excerpt: string;
  chars: number;
  notice?: string;
  full_text_available?: boolean;
}

export interface BookGraphNode {
  id: string;
  label: string;
  kind: "root" | "chapter" | "concept" | "example";
  group: string;
  summary: string;
  importance: number;
}

export interface BookGraphEdge {
  source: string;
  target: string;
  relation: string;
}

export interface BookGraphResult {
  title: string;
  overview: string;
  nodes: BookGraphNode[];
  edges: BookGraphEdge[];
}

async function postBookAction<T>(path: string, body: Record<string, string>): Promise<T> {
  const response = await fetch(`${API_BASE}/api/kb/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) detail = payload.detail;
    } catch {
      /* response is not JSON */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export function previewBook(url: string, title: string, summary = ""): Promise<BookPreviewResult> {
  return postBookAction<BookPreviewResult>("book-preview", { url, title, summary });
}

export function generateBookGraph(url: string, title: string, summary = ""): Promise<BookGraphResult> {
  return postBookAction<BookGraphResult>("book-graph", { url, title, summary });
}

export interface WebDoc {
  url: string;
  title: string;
  chunks: number;
}

export async function webDocs(): Promise<WebDoc[]> {
  try {
    const res = await fetch(`${API_BASE}/api/kb/webdocs`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { docs?: WebDoc[] };
    return json.docs ?? [];
  } catch {
    return [];
  }
}

/* ── 智能荐书（按专业/年级 → agent 书单 → 一键找资料入库） ── */

export interface RecommendedBook {
  title: string;
  author: string;
  course: string;
  reason: string;
}

export async function recommendBooks(major: string, grade: string): Promise<RecommendedBook[]> {
  const res = await fetch(
    `${API_BASE}/api/kb/recommend-books?major=${encodeURIComponent(major)}&grade=${encodeURIComponent(grade)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`荐书失败 HTTP ${res.status}`);
  const json = (await res.json()) as { books?: RecommendedBook[] };
  return json.books ?? [];
}

export interface BookEdition {
  title: string;
  author: string;
  edition: string;
  publisher: string;
  note: string;
  recommended: boolean;
}

/** 某科目在知识库未命中时，取该科目的主流教材版本供用户选择 */
export async function recommendEditions(subject: string): Promise<BookEdition[]> {
  const res = await fetch(
    `${API_BASE}/api/kb/recommend-editions?subject=${encodeURIComponent(subject)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`版本推荐失败 HTTP ${res.status}`);
  const json = (await res.json()) as { editions?: BookEdition[] };
  return json.editions ?? [];
}

export async function autoImport(
  query: string,
  title = ""
): Promise<WebImportResult & { site?: string }> {
  const res = await fetch(`${API_BASE}/api/kb/autoimport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, title }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as WebImportResult & { site?: string };
}
