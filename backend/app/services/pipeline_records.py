"""Persist the exact plan handed from chat/form planning to the scheduler."""
from app.core.config import async_session
from app.models.learning import ResourceGenerationPlan
from app.schemas.resource_plan import PlanArtifact
from app.services.resource_plan_store import create_record


async def start_plan(plan, run_id):
    plan.status = "running"
    async with async_session() as db:
        row = await create_record(db, plan, plan.request_summary)
        row.execution_state = {"trace_run_id": run_id}
        await db.commit()


async def checkpoint(plan_id, state, *, terminal=False):
    from app.routers.resource_plans import _execution_snapshot, _terminalize_execution
    async with async_session() as db:
        row = await db.get(ResourceGenerationPlan, plan_id)
        if row is None or row.status == "cancelled":
            return
        row.execution_state = _execution_snapshot(state)
        if terminal:
            plan = PlanArtifact.model_validate(row.artifact)
            execution, reasons = _terminalize_execution(plan, row.execution_state)
            row.execution_state = execution
            row.status = plan.status = "completed" if state.get("delivery_status") == "completed" else "failed"
            row.artifact = plan.model_dump(mode="json")
            row.last_error = "；".join(str(x) for x in reasons)[:1000]
        await db.commit()
