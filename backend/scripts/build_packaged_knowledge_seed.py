"""Build a versioned public knowledge seed using the configured cloud embedder."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--knowledge-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--embedding-model', default='Qwen/Qwen3-VL-Embedding-8B')
    args = parser.parse_args()
    knowledge = Path(args.knowledge_dir).resolve()
    output = Path(args.output_dir).resolve()
    if not knowledge.is_dir():
        raise FileNotFoundError('Knowledge directory does not exist')
    if not output.name.startswith('chroma_seed_cs'):
        raise ValueError('Packaged knowledge output must use a chroma_seed_cs* directory')
    os.environ['KNOWLEDGE_DIR'] = str(knowledge)
    os.environ['CHROMA_PERSIST_DIR'] = str(output)
    os.environ['EMBEDDING_MODEL'] = args.embedding_model
    from app.services.rag import build_knowledge_index
    # Publish only after validation; unchanged seeds avoid repeat cloud charges.
    print(json.dumps(build_knowledge_index(), ensure_ascii=False))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
