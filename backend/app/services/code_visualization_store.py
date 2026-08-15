"""Durable storage for generated code demonstrations."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings

CODE_VISUALIZATION_WORKFLOW_VERSION = "trace-graphics-v2"
MAX_STORED_BYTES = 12_000_000


class CodeVisualizationStore:
    def _root(self) -> Path:
        return Path(settings.MEDIA_OUTPUT_DIR) / "code_visualizations"

    @staticmethod
    def _code_hash(code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()

    def _path(self, student_id: str, resource_id: str) -> Path:
        key = hashlib.sha256(
            f"{student_id}\0{resource_id}".encode("utf-8")
        ).hexdigest()
        return self._root() / f"{key}.json"

    def save(
        self,
        *,
        student_id: str,
        resource_id: str,
        code: str,
        result: dict[str, Any],
    ) -> bool:
        if not student_id or not resource_id:
            return False
        payload = {
            "workflow_version": CODE_VISUALIZATION_WORKFLOW_VERSION,
            "student_id": student_id,
            "resource_id": resource_id,
            "code_sha256": self._code_hash(code),
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "result": result,
        }
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
        if len(encoded) > MAX_STORED_BYTES:
            return False
        target = self._path(student_id, resource_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(".json.tmp")
        temporary.write_bytes(encoded)
        temporary.replace(target)
        return True

    def load(
        self,
        *,
        student_id: str,
        resource_id: str,
        code: str,
    ) -> dict[str, Any] | None:
        if not student_id or not resource_id:
            return None
        try:
            payload = json.loads(
                self._path(student_id, resource_id).read_text(encoding="utf-8")
            )
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        if payload.get("workflow_version") != CODE_VISUALIZATION_WORKFLOW_VERSION:
            return None
        if payload.get("student_id") != student_id or payload.get("resource_id") != resource_id:
            return None
        if payload.get("code_sha256") != self._code_hash(code):
            return None
        result = payload.get("result")
        return result if isinstance(result, dict) else None


code_visualization_store = CodeVisualizationStore()
