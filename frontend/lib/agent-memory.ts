import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";

export interface SemanticMemoryFact {
  id: string;
  category: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  evidence: string;
  source: string;
  source_conversation_id: string;
  status: string;
  supersedes_id: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryEpisode {
  id: string;
  conversation_id: string;
  summary: string;
  keywords: string[];
  importance: number;
  source_message_count: number;
  estimated_tokens: number;
  occurred_at: number;
  access_count: number;
}

export async function listSemanticMemoryFacts(): Promise<SemanticMemoryFact[]> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/memory/facts/${encodeURIComponent(getStudentId())}`,
    { cache: "no-store" },
  ));
  return await response.json() as SemanticMemoryFact[];
}

export async function listMemoryEpisodes(limit = 8): Promise<MemoryEpisode[]> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/memory/episodes/${encodeURIComponent(getStudentId())}?limit=${limit}`,
    { cache: "no-store" },
  ));
  return await response.json() as MemoryEpisode[];
}

export async function forgetSemanticMemoryFact(factId: string): Promise<void> {
  await requireOk(await fetch(
    `${API_BASE}/api/memory/facts/${encodeURIComponent(getStudentId())}/${encodeURIComponent(factId)}`,
    { method: "DELETE" },
  ));
}

export async function clearLongTermAgentMemory(): Promise<void> {
  await requireOk(await fetch(
    `${API_BASE}/api/memory/long-term/${encodeURIComponent(getStudentId())}`,
    { method: "DELETE" },
  ));
}
