import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import type { ProfileDim } from "./types";

export interface PublishedKnowledge {
  course: string; label: string; score: number; evidenceCount: number; updatedAt: string;
  confidence: string; provisional: boolean; previousScore: number | null;
  sources: { id: string; kind: string; weight: number; score: number }[];
}
export interface LearningDataStatus {
  revision: number; pendingCount: number; pendingWeight: number; reason: string; updatedAt: string | null; nextReviewAt: string | null;
  snapshot: { revision?: number; publishedAt?: string; knowledge?: PublishedKnowledge[]; dimensions?: ProfileDim[]; summary?: string; teachingAdvice?: string };
  policy: { sources: Record<string, { label: string; weight: number; objective: boolean }>; minimumBatch: number; minimumWeight: number; cooldownSeconds: number; maximumWaitSeconds: number };
}
export async function readLearningData(signal: AbortSignal, refresh = false): Promise<LearningDataStatus> {
  const response = await requireOk(await fetch(`${API_BASE}/api/learning-data${refresh ? "/refresh" : ""}`, { method: refresh ? "POST" : "GET", credentials: "include", cache: "no-store", signal }));
  return response.json();
}
