"""用户自建智能体的 CRUD。

前缀独立用 ``/api/custom-agents``：``/api/agents`` 已经被 agents.py 与
resource_plans.py 共用，再塞进去语义会混乱。

自定义的只是**执行者**：``output_type`` 必须从既有 9 种资源类型里挑，因为审核门、
整合、quiz→ExamPaper 落库副作用和前端 resource-viewer 都按 ``task.type`` 分派。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.models.learning import CustomAgent
from app.routers.auth import require_account_student_scope
from app.schemas.resource_plan import CUSTOM_AGENT_PREFIX, ResourceType

router = APIRouter(dependencies=[Depends(require_account_student_scope)])

MAX_DUTY_CHARS = 400
MAX_SYSTEM_PROMPT_CHARS = 2000
CustomAgentStatus = Literal["active", "archived"]


class CustomAgentCreate(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    emoji: str = Field(default="🤖", max_length=16)
    duty: str = Field(default="", max_length=MAX_DUTY_CHARS)
    # 用户提示词是用户输入，不是可信系统指令：这里封顶，装配时再加固定策略前缀。
    system_prompt: str = Field(default="", max_length=MAX_SYSTEM_PROMPT_CHARS)
    output_type: ResourceType = "reading"
    knowledge_scope: list[str] = Field(default_factory=list, max_length=12)
    config: dict[str, Any] = Field(default_factory=dict)


class CustomAgentUpdate(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    emoji: str | None = Field(default=None, max_length=16)
    duty: str | None = Field(default=None, max_length=MAX_DUTY_CHARS)
    system_prompt: str | None = Field(default=None, max_length=MAX_SYSTEM_PROMPT_CHARS)
    output_type: ResourceType | None = None
    knowledge_scope: list[str] | None = Field(default=None, max_length=12)
    config: dict[str, Any] | None = None
    status: CustomAgentStatus | None = None


def agent_definition(agent: CustomAgent) -> dict[str, Any]:
    """执行期需要的最小定义（喂给 build_custom_agent）。"""

    return {
        "id": agent.id,
        "name": agent.name,
        "emoji": agent.emoji,
        "duty": agent.duty,
        "system_prompt": agent.system_prompt,
        "output_type": agent.output_type,
        "knowledge_scope": list(agent.knowledge_scope or []),
        "config": dict(agent.config or {}),
    }


def serialize_custom_agent(agent: CustomAgent) -> dict[str, Any]:
    return {
        **agent_definition(agent),
        # 计划里 task.agent 直接写这个 key，图按前缀路由到自定义执行者。
        "agent_key": f"{CUSTOM_AGENT_PREFIX}{agent.id}",
        "status": agent.status,
        "source_listing_id": agent.source_listing_id,
        "created_at": str(agent.created_at),
        "updated_at": str(agent.updated_at),
    }


def _clean_scope(values: Iterable[Any] | None) -> list[str]:
    cleaned = [str(item).strip()[:80] for item in (values or [])]
    return [item for item in dict.fromkeys(cleaned) if item][:12]


async def _owned_agent(db: AsyncSession, agent_id: str, student_id: str) -> CustomAgent:
    """项目没有 RLS，归属校验必须显式写在 where 里，漏掉就是越权。"""

    stmt = select(CustomAgent).where(
        CustomAgent.id == agent_id,
        CustomAgent.owner_id == student_id,
    )
    agent = (await db.execute(stmt)).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="自定义智能体不存在")
    return agent


async def load_custom_agent_definitions(
    db: AsyncSession,
    student_id: str,
    agent_names: Iterable[Any],
) -> dict[str, dict[str, Any]]:
    """把一个计划用到的自定义智能体一次性预加载出来。

    执行图跑在工作线程里，不能开数据库会话，所以定义必须在派发前解析完，
    再随 execution_state 进入 ``state["custom_agents"]``。
    """

    ids = {
        str(name)[len(CUSTOM_AGENT_PREFIX):].strip()
        for name in agent_names
        if str(name).startswith(CUSTOM_AGENT_PREFIX)
    }
    ids.discard("")
    if not ids:
        return {}
    stmt = select(CustomAgent).where(
        CustomAgent.owner_id == student_id,
        CustomAgent.status == "active",
        CustomAgent.id.in_(sorted(ids)),
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {f"{CUSTOM_AGENT_PREFIX}{row.id}": agent_definition(row) for row in rows}


@router.get("")
async def list_custom_agents(
    student_id: str = Query(min_length=1, max_length=64),
    status: str = Query(default="active", max_length=24),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CustomAgent).where(CustomAgent.owner_id == student_id)
    if status in {"active", "archived"}:
        stmt = stmt.where(CustomAgent.status == status)
    stmt = stmt.order_by(CustomAgent.created_at.desc())
    agents = (await db.execute(stmt)).scalars().all()
    return [serialize_custom_agent(agent) for agent in agents]


@router.post("")
async def create_custom_agent(req: CustomAgentCreate, db: AsyncSession = Depends(get_db)):
    agent = CustomAgent(
        id=str(uuid.uuid4()),
        owner_id=req.student_id,
        name=req.name.strip()[:80] or "我的智能体",
        emoji=req.emoji.strip()[:16] or "🤖",
        duty=req.duty.strip()[:MAX_DUTY_CHARS],
        system_prompt=req.system_prompt.strip()[:MAX_SYSTEM_PROMPT_CHARS],
        output_type=req.output_type,
        knowledge_scope=_clean_scope(req.knowledge_scope),
        config=dict(req.config or {}),
        status="active",
        source_listing_id=None,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return serialize_custom_agent(agent)


@router.patch("/{agent_id}")
async def update_custom_agent(
    agent_id: str,
    req: CustomAgentUpdate,
    db: AsyncSession = Depends(get_db),
):
    agent = await _owned_agent(db, agent_id, req.student_id)
    payload = req.model_dump(exclude_none=True, exclude={"student_id"})
    if "knowledge_scope" in payload:
        payload["knowledge_scope"] = _clean_scope(payload["knowledge_scope"])
    for key, value in payload.items():
        setattr(agent, key, value)
    await db.commit()
    await db.refresh(agent)
    return serialize_custom_agent(agent)


@router.delete("/{agent_id}")
async def delete_custom_agent(
    agent_id: str,
    student_id: str = Query(min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    agent = await _owned_agent(db, agent_id, student_id)
    await db.delete(agent)
    await db.commit()
    return {"ok": True}
