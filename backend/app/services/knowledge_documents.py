"""Deterministic loading and chunking for the curated Markdown knowledge base."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any


CHUNKER_VERSION = "smart-markdown-v4-contextual"


def smart_chunk_markdown(content: str, source: str) -> list[dict[str, Any]]:
    """Split Markdown by headings while keeping code/evidence blocks intact.

    Chunk ids use the source name plus a content digest.  They therefore stay
    stable when an unrelated section is inserted earlier in the same file and
    change when the actual evidence changes.
    """

    chunks: list[dict[str, Any]] = []
    document_title = Path(source).stem
    search_cursor = 0
    sections = re.split(r"\n(?=#{1,2} )", content)

    for raw_section in sections:
        section = raw_section.strip()
        if not section:
            continue
        section_start = content.find(section, search_cursor)
        if section_start < 0:
            section_start = search_cursor
        search_cursor = section_start + len(section)
        title_match = re.match(r"^#+\s+(.+)", section)
        title = title_match.group(1).strip() if title_match else document_title

        split_long_section = len(section) > 1500
        candidates = [section]
        if split_long_section:
            candidates = re.split(r"\n(?=#{3} )|\n\n", section)

        candidate_cursor = section_start
        for raw_candidate in candidates:
            candidate = raw_candidate.strip()
            if not candidate or (split_long_section and len(candidate) < 20):
                continue
            candidate_start = content.find(candidate, candidate_cursor)
            if candidate_start < 0:
                candidate_start = candidate_cursor
            candidate_end = candidate_start + len(candidate)
            candidate_cursor = candidate_end
            if split_long_section and len(candidate) < 100 and chunks:
                chunks[-1]["content"] += "\n\n" + candidate
                chunks[-1]["metadata"]["char_count"] = len(chunks[-1]["content"])
                chunks[-1]["metadata"]["end_offset"] = candidate_end
                chunks[-1]["id"] = _chunk_id(source, chunks[-1]["content"])
                continue
            chunks.append(
                {
                    "id": _chunk_id(source, candidate),
                    "content": candidate,
                    "metadata": {
                        "source": source,
                        "title": title,
                        "document_title": document_title,
                        "section_title": title,
                        "sequence_index": len(chunks),
                        "start_offset": candidate_start,
                        "end_offset": candidate_end,
                        "char_count": len(candidate),
                        "chunker_version": CHUNKER_VERSION,
                    },
                }
            )
    return chunks


def load_knowledge_documents(knowledge_dir: str | Path) -> list[dict[str, Any]]:
    root = Path(knowledge_dir)
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"knowledge directory is unavailable: {root}")
    documents: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.md")):
        documents.extend(smart_chunk_markdown(path.read_text(encoding="utf-8"), path.name))
    return documents


def knowledge_fingerprint(
    knowledge_dir: str | Path,
    embedding_model: str,
) -> str:
    """Fingerprint source bytes, chunker version and embedding identity."""

    root = Path(knowledge_dir)
    digest = hashlib.sha256()
    digest.update(CHUNKER_VERSION.encode("utf-8"))
    digest.update(b"\0")
    digest.update(str(embedding_model).encode("utf-8"))
    for path in sorted(root.glob("*.md")):
        digest.update(b"\0")
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return digest.hexdigest()


def source_counts(documents: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for document in documents:
        source = str(document.get("metadata", {}).get("source") or "")
        if source:
            counts[source] = counts.get(source, 0) + 1
    return dict(sorted(counts.items()))


def _chunk_id(source: str, content: str) -> str:
    digest = hashlib.sha1(content.encode("utf-8")).hexdigest()[:12]
    return f"{Path(source).stem}_{digest}"
