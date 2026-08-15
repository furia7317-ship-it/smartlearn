import type { WebResult } from "@/lib/api";

export const BOOKSHELF_STORAGE_KEY = "sl_bookshelf_v1";

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

export interface BookKnowledgeGraph {
  title: string;
  overview: string;
  nodes: BookGraphNode[];
  edges: BookGraphEdge[];
}

export interface ShelfBook {
  id: string;
  title: string;
  url: string;
  site: string;
  summary: string;
  addedAt: string;
  preview?: string;
  previewNotice?: string;
  previewVersion?: number;
  graph?: BookKnowledgeGraph;
  /** Bump when the extraction schema changes so stale cached graphs are regenerated. */
  graphVersion?: number;
}

export function readBookshelf(): ShelfBook[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKSHELF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ShelfBook[]) : [];
  } catch {
    return [];
  }
}

export function writeBookshelf(books: ShelfBook[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BOOKSHELF_STORAGE_KEY, JSON.stringify(books));
  } catch {
    /* Storage can be unavailable or full in embedded/private browser modes. */
  }
}

export function shelfBookFromResult(result: WebResult): ShelfBook {
  return {
    id: result.id || `book_${Date.now().toString(36)}`,
    title: result.title,
    url: result.url,
    site: result.site,
    summary: result.summary || result.snippet,
    addedAt: new Date().toISOString(),
  };
}
