"""辅导路由 — 答疑对话。

由 agent harness 驱动（`app/agent/`）：模型可直接作答，也可调用工具
（generate_learning_material 生成学习资料 / search_knowledge_base 检索知识库）。
SSE 事件与前端答疑保持兼容（progress/sources/delta/content/error）。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.runner import agent_chat_sse
from app.core.sse import graph_to_sse as _default_graph_to_sse, sse_format
from app.core.run_control import (
    request_run_cancel,
    run_is_registered,
    run_owner,
    wait_for_cancel_ack,
)
from app.core.config import get_db
from app.models.learning import Assessment, MemoryCard
from app.routers.auth import get_current_account, require_account_student_scope
from app.models.account import UserAccount
from app.services.learner_settings import get_learner_settings
from app.schemas.chat import (
    ChatRequest,
    ClarificationRequest,
    ClarificationResponse,
)

router = APIRouter(dependencies=[Depends(require_account_student_scope)])
logger = logging.getLogger(__name__)

# Legacy integration seam: tests or older callers may monkeypatch this symbol to
# verify the tutor graph state. The production route below still defaults to the
# newer agent harness unless this symbol is replaced.
graph_to_sse = _default_graph_to_sse


@router.post("/attachments")
async def upload_chat_attachment(file: UploadFile = File(...)):
    """Extract a transient tutor attachment; files are never written to disk."""

    from app.services.chat_attachments import AttachmentExtractionError, extract_tutor_attachment

    data = await file.read()
    try:
        payload = await extract_tutor_attachment(
            file.filename or "未命名文件",
            file.content_type or "application/octet-stream",
            data,
        )
    except AttachmentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    payload["id"] = f"attachment_{hashlib.sha256(data).hexdigest()[:16]}"
    # Image bytes are returned only in this transient upload response and are
    # never copied into persisted conversation history. The following chat
    # request sends them directly to MiMo V2.5 native multimodal input.
    payload.setdefault("image_data", "")
    return payload


def _infer_known_requirements(
    request: str,
    profile: dict[str, Any],
    learner_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Extract high-confidence facts; this function never authors questions."""

    inferred: dict[str, Any] = {}
    day_match = re.search(r"(3|7|14|30)\s*天", request)
    minute_match = re.search(r"(20|40|60|90)\s*分(?:钟)?", request)
    if day_match:
        inferred["days"] = int(day_match.group(1))
    if minute_match:
        inferred["daily_minutes"] = int(minute_match.group(1))
    if re.search(r"应试|考试|备考|复习", request):
        inferred["goal"] = "exam"
    elif re.search(r"项目|实战|作品", request):
        inferred["goal"] = "project"
    elif re.search(r"查漏|薄弱|补缺", request):
        inferred["goal"] = "gap"
    elif re.search(r"入门|零基础|系统学", request):
        inferred["goal"] = "starter"

    if learner_settings:
        preferred_minutes = learner_settings.get("daily_minutes")
        preferred_materials = learner_settings.get("material_types")
        if "daily_minutes" not in inferred and preferred_minutes in {20, 40, 60, 90}:
            inferred["daily_minutes"] = preferred_minutes
        if isinstance(preferred_materials, list):
            selected = [
                str(value) for value in preferred_materials
                if str(value) in {
                    "explainer", "quiz", "solution", "reading", "code", "video", "mindmap", "courseware", "interactive"
                }
            ]
            if selected:
                inferred["material_types"] = selected

    pace = profile.get("pace") if isinstance(profile, dict) else {}
    if "daily_minutes" not in inferred and isinstance(pace, dict):
        preferred = pace.get("preferred_duration_min")
        if preferred in {20, 40, 60, 90}:
            inferred["daily_minutes"] = preferred
    knowledge = profile.get("knowledge_level") if isinstance(profile, dict) else {}
    scores = [value.get("score") for value in knowledge.values() if isinstance(value, dict) and isinstance(value.get("score"), (int, float))] if isinstance(knowledge, dict) else []
    if scores:
        average = sum(scores) / len(scores)
        inferred["baseline_level"] = "advanced" if average >= .8 else "intermediate" if average >= .6 else "basic" if average >= .35 else "novice"
        inferred["baseline_source"] = "existing_profile"
    return inferred


@router.post("")
async def chat(req: ChatRequest):
    """辅导答疑（agent + 工具，SSE 流式）。"""
    if graph_to_sse is not _default_graph_to_sse:
        from app.graph.tutor_graph import tutor_app

        state = {
            "student_id": req.student_id,
            "question": req.message,
            "history": [item.model_dump() for item in req.history],
            "image_data": req.image_data,
            "kb_context": [],
            "profile": {},
            "answer": "",
            "sources": [],
        }
        return StreamingResponse(
            graph_to_sse(tutor_app, state),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        agent_chat_sse(req),
        media_type="text/event-stream",
    )


ReasoningDeltaCallback = Callable[[str, bool], Awaitable[None]]


def _message_text(message: Any) -> str:
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(item.get("text", ""))
            if isinstance(item, dict)
            else str(item)
            for item in content
        )
    return str(content or "")


def _partial_json_string(text: str, key: str) -> tuple[str, bool]:
    """Decode one JSON string while the model is still streaming it."""

    match = re.search(rf'"{re.escape(key)}"\s*:\s*"', text)
    if not match:
        return "", False
    index = match.end()
    decoded: list[str] = []
    while index < len(text):
        char = text[index]
        if char == '"':
            return "".join(decoded), True
        if char != "\\":
            decoded.append(char)
            index += 1
            continue
        if index + 1 >= len(text):
            break
        escaped = text[index + 1]
        replacements = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        if escaped == "u":
            digits = text[index + 2:index + 6]
            if len(digits) < 4 or not re.fullmatch(r"[0-9a-fA-F]{4}", digits):
                break
            decoded.append(chr(int(digits, 16)))
            index += 6
            continue
        decoded.append(replacements.get(escaped, escaped))
        index += 2
    return "".join(decoded), False


async def _stream_json_response(
    llm: Any,
    messages: list[dict[str, str]],
    on_reasoning_delta: ReasoningDeltaCallback,
    *,
    reset: bool,
) -> tuple[str, str]:
    if reset:
        await on_reasoning_delta("", True)
    raw = ""
    streamed_reasoning = ""
    async for chunk in llm.astream(messages):
        text = _message_text(chunk)
        if not text:
            continue
        raw += text
        current, _complete = _partial_json_string(raw, "public_reasoning")
        current = current[:500]
        if current.startswith(streamed_reasoning):
            delta = current[len(streamed_reasoning):]
            if delta:
                await on_reasoning_delta(delta, False)
        elif current != streamed_reasoning:
            await on_reasoning_delta(current, True)
        streamed_reasoning = current
    return raw, streamed_reasoning


async def _stream_public_task_summary(
    req: ClarificationRequest,
    on_reasoning_delta: ReasoningDeltaCallback,
) -> str:
    """Use a separate narrator model to remove the silent pre-analysis gap."""

    from app.core.llm import build_llm

    try:
        narrator = build_llm(
            temperature=0.2,
            streaming=True,
            max_tokens=180,
        )
        messages = [
            {
                "role": "system",
                "content": (
                    "你是学习任务的公开摘要员。只根据收到的真实输入，用一到两句中文说明"
                    "当前需要解决的任务和刚获得的约束；不要输出私密思维链，不要写固定流程、"
                    "进度播报、工具名称或尚未发生的结论。直接输出自然语言摘要。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"任务：{req.request}\n"
                    f"阶段：{req.phase}\n"
                    f"本轮用户回答：{json.dumps(req.answers, ensure_ascii=False, default=str)[:2200]}"
                ),
            },
        ]
        accumulated = ""
        async for chunk in narrator.astream(messages):
            text = _message_text(chunk)
            if not text or len(accumulated) >= 360:
                continue
            delta = text[:360 - len(accumulated)]
            accumulated += delta
            await on_reasoning_delta(delta, False)
        return accumulated.strip()
    except Exception:
        logger.exception("public task narrator failed")
        return ""


def _merge_explicit_answers(
    inferred: dict[str, Any],
    answers: dict[str, Any],
    *,
    contract_keys: set[str],
) -> None:
    allowed: dict[str, set[Any]] = {
        "baseline_level": {"novice", "basic", "intermediate", "advanced"},
        "baseline_source": {"existing_profile", "diagnostic", "self_report", "explicit_default"},
        "goal": {"starter", "exam", "project", "gap"},
        "days": {3, 7, 14, 30},
        "daily_minutes": {20, 40, 60, 90},
    }
    valid_materials = {
        "explainer", "quiz", "solution", "reading", "code", "video",
        "mindmap", "courseware", "interactive",
    }
    for key, choices in allowed.items():
        value = answers.get(key)
        if value in choices:
            inferred[key] = value
    material_types = answers.get("material_types")
    if isinstance(material_types, list):
        selected = [str(value) for value in material_types if value in valid_materials]
        if selected:
            inferred["material_types"] = selected
    for key in contract_keys - set(allowed) - {"material_types"}:
        value = answers.get(key)
        if isinstance(value, str) and value.strip():
            inferred[key] = value.strip()[:600]
        elif isinstance(value, (int, float, bool)):
            inferred[key] = value
        elif isinstance(value, list):
            inferred[key] = [str(item)[:120] for item in value[:12]]


def _fallback_clarification_summary(
    req: ClarificationRequest,
    inferred: dict[str, Any],
    questions: list[Any],
) -> str:
    """Build a factual public decision summary when model JSON omits one."""

    labels = {
        "baseline_level": "当前基础",
        "goal": "学习目标",
        "days": "学习周期",
        "daily_minutes": "每日投入",
        "material_types": "资料偏好",
    }
    known = [
        labels[field]
        for field in labels
        if field in inferred
    ]
    missing = [
        labels.get(str(getattr(question, "field", "")), str(getattr(question, "field", "")))
        for question in questions
        if getattr(question, "field", None)
    ]
    if missing:
        known_text = f"已从当前请求和学习信息中确认{('、'.join(known))}" if known else "当前请求已明确任务主题"
        return (
            f"{known_text}；还需确认{('、'.join(missing))}，"
            "这些信息会直接改变学习内容的起点、节奏或交付形式。"
        )[:500]
    if req.phase == "confirmed":
        return "本轮补充信息已经覆盖执行所需约束，可以据此复核并进入学习任务规划。"[:500]
    return "当前请求与已有学习信息已经覆盖执行所需约束，可以直接进入学习任务规划。"[:500]


async def _evaluate_clarification(
    req: ClarificationRequest,
    db: AsyncSession,
    *,
    on_reasoning_delta: ReasoningDeltaCallback | None = None,
) -> ClarificationResponse:
    """Build/reuse a specialist contract, then let the main agent assess it."""

    from app.agents.common import format_untrusted_knowledge_context
    from app.agents.profiler import get_profile
    from app.core.llm import build_llm, parse_json_response
    from app.services.rag import retrieve_with_sources
    from app.services.requirement_contracts import (
        fallback_runtime_questions,
        find_requirement_contract,
        learning_path_execution_contract_fields,
        normalize_contract_fields,
        normalize_runtime_questions,
        save_requirement_contract,
    )

    narrator_task = (
        asyncio.create_task(_stream_public_task_summary(req, on_reasoning_delta))
        if on_reasoning_delta is not None
        else None
    )
    profile = await asyncio.to_thread(get_profile, req.student_id)
    learner_settings = await get_learner_settings(db, req.student_id)
    assessment = (
        await db.execute(
            select(Assessment)
            .where(Assessment.student_id == req.student_id)
            .order_by(desc(Assessment.created_at))
            .limit(1)
        )
    ).scalar_one_or_none()
    memory_cards = list((
        await db.execute(
            select(MemoryCard)
            .where(MemoryCard.student_id == req.student_id)
            .order_by(desc(MemoryCard.created_at))
            .limit(8)
        )
    ).scalars().all())
    try:
        kb_context, kb_sources = await asyncio.to_thread(
            retrieve_with_sources,
            req.request,
            req.student_id,
            4,
        )
    except Exception:
        kb_context, kb_sources = [], []

    inferred = _infer_known_requirements(req.request, profile, learner_settings)
    context_sources = ["当前请求", "学习画像", "个性化设置"]
    if assessment is not None:
        context_sources.append("最近摸底测试")
    if memory_cards:
        context_sources.append("学习记忆")
    if kb_sources:
        context_sources.append("课程知识库")

    learner_evidence = {
        "profile": profile,
        "learner_settings": learner_settings,
        "latest_assessment": {
            "subject": assessment.subject,
            "self_level": assessment.self_level,
            "analysis": assessment.analysis,
        } if assessment is not None else None,
        "memory": [
            {"topic": card.topic, "knowledge_point": card.knowledge_point, "state": card.state}
            for card in memory_cards
        ],
    }
    narrator_summary = ""
    if narrator_task is not None:
        narrator_summary = await narrator_task
        if narrator_summary:
            await on_reasoning_delta("\n\n", False)
    try:
        llm = build_llm(
            temperature=0.1,
            streaming=on_reasoning_delta is not None,
            response_format={"type": "json_object"},
            max_tokens=1800,
        )

        contract_row = await find_requirement_contract(
            db,
            task_family=req.task_family,
            owner_agent=req.owner_agent,
        )
        contract_source = "reused"
        if contract_row is None:
            specialist_system = f"""你是负责 {req.task_family} 任务的专职智能体（标识：{req.owner_agent}）。
请自主定义一份可供同类任务长期复用的“需求契约”。这不是向当前用户提问，不要写固定问卷题目；
只定义执行前可能需要核对的语义字段、字段用途、是否必需、能否从上下文推断，以及生成选项时的指导。
字段 kind 只能是 single、multiple、text。对于 learning_path，执行器确实需要 baseline_level、goal、days、
daily_minutes、material_types 五个 required 字段；可按专业判断增加少量真正有用的可选字段。
输出纯 JSON：
{{"fields":[{{"field":"...","label":"...","description":"...","kind":"single","required":true,"inferable":true,"option_guidance":"..."}}]}}"""
            try:
                specialist_response = await asyncio.to_thread(
                    llm.invoke,
                    [
                        {"role": "system", "content": specialist_system},
                        {
                            "role": "user",
                            "content": (
                                f"任务类别：{req.task_family}\n"
                                f"负责智能体：{req.owner_agent}\n"
                                "请生成稳定、精简、可复用的需求契约。"
                            ),
                        },
                    ],
                )
                specialist_raw = parse_json_response(_message_text(specialist_response))
                contract_fields = normalize_contract_fields(
                    specialist_raw.get("fields"),
                    task_family=req.task_family,
                )
            except Exception:
                if req.task_family != "learning_path":
                    raise
                logger.warning(
                    "specialist contract output was invalid; using executor-safe contract",
                    exc_info=True,
                )
                contract_fields = learning_path_execution_contract_fields()
            contract_row = await save_requirement_contract(
                db,
                task_family=req.task_family,
                owner_agent=req.owner_agent,
                fields=contract_fields,
            )
            contract_source = "generated"
        else:
            try:
                contract_fields = normalize_contract_fields(
                    (contract_row.contract or {}).get("fields"),
                    task_family=req.task_family,
                )
            except Exception:
                if req.task_family != "learning_path":
                    raise
                logger.warning(
                    "saved requirement contract was invalid; repairing it",
                    exc_info=True,
                )
                contract_fields = learning_path_execution_contract_fields()
                contract_row.contract = {
                    "fields": [field.model_dump() for field in contract_fields],
                }
            contract_row.usage_count += 1
            await db.commit()

        contract_keys = {field.field for field in contract_fields}
        if req.answers:
            _merge_explicit_answers(
                inferred,
                req.answers,
                contract_keys=contract_keys,
            )
            context_sources.append("本轮用户确认")

        evaluator_system = """你是统筹生成任务的主智能体。请把当前用户请求、已有学习证据与负责智能体提供的需求契约逐项对照。
契约是判断依据，不是必须向用户展示的问卷。能从当前请求、画像、设置、摸底、记忆或课程上下文可靠获得的信息写入 inferred；
只有缺失且会实质改变执行结果的条件才生成 question。不得重复询问已有信息，不得为了走流程而提问，也不得擅自替用户决定关键偏好。
若请求处于 confirmed 阶段，用户刚提交的答案是新的外部输入；必须重新生成一段公开判断摘要，说明这些答案如何消除不确定性以及将怎样约束后续规划。
confirmed 阶段不得重复询问已明确回答的字段；所有必需字段齐备时直接 decision=execute、questions=[]。
每个问题及其选项都必须针对当前任务重新措辞；需要自由表达时用 text，或设置 allow_custom=true 并提供 custom_placeholder。
single/multiple 必须有 2-10 个 options。最多 6 个问题。
learning_path 执行器的值域为：baseline_level=novice|basic|intermediate|advanced，
goal=starter|exam|project|gap，days=3|7|14|30，daily_minutes=20|40|60|90，
material_types=explainer|quiz|solution|reading|code|video|mindmap|courseware|interactive。
这些执行字段的 option.value 必须使用上述机器值且不允许自定义；其他补充约束可允许用户自由填写。
public_reasoning 必须是你本轮基于真实输入生成的、可公开的判断摘要：具体说明哪些证据已经够用、还缺什么以及为何询问；
不要输出私密草稿、逐 token 思维或套话。若信息足够，questions 必须为空且 decision=execute。
public_reasoning 必须作为 JSON 的第一个字段，以便界面实时流式展示。输出纯 JSON：
{"public_reasoning":"...","inferred":{},"decision":"execute|ask","questions":[{"field":"...","text":"...","reason":"...","kind":"single","options":[{"value":"...","label":"...","detail":"..."}],"allow_custom":false,"custom_placeholder":""}]}"""
        evaluator_user = (
            f"用户请求：{req.request}\n"
            f"当前阶段：{req.phase}\n"
            f"任务类别：{req.task_family}\n"
            f"负责智能体：{req.owner_agent}\n"
            f"需求契约：{json.dumps([field.model_dump() for field in contract_fields], ensure_ascii=False)}\n"
            f"服务端已确认事实：{json.dumps(inferred, ensure_ascii=False)}\n"
            f"用户本轮明确回答：{json.dumps(req.answers, ensure_ascii=False, default=str)[:3000]}\n"
            f"已有学习证据：{json.dumps(learner_evidence, ensure_ascii=False, default=str)[:7000]}\n"
            f"{format_untrusted_knowledge_context(kb_context, max_sources=4, max_content_chars=360, max_total_chars=1600)}"
        )
        allowed = {
            "baseline_level": {"novice", "basic", "intermediate", "advanced"},
            "baseline_source": {"existing_profile", "diagnostic", "self_report", "explicit_default"},
            "goal": {"starter", "exam", "project", "gap"},
            "days": {3, 7, 14, 30},
            "daily_minutes": {20, 40, 60, 90},
        }
        valid_materials = {
            "explainer", "quiz", "solution", "reading", "code", "video", "mindmap", "courseware", "interactive"
        }
        normalized_questions = []
        public_reasoning = ""
        uncovered_required: set[str] = {
            field.field
            for field in contract_fields
            if field.required and field.field not in inferred
        }
        validation_feedback = ""
        displayed_reasoning = narrator_summary
        for attempt in range(2):
            messages = [
                {"role": "system", "content": evaluator_system},
                {
                    "role": "user",
                    "content": evaluator_user + validation_feedback,
                },
            ]
            streamed_reasoning = ""
            try:
                if on_reasoning_delta is not None:
                    response_text, streamed_reasoning = await _stream_json_response(
                        llm,
                        messages,
                        on_reasoning_delta,
                        reset=attempt > 0,
                    )
                    displayed_reasoning = streamed_reasoning
                else:
                    response = await asyncio.to_thread(llm.invoke, messages)
                    response_text = _message_text(response)
                raw = parse_json_response(response_text)
            except Exception:
                if attempt > 0:
                    displayed_reasoning = ""
                logger.warning(
                    "main clarification evaluation attempt %s returned invalid output",
                    attempt + 1,
                    exc_info=True,
                )
                validation_feedback = (
                    "\n\n上一版不是可验证的 JSON。请只返回契约要求的完整 JSON，"
                    "并确保 public_reasoning 是第一个字段。"
                )
                continue
            model_inferred = raw.get("inferred") if isinstance(raw.get("inferred"), dict) else {}
            for key, choices in allowed.items():
                value = model_inferred.get(key)
                if value in choices:
                    inferred[key] = value
            material_types = model_inferred.get("material_types")
            if isinstance(material_types, list):
                selected = [str(value) for value in material_types if value in valid_materials]
                if selected:
                    inferred["material_types"] = selected
            refinement = str(model_inferred.get("request_refinement") or "").strip()
            if refinement:
                inferred["request_refinement"] = refinement[:600]
            for key in contract_keys - set(allowed) - {"material_types"}:
                value = model_inferred.get(key)
                if isinstance(value, str) and value.strip():
                    inferred[key] = value.strip()[:600]
                elif isinstance(value, (int, float, bool)):
                    inferred[key] = value
                elif isinstance(value, list):
                    inferred[key] = [str(item)[:120] for item in value[:12]]

            normalized_questions = normalize_runtime_questions(
                raw.get("questions"),
                contract_fields=contract_fields,
                inferred=inferred,
            )
            question_fields = {question.field for question in normalized_questions}
            uncovered_required = {
                field.field
                for field in contract_fields
                if field.required and field.field not in inferred and field.field not in question_fields
            }
            public_reasoning = str(raw.get("public_reasoning") or "").strip()
            if on_reasoning_delta is not None:
                visible_reasoning = public_reasoning[:500]
                if visible_reasoning.startswith(streamed_reasoning):
                    remainder = visible_reasoning[len(streamed_reasoning):]
                    if remainder:
                        await on_reasoning_delta(remainder, False)
                        displayed_reasoning = f"{streamed_reasoning}{remainder}"
                elif visible_reasoning != streamed_reasoning:
                    await on_reasoning_delta(visible_reasoning, True)
                    displayed_reasoning = visible_reasoning
            if public_reasoning and not uncovered_required:
                break
            validation_feedback = (
                "\n\n上一版结果未通过契约校验。请重新输出完整 JSON；"
                f"仍未推断或提问的必需字段：{sorted(uncovered_required)}；"
                f"公开判断摘要是否缺失：{not bool(public_reasoning)}。"
                "问题文字和选项仍须由你结合当前任务生成。"
            )
        if uncovered_required:
            existing_fields = {question.field for question in normalized_questions}
            normalized_questions.extend(
                question
                for question in fallback_runtime_questions(
                    contract_fields=contract_fields,
                    inferred=inferred,
                    only_fields=uncovered_required,
                )
                if question.field not in existing_fields
            )
            normalized_questions = normalized_questions[:8]
            question_fields = {question.field for question in normalized_questions}
            uncovered_required = {
                field.field
                for field in contract_fields
                if field.required and field.field not in inferred and field.field not in question_fields
            }
        if uncovered_required:
            raise ValueError(
                "could not recover required contract fields: "
                + ", ".join(sorted(uncovered_required))
            )
        if not public_reasoning:
            public_reasoning = narrator_summary or _fallback_clarification_summary(
                req,
                inferred,
                normalized_questions,
            )
        if (
            on_reasoning_delta is not None
            and public_reasoning[:500].strip() != displayed_reasoning.strip()
        ):
            await on_reasoning_delta(public_reasoning[:500], True)
        decision = "ask" if normalized_questions else "execute"
        return ClarificationResponse(
            summary=public_reasoning[:500],
            inferred=inferred,
            questions=normalized_questions,
            context_sources=context_sources,
            source="model",
            decision=decision,
            requirement_contract_id=contract_row.id,
            requirement_contract_source=contract_source,
            requirement_contract_owner=req.owner_agent,
            requirement_fields=contract_fields,
        )
    except Exception as exc:
        logger.exception(
            "clarification contract evaluation failed for task_family=%s owner_agent=%s",
            req.task_family,
            req.owner_agent,
        )
        raise HTTPException(
            status_code=503,
            detail={
                "code": "clarification_model_unavailable",
                "message": "负责智能体暂未返回可验证的需求契约或公开判断摘要，请稍后重试。",
                "retryable": True,
            },
        ) from exc


@router.post("/clarify", response_model=ClarificationResponse)
async def clarify_request(
    req: ClarificationRequest,
    db: AsyncSession = Depends(get_db),
):
    return await _evaluate_clarification(req, db)


async def _clarification_sse(
    req: ClarificationRequest,
    db: AsyncSession,
):
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def on_reasoning_delta(text: str, reset: bool) -> None:
        await queue.put((
            "reasoning_reset" if reset else "reasoning_delta",
            {"text": text},
        ))

    async def evaluate() -> None:
        try:
            result = await _evaluate_clarification(
                req,
                db,
                on_reasoning_delta=on_reasoning_delta,
            )
            await queue.put(("result", result.model_dump(mode="json")))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {
                "message": str(exc.detail),
            }
            await queue.put(("error", detail))
        except Exception:
            logger.exception("streaming clarification failed")
            await queue.put(("error", {
                "code": "clarification_stream_failed",
                "message": "需求对照流中断，请重试。",
                "retryable": True,
            }))
        finally:
            await queue.put(None)

    task = asyncio.create_task(evaluate())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            event, payload = item
            yield sse_format(event, payload)
        await task
    finally:
        if not task.done():
            task.cancel()


@router.post("/clarify/stream")
async def clarify_request_stream(
    req: ClarificationRequest,
    db: AsyncSession = Depends(get_db),
):
    return StreamingResponse(
        _clarification_sse(req, db),
        media_type="text/event-stream",
    )


@router.post("/runs/{run_id}/cancel")
async def cancel_chat_run(
    run_id: str,
    account: UserAccount = Depends(get_current_account),
):
    """Request cooperative cancellation while the caller keeps SSE open.

    Acknowledged cancellation is also emitted on the original SSE as the real
    cancelled root trace followed by ``done(status=cancelled)``.
    """

    if not run_is_registered(run_id):
        raise HTTPException(status_code=404, detail="运行不存在或已结束")
    owner_id = run_owner(run_id)
    if owner_id and owner_id != account.id:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "run_scope_forbidden",
                "message": "不能停止其他学习者的运行。",
            },
        )
    request_run_cancel(run_id)
    acknowledged = await asyncio.to_thread(wait_for_cancel_ack, run_id, 2.0)
    return {
        "run_id": run_id,
        "status": "cancelled" if acknowledged else "cancelling",
        "acknowledged": acknowledged,
        "message": (
            "运行已停止，终态已写入原 SSE"
            if acknowledged
            else "已请求停止；当前模型调用结束后不会再发起新调用"
        ),
    }
