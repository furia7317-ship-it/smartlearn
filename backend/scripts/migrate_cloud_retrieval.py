"""Rebuild public knowledge vectors, optionally copying only that index to other stores."""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--copy-to', action='append', default=[])
    args = parser.parse_args()
    from app.core.config import settings
    from app.services import rag

    start = time.monotonic()
    result = rag.build_knowledge_index()
    print(json.dumps(result, ensure_ascii=False), flush=True)
    manifest = rag._read_manifest()
    source = rag.get_or_create_collection()
    payload = source.get(include=['documents', 'metadatas', 'embeddings'])
    source_name = manifest['active_collection']
    for destination in args.copy_to:
        target_dir = Path(destination).resolve()
        if target_dir == Path(settings.CHROMA_PERSIST_DIR).resolve():
            continue
        import chromadb
        target = chromadb.PersistentClient(path=str(target_dir))
        collection = target.get_or_create_collection(
            name=source_name, embedding_function=None,
            metadata={'hnsw:space': 'cosine', 'embedding_protocol': rag._EMBEDDING_PROTOCOL_VERSION},
        )
        for offset in range(0, len(payload['ids']), 64):
            stop = offset + 64
            collection.upsert(ids=payload['ids'][offset:stop],
                              documents=payload['documents'][offset:stop],
                              metadatas=payload['metadatas'][offset:stop],
                              embeddings=payload['embeddings'][offset:stop])
        actual = collection.get(include=['metadatas'])
        counts = Counter(str(m.get('source') or '') for m in actual['metadatas'])
        if collection.count() != manifest['chunks'] or dict(counts) != manifest['source_counts']:
            raise RuntimeError('Copied knowledge index validation failed; manifest was not changed')
        manifest_path = target_dir / rag._INDEX_MANIFEST_NAME
        temporary = manifest_path.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(manifest_path)
        print(json.dumps({'copied_public_index_to': str(target_dir), 'chunks': collection.count()}, ensure_ascii=False), flush=True)
    print(json.dumps({'complete': True, 'seconds': round(time.monotonic() - start, 2)}), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
