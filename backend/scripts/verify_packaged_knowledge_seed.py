"""Smoke-test representative topics in the packaged computer-science knowledge seed."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--knowledge-dir", required=True)
    parser.add_argument("--seed-dir", required=True)
    parser.add_argument("--embedding-model", required=True)
    args = parser.parse_args()
    os.environ.update(
        {
            "KNOWLEDGE_DIR": str(Path(args.knowledge_dir).resolve()),
            "CHROMA_PERSIST_DIR": str(Path(args.seed_dir).resolve()),
            "EMBEDDING_MODEL": str(Path(args.embedding_model).resolve()),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
    )

    from app.services.rag import get_or_create_collection, retrieve

    cases = [
        ("特征值和主成分分析", "11-数学与计算理论基础.md"),
        ("TCP拥塞控制和滑动窗口", "14-网络安全与分布式系统.md"),
        ("虚拟内存页面置换算法", "13-计算机系统与嵌入式.md"),
        ("数据库事务隔离级别", "15-软件工程与数据系统.md"),
        ("反向传播学习率梯度消失", "16-人工智能与多媒体.md"),
        ("编译器FIRST FOLLOW预测分析表", "12-程序设计语言与算法.md"),
        ("隐私算法公平与工程师责任", "17-工程实践与职业素养.md"),
        ("动态规划状态转移与边界条件", "08-动态规划.md"),
    ]
    failures: list[str] = []
    for query, expected_source in cases:
        sources = [
            str(doc.get("metadata", {}).get("source", ""))
            for doc in retrieve(query, n_results=5)
        ]
        print(f"{query}|{','.join(sources)}")
        if expected_source not in sources:
            failures.append(f"{query} -> expected {expected_source}")
    count = get_or_create_collection().count()
    if count != 156:
        failures.append(f"collection count is {count}, expected 156")
    if failures:
        raise RuntimeError("; ".join(failures))
    print(f"verified_topics={len(cases)} collection_count={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
