export interface KbHit {
  doc: string;
  section: string;
  score: number | null;
  text: string;
}

export interface KbSearchResult {
  content?: string;
  distance?: number;
  reranker_score?: number;
  metadata?: { source?: string; title?: string };
}

export function mapKbResults(results: KbSearchResult[]): KbHit[] {
  return results.map(result => ({
    doc: result.metadata?.source ?? "未知来源",
    section: result.metadata?.title ?? "",
    // Cloud reranking scores are already ordered by the backend. Do not apply
    // the old cosine threshold to them or discard a valid zero score.
    score: typeof result.reranker_score === "number" && Number.isFinite(result.reranker_score)
      ? result.reranker_score
      : typeof result.distance === "number" && Number.isFinite(result.distance)
        ? Math.max(0, Math.min(1, 1 - result.distance / 2))
        : null,
    text: result.content ?? "",
  }));
}
