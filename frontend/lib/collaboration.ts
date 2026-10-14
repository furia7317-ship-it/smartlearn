import { getStudentId } from "./student-identity.ts";

export type CollaborationEffort = "auto" | "fast" | "standard" | "deep" | "rigorous";
export interface CollaborationOptions {
  effort: CollaborationEffort;
  preference: "auto" | "parallel" | "staged";
  auto_max_effort: "fast" | "standard" | "deep" | "rigorous";
  sources: { course: boolean; personal: boolean; web: boolean; document_ids: string[] };
}
export const COLLABORATION_OPTIONS = [
  { value: "auto", label: "自动", detail: "根据任务选择投入，最高使用深度协作" },
  { value: "fast", label: "快速", detail: "保留必要检查，减少补充检索与额外复核" },
  { value: "standard", label: "标准", detail: "平衡等待时间，逐份生成、审核并保存" },
  { value: "deep", label: "深度", detail: "增加资料检索、返工机会与跨资料一致性检查" },
  { value: "rigorous", label: "严谨", detail: "在深度基础上增加独立复核，需要更多时间" },
] as const;
export const DEFAULT_COLLABORATION: CollaborationOptions = {
  effort: "standard", preference: "auto", auto_max_effort: "deep",
  sources: { course: true, personal: true, web: false, document_ids: [] },
};
export function normalizeCollaboration(raw: unknown): CollaborationOptions {
  const data = raw && typeof raw === "object" ? raw as Partial<CollaborationOptions> : {};
  return {
    effort: COLLABORATION_OPTIONS.some(o => o.value === data.effort) ? data.effort! : "standard",
    preference: data.preference === "parallel" || data.preference === "staged" ? data.preference : "auto",
    auto_max_effort: ["fast", "standard", "deep", "rigorous"].includes(data.auto_max_effort ?? "") ? data.auto_max_effort! : "deep",
    sources: { course: data.sources?.course !== false, personal: data.sources?.personal !== false,
      web: data.sources?.web === true, document_ids: Array.isArray(data.sources?.document_ids) ? data.sources.document_ids.filter(x => typeof x === "string").slice(0, 30) : [] },
  };
}
export function readCollaboration(): CollaborationOptions {
  if (typeof window === "undefined") return normalizeCollaboration(null);
  try { return normalizeCollaboration(JSON.parse(localStorage.getItem(`sl_collaboration_v1:${getStudentId()}`) || "null")); }
  catch { return normalizeCollaboration(null); }
}
export function writeCollaboration(value: CollaborationOptions) {
  localStorage.setItem(`sl_collaboration_v1:${getStudentId()}`, JSON.stringify(normalizeCollaboration(value)));
  window.dispatchEvent(new Event("sl-collaboration-change"));
}
