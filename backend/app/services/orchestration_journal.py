"""Write audit records before publishing events; retries are idempotent."""
import hashlib
import json

from sqlalchemy.dialects.sqlite import insert
from app.core.config import sync_session
from app.models.learning import OrchestrationRecord


def record(state, kind, task_id, payload):
    plan = state["plan"]
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    key = hashlib.sha256(f"{state['trace_run_id']}:{kind}:{task_id}:{serialized}".encode()).hexdigest()
    with sync_session() as db:
        db.execute(insert(OrchestrationRecord).values(
            id=key, run_id=state["trace_run_id"], student_id=state["student_id"],
            plan_id=plan["plan_id"], plan_version=plan["version"], task_id=task_id,
            kind=kind, payload=json.loads(serialized),
        ).on_conflict_do_nothing(index_elements=["id"]))
        db.commit()
