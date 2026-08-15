"""Build the complete packaged Chroma seed from local Markdown knowledge."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--knowledge-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--embedding-model", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    knowledge_dir = Path(args.knowledge_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    embedding_model = Path(args.embedding_model).resolve()
    if not knowledge_dir.is_dir():
        raise FileNotFoundError(f"Knowledge directory does not exist: {knowledge_dir}")
    if not embedding_model.is_dir():
        raise FileNotFoundError(f"Embedding model does not exist: {embedding_model}")
    if not output_dir.name.startswith("chroma_seed_cs"):
        raise ValueError("Packaged knowledge output must use a chroma_seed_cs* directory")

    stale_staging_dir = output_dir.with_name(output_dir.name + ".building")
    for stale_dir in (output_dir, stale_staging_dir):
        if stale_dir.exists():
            shutil.rmtree(stale_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    os.environ["KNOWLEDGE_DIR"] = str(knowledge_dir)
    os.environ["CHROMA_PERSIST_DIR"] = str(output_dir)
    os.environ["EMBEDDING_MODEL"] = str(embedding_model)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

    from app.routers.kb import _smart_chunk_markdown
    from app.services.rag import add_documents, get_or_create_collection

    documents: list[dict] = []
    files = sorted(knowledge_dir.glob("*.md"))
    for path in files:
        documents.extend(_smart_chunk_markdown(path.read_text(encoding="utf-8"), path.name))
    if not documents:
        raise RuntimeError("No Markdown knowledge chunks were generated")

    inserted = add_documents(documents)
    collection_count = get_or_create_collection().count()
    if len(inserted) != len(documents) or collection_count != len(documents):
        raise RuntimeError(
            f"Knowledge seed incomplete: chunks={len(documents)}, inserted={len(inserted)}, "
            f"collection={collection_count}"
        )

    print(
        json.dumps(
            {
                "output": str(output_dir),
                "files": len(files),
                "chunks": len(documents),
                "collection_count": collection_count,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
