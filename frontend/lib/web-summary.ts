import type { ResourceData, ResourceItem, ResourceType } from "./types";
import { API_BASE } from "./api.ts";
import { getStudentId } from "./student-identity.ts";

type Mode = "checking" | "live" | "offline";

export interface WebSummaryInput {
  url: string;
  title: string;
  content: string;
}

interface ResPayload {
  type: ResourceType;
  title: string;
  subtitle?: string;
  meta?: string[];
  sources?: number;
  knowledge_points?: string;
  data: ResourceData;
  source?: string;
  approval_token?: string | null;
  review_approved?: boolean;
}

export interface WebSummaryPayload {
  url: string;
  title: string;
  analysis: {
    summary: string;
    key_points: string[];
    questions: NonNullable<ResourceData["questions"]>;
  };
  summary_resource: ResPayload;
  quiz_resource: ResPayload;
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export async function summarizeWebPage(
  mode: Mode,
  input: WebSummaryInput
): Promise<WebSummaryPayload> {
  if (mode !== "live") throw new Error("后端未连接，无法生成网页总结");
  const res = await fetch(`${API_BASE}/api/web/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, student_id: getStudentId() }),
  });
  if (!res.ok) throw new Error(`网页总结失败 HTTP ${res.status}`);
  return (await res.json()) as WebSummaryPayload;
}

export function mapWebSummaryToResources(payload: WebSummaryPayload): ResourceItem[] {
  const id = `web_${hash(payload.url || payload.title)}`;
  const toItem = (p: ResPayload, suffix: string): ResourceItem => ({
    id: `${id}_${suffix}`,
    type: p.type,
    title: p.title,
    subtitle: p.subtitle ?? "",
    meta: p.meta ?? [],
    status: "ready",
    version: 1,
    sources: p.sources ?? 0,
    data: p.data,
  });
  return [
    toItem(payload.summary_resource, "note"),
    toItem(payload.quiz_resource, "quiz"),
  ];
}
