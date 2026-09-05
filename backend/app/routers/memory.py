"""记忆卡训练、统计和导入接口。"""

from __future__ import annotations

import asyncio
import json
import math
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db
from app.core.deps import get_llm
from app.core.llm import parse_json_response
from app.models.learning import (
    LearnerWorkspaceState,
    MemoryCard,
    MemoryEpisode,
    ReviewLog,
    SemanticMemoryFact,
    WrongQuestion,
)
from app.models.profile import Profile
from app.services.memory import get_or_create_card, schedule, serialize_card
from app.services.agent_memory import upsert_semantic_fact
from app.services.rag import retrieve

router = APIRouter()


class CardCreate(BaseModel):
    student_id: str
    front: str = Field(min_length=1)
    back: str = Field(min_length=1)
    topic: str = ""
    knowledge_point: str = ""
    source: str = "manual"
    source_id: str = ""


class WrongbookImport(BaseModel):
    student_id: str
    topic: str | None = None


class GenerateCardsRequest(BaseModel):
    student_id: str
    topic: str = Field(min_length=1)
    count: int = Field(default=10, ge=1, le=50)


class ReviewRequest(BaseModel):
    card_id: str
    rating: int = Field(ge=0, le=3)


class WorkspaceStateWrite(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    state: dict = Field(default_factory=dict)
    client_updated_at: int = Field(default=0, ge=0)
    expected_version: int = Field(default=0, ge=0)


class SemanticFactWrite(BaseModel):
    student_id: str = Field(min_length=1, max_length=64)
    category: str = Field(min_length=1, max_length=32)
    key: str = Field(min_length=1, max_length=160)
    value: dict
    confidence: float = Field(default=0.9, ge=0, le=1)
    evidence: str = Field(default="", max_length=1200)


@router.post("/cards")
async def create_card(req: CardCreate, db: AsyncSession = Depends(get_db)):
    card, _ = await get_or_create_card(db, **req.model_dump())
    await db.commit()
    await db.refresh(card)
    return serialize_card(card)


@router.post("/cards/from-wrongbook")
async def import_wrongbook(req: WrongbookImport, db: AsyncSession = Depends(get_db)):
    stmt = select(WrongQuestion).where(WrongQuestion.student_id == req.student_id)
    if req.topic:
        stmt = stmt.where(WrongQuestion.topic == req.topic)
    wrongs = (await db.execute(stmt)).scalars().all()

    created = 0
    skipped = 0
    for wrong in wrongs:
        _, was_created = await get_or_create_card(
            db,
            student_id=req.student_id,
            front=wrong.stem,
            back=f"{wrong.answer}\n\n{wrong.feedback}".strip(),
            topic=wrong.topic,
            knowledge_point=wrong.knowledge_point,
            source="wrongbook",
            source_id=wrong.question_id,
        )
        created += int(was_created)
        skipped += int(not was_created)
    await db.commit()
    return {"created": created, "skipped": skipped}


async def _generate_pairs(topic: str, count: int) -> list[dict]:
    try:
        context = await asyncio.to_thread(retrieve, topic, "", 5)
    except Exception:
        context = []
    llm = get_llm(temperature=0.2)
    prompt = (
        f"根据主题「{topic}」和知识库内容生成 {count} 张问答记忆卡。"
        "输出 JSON 数组，每项包含 front、back、knowledge_point。\n"
        f"知识库：{context}"
    )
    response = await llm.ainvoke(prompt)
    parsed = parse_json_response(response.content)
    if isinstance(parsed, dict):
        parsed = parsed.get("cards", [])
    return parsed if isinstance(parsed, list) else []


@router.post("/cards/generate")
async def generate_cards(req: GenerateCardsRequest, db: AsyncSession = Depends(get_db)):
    pairs = await _generate_pairs(req.topic, req.count)
    created = 0
    for pair in pairs[:req.count]:
        front = str(pair.get("front", "")).strip()
        back = str(pair.get("back", "")).strip()
        if not front or not back:
            continue
        _, was_created = await get_or_create_card(
            db,
            student_id=req.student_id,
            front=front,
            back=back,
            topic=req.topic,
            knowledge_point=str(pair.get("knowledge_point", "")),
            source="generated",
        )
        created += int(was_created)
    await db.commit()
    return {"created": created}


@router.get("/due/{student_id}")
async def get_due_cards(
    student_id: str,
    limit: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    if limit is None:
        profile = await db.get(Profile, student_id)
        question_count = int((profile.pace or {}).get("question_count", 5)) if profile else 5
        limit = question_count * 2
    stmt = (
        select(MemoryCard)
        .where(MemoryCard.student_id == student_id, MemoryCard.due_date <= date.today().isoformat())
        .order_by(MemoryCard.due_date.asc(), MemoryCard.created_at.asc())
        .limit(max(limit, 0))
    )
    cards = (await db.execute(stmt)).scalars().all()
    return [serialize_card(card) for card in cards]


@router.post("/review")
async def review_card(req: ReviewRequest, db: AsyncSession = Depends(get_db)):
    card = await db.get(MemoryCard, req.card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="记忆卡不存在")
    interval_before = card.interval_days
    schedule(card, req.rating)
    db.add(ReviewLog(
        card_id=card.id,
        student_id=card.student_id,
        rating=req.rating,
        interval_before=interval_before,
        interval_after=card.interval_days,
        ease_after=card.ease_factor,
    ))
    await db.commit()
    return {
        "next_due": card.due_date,
        "interval_days": card.interval_days,
        "state": card.state,
    }


def _strength(card: MemoryCard, last_review: datetime | None) -> float:
    anchor = last_review or card.created_at or datetime.now()
    delta_days = max((datetime.now() - anchor).total_seconds() / 86400, 0)
    return math.exp(-delta_days / max(card.interval_days, 1))


@router.get("/stats/{student_id}")
async def get_stats(student_id: str, db: AsyncSession = Depends(get_db)):
    cards = list((await db.execute(
        select(MemoryCard).where(MemoryCard.student_id == student_id)
    )).scalars().all())
    logs = list((await db.execute(
        select(ReviewLog)
        .where(ReviewLog.student_id == student_id)
        .order_by(ReviewLog.created_at.desc())
    )).scalars().all())

    today = date.today()
    today_text = today.isoformat()
    due_today = sum(1 for card in cards if card.due_date <= today_text)

    # ReviewLog.created_at 由 func.now() 写入（UTC），故按 UTC 日比较，
    # 避免本地时区跨午夜边界把今天的复习算成昨天（reviewed_today/streak 漏计）。
    utc_today = datetime.utcnow().date()
    reviewed_today = sum(1 for log in logs if log.created_at and log.created_at.date() == utc_today)

    review_dates = sorted({log.created_at.date() for log in logs if log.created_at}, reverse=True)
    streak = 0
    if review_dates and review_dates[0] >= utc_today - timedelta(days=1):
        expected = review_dates[0]
        for review_date in review_dates:
            if review_date != expected:
                break
            streak += 1
            expected -= timedelta(days=1)

    last_by_card: dict[str, datetime] = {}
    for log in logs:
        if log.created_at and log.card_id not in last_by_card:
            last_by_card[log.card_id] = log.created_at
    strengths = [(card, _strength(card, last_by_card.get(card.id))) for card in cards]
    retention = sum(value for _, value in strengths) / len(strengths) if strengths else 0.0

    upcoming = []
    for offset in range(7):
        day = today + timedelta(days=offset)
        upcoming.append({"date": day.isoformat(), "count": sum(card.due_date == day.isoformat() for card in cards)})

    kp_values: dict[str, list[float]] = {}
    for card, value in strengths:
        if card.knowledge_point:
            kp_values.setdefault(card.knowledge_point, []).append(value)
    weak_points = [
        {"knowledge_point": kp, "strength": round(sum(values) / len(values), 4)}
        for kp, values in kp_values.items()
    ]
    weak_points.sort(key=lambda item: item["strength"])

    return {
        "due_today": due_today,
        "reviewed_today": reviewed_today,
        "streak": streak,
        "retention_estimate": round(retention, 4),
        "upcoming": upcoming,
        "weak_points": weak_points[:5],
    }


@router.get("/cards/{card_id}/logs")
async def get_logs(card_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(ReviewLog).where(ReviewLog.card_id == card_id).order_by(ReviewLog.created_at.asc())
    logs = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": log.id,
            "card_id": log.card_id,
            "rating": log.rating,
            "interval_before": log.interval_before,
            "interval_after": log.interval_after,
            "ease_after": log.ease_after,
            "created_at": str(log.created_at),
        }
        for log in logs
    ]


def _workspace_response(row: LearnerWorkspaceState | None, student_id: str) -> dict:
    if row is None:
        return {
            "student_id": student_id,
            "version": 0,
            "client_updated_at": 0,
            "state": {},
        }
    return {
        "student_id": row.student_id,
        "version": row.version,
        "client_updated_at": row.client_updated_at,
        "state": row.state if isinstance(row.state, dict) else {},
    }


@router.get("/workspace/{student_id}")
async def get_workspace_state(student_id: str, db: AsyncSession = Depends(get_db)):
    """Return the SQLite-authoritative learner workspace snapshot."""

    return _workspace_response(await db.get(LearnerWorkspaceState, student_id), student_id)


@router.put("/workspace")
async def save_workspace_state(req: WorkspaceStateWrite, db: AsyncSession = Depends(get_db)):
    """Persist the complete cross-page learner state in SQLite."""

    encoded = json.dumps(req.state, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 6 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="学习状态超过 6 MiB，请清理历史资源后重试")
    row = await db.get(LearnerWorkspaceState, req.student_id)
    if row is None:
        if req.expected_version != 0:
            raise HTTPException(status_code=409, detail="学习状态版本冲突，请重新载入")
        row = LearnerWorkspaceState(
            student_id=req.student_id,
            version=1,
            state=req.state,
            client_updated_at=req.client_updated_at,
        )
        db.add(row)
    else:
        # Optimistic concurrency makes SQLite authoritative without trusting
        # clocks from different devices or browser tabs.
        if req.expected_version != int(row.version or 0):
            raise HTTPException(status_code=409, detail="学习状态版本冲突，请重新载入")
        row.version = int(row.version or 0) + 1
        row.state = req.state
        row.client_updated_at = req.client_updated_at
    await db.commit()
    await db.refresh(row)
    return _workspace_response(row, req.student_id)


@router.delete("/workspace/{student_id}")
async def delete_workspace_state(student_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(LearnerWorkspaceState).where(LearnerWorkspaceState.student_id == student_id))
    await db.commit()
    return {"deleted": True}


def _fact_response(fact: SemanticMemoryFact) -> dict:
    return {
        "id": fact.id,
        "category": fact.category,
        "key": fact.key,
        "value": fact.value,
        "confidence": fact.confidence,
        "evidence": fact.evidence,
        "source": fact.source,
        "source_conversation_id": fact.source_conversation_id,
        "status": fact.status,
        "supersedes_id": fact.supersedes_id,
        "created_at": str(fact.created_at),
        "updated_at": str(fact.updated_at),
    }


@router.get("/facts/{student_id}")
async def list_semantic_facts(
    student_id: str,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SemanticMemoryFact).where(SemanticMemoryFact.student_id == student_id)
    if not include_inactive:
        stmt = stmt.where(SemanticMemoryFact.status == "active")
    facts = list((await db.scalars(stmt.order_by(SemanticMemoryFact.updated_at.desc()))).all())
    return [_fact_response(fact) for fact in facts]


@router.post("/facts")
async def save_semantic_fact(req: SemanticFactWrite, db: AsyncSession = Depends(get_db)):
    fact = await upsert_semantic_fact(
        db,
        student_id=req.student_id,
        category=req.category,
        key=req.key,
        value=req.value,
        confidence=req.confidence,
        evidence=req.evidence,
        source="manual",
    )
    await db.commit()
    await db.refresh(fact)
    return _fact_response(fact)


@router.delete("/facts/{student_id}/{fact_id}")
async def forget_semantic_fact(
    student_id: str,
    fact_id: str,
    db: AsyncSession = Depends(get_db),
):
    fact = await db.get(SemanticMemoryFact, fact_id)
    if fact is None or fact.student_id != student_id:
        raise HTTPException(status_code=404, detail="记忆事实不存在")
    fact.status = "deleted"
    fact.valid_until = datetime.utcnow()
    await db.commit()
    return {"deleted": True}


@router.delete("/long-term/{student_id}")
async def clear_long_term_agent_memory(
    student_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete episodic and semantic memory while preserving the current workspace."""

    facts_result = await db.execute(
        delete(SemanticMemoryFact).where(SemanticMemoryFact.student_id == student_id)
    )
    episodes_result = await db.execute(
        delete(MemoryEpisode).where(MemoryEpisode.student_id == student_id)
    )
    await db.commit()
    from app.services.episodic_memory_index import delete_student_episode_index

    await delete_student_episode_index(student_id)
    return {
        "deleted": True,
        "semantic_facts": int(facts_result.rowcount or 0),
        "episodes": int(episodes_result.rowcount or 0),
    }


@router.get("/episodes/{student_id}")
async def list_memory_episodes(
    student_id: str,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    rows = list((await db.scalars(
        select(MemoryEpisode)
        .where(MemoryEpisode.student_id == student_id)
        .order_by(MemoryEpisode.occurred_at.desc(), MemoryEpisode.created_at.desc())
        .limit(max(1, min(limit, 100)))
    )).all())
    return [
        {
            "id": row.id,
            "conversation_id": row.conversation_id,
            "summary": row.summary,
            "structured_summary": row.structured_summary,
            "keywords": row.keywords,
            "importance": row.importance,
            "source_start_index": row.source_start_index,
            "source_end_index": row.source_end_index,
            "source_message_count": row.source_message_count,
            "estimated_tokens": row.estimated_tokens,
            "occurred_at": row.occurred_at,
            "access_count": row.access_count,
        }
        for row in rows
    ]
