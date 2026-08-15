"""Evaluate source-level Recall@K, MRR, false matches and retrieval latency."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@dataclass(frozen=True)
class EvaluationCase:
    query: str
    relevant_sources: tuple[str, ...]
    kind: str
    split: str


def load_cases(path: Path, split: str) -> list[EvaluationCase]:
    cases: list[EvaluationCase] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if "source" in payload:
            for item in payload.get("queries", []):
                case = EvaluationCase(
                    query=str(item["query"]),
                    relevant_sources=(str(payload["source"]),),
                    kind=str(item.get("kind") or "unknown"),
                    split=str(item.get("split") or "dev"),
                )
                if split == "all" or case.split == split:
                    cases.append(case)
        elif "negative_queries" in payload:
            for item in payload["negative_queries"]:
                case = EvaluationCase(
                    query=str(item["query"]),
                    relevant_sources=(),
                    kind=str(item.get("kind") or "out_of_domain"),
                    split=str(item.get("split") or "dev"),
                )
                if split == "all" or case.split == split:
                    cases.append(case)
        else:
            raise ValueError(f"unsupported evaluation row at line {line_number}")
    return cases


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def evaluate(cases: list[EvaluationCase], mode: str, top_k: int) -> dict[str, Any]:
    from app.core.config import settings
    from app.services.knowledge_gate import check_knowledge_gate
    from app.services.rag import get_retrieval_health, retrieve

    positive_rows: list[dict[str, Any]] = []
    negative_rows: list[dict[str, Any]] = []
    timings: list[float] = []
    modes: dict[str, int] = {}

    for case in cases:
        started = time.perf_counter()
        if mode == "gate":
            gate = check_knowledge_gate(case.query, n_results=top_k)
            documents = gate.context if gate.matched or not case.relevant_sources else []
            strong_match = gate.matched
            retrieval_mode = gate.retrieval_mode
        else:
            documents = retrieve(case.query, n_results=top_k)
            strong_match = any(
                document.get("authoritative_match") is True
                or float(document.get("vector_similarity") or 0.0) >= settings.KB_RELEVANCE_THRESHOLD
                for document in documents
            )
            retrieval_mode = str(documents[0].get("retrieval_mode") or "empty") if documents else "empty"
        timings.append((time.perf_counter() - started) * 1000)
        modes[retrieval_mode] = modes.get(retrieval_mode, 0) + 1
        sources = [str(document.get("metadata", {}).get("source") or "") for document in documents]
        if not case.relevant_sources:
            negative_rows.append(
                {"query": case.query, "false_match": strong_match, "sources": sources[:top_k]}
            )
            continue
        rank = next(
            (
                index
                for index, source in enumerate(sources, 1)
                if source in case.relevant_sources
            ),
            None,
        )
        positive_rows.append(
            {
                "query": case.query,
                "kind": case.kind,
                "expected": list(case.relevant_sources),
                "rank": rank,
                "sources": sources[:top_k],
            }
        )

    positive_count = max(1, len(positive_rows))
    negative_count = max(1, len(negative_rows))
    result = {
        "dataset_cases": len(cases),
        "positive_cases": len(positive_rows),
        "negative_cases": len(negative_rows),
        "mode": mode,
        "retrieval_modes": modes,
        "recall_at_1": sum(row["rank"] == 1 for row in positive_rows) / positive_count,
        "recall_at_3": sum(row["rank"] is not None and row["rank"] <= 3 for row in positive_rows) / positive_count,
        f"recall_at_{top_k}": sum(
            row["rank"] is not None and row["rank"] <= top_k for row in positive_rows
        )
        / positive_count,
        f"mrr_at_{top_k}": sum((1 / row["rank"]) if row["rank"] else 0 for row in positive_rows)
        / positive_count,
        "negative_false_match_rate": sum(row["false_match"] for row in negative_rows) / negative_count,
        "latency_ms": {
            "mean": statistics.mean(timings) if timings else 0.0,
            "p50": statistics.median(timings) if timings else 0.0,
            "p95": percentile(timings, 0.95),
            "max": max(timings, default=0.0),
        },
        "misses": [row for row in positive_rows if row["rank"] is None or row["rank"] > top_k],
        "false_matches": [row for row in negative_rows if row["false_match"]],
        "health": get_retrieval_health(),
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=BACKEND_ROOT / "evals" / "rag_recall_v1.jsonl",
    )
    parser.add_argument("--split", choices=("dev", "holdout", "all"), default="all")
    parser.add_argument("--mode", choices=("search", "gate"), default="search")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--min-recall-1", type=float, default=0.0)
    parser.add_argument("--min-recall-3", type=float, default=0.0)
    parser.add_argument("--min-recall-k", type=float, default=0.0)
    parser.add_argument("--max-negative-rate", type=float, default=1.0)
    parser.add_argument("--max-p95-ms", type=float, default=0.0)
    parser.add_argument("--require-vector", action="store_true")
    args = parser.parse_args()

    if args.top_k < 3:
        parser.error("--top-k must be at least 3")
    result = evaluate(load_cases(args.dataset, args.split), args.mode, args.top_k)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    failures: list[str] = []
    if result["recall_at_1"] < args.min_recall_1:
        failures.append("Recall@1 below threshold")
    if result["recall_at_3"] < args.min_recall_3:
        failures.append("Recall@3 below threshold")
    if result[f"recall_at_{args.top_k}"] < args.min_recall_k:
        failures.append(f"Recall@{args.top_k} below threshold")
    if result["negative_false_match_rate"] > args.max_negative_rate:
        failures.append("negative false-match rate above threshold")
    if args.max_p95_ms and result["latency_ms"]["p95"] > args.max_p95_ms:
        failures.append("P95 latency above threshold")
    if args.require_vector and result["health"]["retrieval_mode"] != "hybrid":
        failures.append("complete vector index is required")
    if failures:
        print("EVALUATION FAILED: " + "; ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
