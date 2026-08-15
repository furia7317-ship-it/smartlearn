"""Model-authored, reusable requirement contracts for generation agents."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.learning import AgentRequirementContract
from app.schemas.chat import ClarificationOption, ClarificationQuestion, RequirementContractField


LEARNING_PATH_EXECUTION_FIELDS = {
    "baseline_level",
    "goal",
    "days",
    "daily_minutes",
    "material_types",
}
EXECUTION_VALUE_SETS = {
    "baseline_level": {"novice", "basic", "intermediate", "advanced"},
    "goal": {"starter", "exam", "project", "gap"},
    "days": {"3", "7", "14", "30"},
    "daily_minutes": {"20", "40", "60", "90"},
    "material_types": {
        "explainer", "quiz", "solution", "reading", "code",
        "video", "mindmap", "courseware", "interactive",
    },
}
EXECUTION_FIELD_KINDS = {
    "baseline_level": "single",
    "goal": "single",
    "days": "single",
    "daily_minutes": "single",
    "material_types": "multiple",
}
LEARNING_PATH_EXECUTION_CONTRACT = {
    "baseline_level": {
        "label": "当前基础",
        "description": "确定学习路径的起点与讲解深度",
        "kind": "single",
        "option_guidance": "使用从零基础到进阶的四档掌握程度",
    },
    "goal": {
        "label": "学习目标",
        "description": "确定路径最终要达成的学习结果",
        "kind": "single",
        "option_guidance": "覆盖系统入门、应试复习、项目实战与查漏补缺",
    },
    "days": {
        "label": "学习周期",
        "description": "确定学习任务的总天数",
        "kind": "single",
        "option_guidance": "使用执行器支持的 3、7、14、30 天",
    },
    "daily_minutes": {
        "label": "每日投入",
        "description": "确定每天可安排的学习时长",
        "kind": "single",
        "option_guidance": "使用执行器支持的 20、40、60、90 分钟",
    },
    "material_types": {
        "label": "资料偏好",
        "description": "确定路径中需要生成的资料形态",
        "kind": "multiple",
        "option_guidance": "从讲义、练习、解析、阅读、代码、视频、导图、课件和交互演示中选择",
    },
}
LEARNING_PATH_QUESTION_COPY = {
    "baseline_level": {
        "text": "为了确定这条学习路径的起点，你目前对相关内容的掌握程度如何？",
        "reason": "起点会直接影响讲解深度和练习难度。",
        "options": [
            ("novice", "几乎零基础", "希望从术语和直观概念开始"),
            ("basic", "了解少量概念", "知道部分术语，但还不能独立运用"),
            ("intermediate", "能完成基础题", "基础概念较熟悉，希望加强应用"),
            ("advanced", "希望进阶与查漏", "已有系统基础，需要深化与补缺"),
        ],
    },
    "goal": {
        "text": "这次学习路径最希望帮你达成什么目标？",
        "reason": "目标决定内容取舍、练习方式和最终产出。",
        "options": [
            ("starter", "系统入门", "建立完整的基础知识框架"),
            ("exam", "应试复习", "围绕考点、题型和易错点训练"),
            ("project", "项目实战", "以可落地的任务和代码实践为主"),
            ("gap", "查漏补缺", "定位薄弱环节并集中强化"),
        ],
    },
    "days": {
        "text": "你希望用多长时间完成这条学习路径？",
        "reason": "周期会决定每天的知识密度和复习节奏。",
        "options": [
            ("3", "3 天", "短期集中学习"),
            ("7", "7 天", "一周完成"),
            ("14", "14 天", "两周稳步推进"),
            ("30", "30 天", "一个月系统学习"),
        ],
    },
    "daily_minutes": {
        "text": "每天大约可以投入多少学习时间？",
        "reason": "每日时长决定每个学习单元的容量。",
        "options": [
            ("20", "20 分钟", "轻量学习"),
            ("40", "40 分钟", "适中节奏"),
            ("60", "60 分钟", "完整学习单元"),
            ("90", "90 分钟", "深度学习与练习"),
        ],
    },
    "material_types": {
        "text": "希望这条路径优先生成哪些学习资料？",
        "reason": "资料形式会影响每一天的学习活动安排。",
        "options": [
            ("explainer", "讲义", "结构化讲解核心内容"),
            ("quiz", "练习题", "边学边测"),
            ("solution", "题目解析", "拆解思路和易错点"),
            ("reading", "扩展阅读", "补充背景和延伸知识"),
            ("code", "代码示例", "结合实现理解概念"),
            ("video", "讲解视频", "用视听方式学习"),
            ("mindmap", "思维导图", "建立知识结构"),
            ("courseware", "课件", "按教学单元组织内容"),
            ("interactive", "交互演示", "通过操作观察规律"),
        ],
    },
}


def learning_path_execution_contract_fields() -> list[RequirementContractField]:
    """Return the minimum machine contract required by the path executor."""

    return [
        RequirementContractField(
            field=field,
            label=str(definition["label"]),
            description=str(definition["description"]),
            kind=str(definition["kind"]),
            required=True,
            inferable=True,
            option_guidance=str(definition["option_guidance"]),
        )
        for field, definition in LEARNING_PATH_EXECUTION_CONTRACT.items()
    ]


def normalize_contract_fields(
    raw: Any,
    *,
    task_family: str,
) -> list[RequirementContractField]:
    """Validate a specialist-authored schema without inventing field copy."""

    fields: list[RequirementContractField] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()[:64]
        label = str(item.get("label") or "").strip()[:120]
        kind = str(item.get("kind") or "single")
        if (
            not field
            or field in seen
            or not label
            or kind not in {"single", "multiple", "text"}
        ):
            continue
        seen.add(field)
        fields.append(RequirementContractField(
            field=field,
            label=label,
            description=str(item.get("description") or "").strip()[:240],
            kind=EXECUTION_FIELD_KINDS.get(field, kind),
            required=bool(item.get("required", True)),
            inferable=bool(item.get("inferable", True)),
            option_guidance=str(item.get("option_guidance") or "").strip()[:240],
        ))
    fields = fields[:12]
    if task_family == "learning_path":
        by_name = {field.field: field for field in fields}
        execution_fields: list[RequirementContractField] = []
        for fallback in learning_path_execution_contract_fields():
            existing = by_name.get(fallback.field)
            if existing is not None and existing.required:
                execution_fields.append(existing)
            else:
                execution_fields.append(fallback)
        optional_fields = [
            field
            for field in fields
            if field.field not in LEARNING_PATH_EXECUTION_FIELDS
        ]
        fields = [*execution_fields, *optional_fields][:12]
    if not fields:
        raise ValueError("specialist returned an empty requirement contract")
    return fields


def normalize_runtime_questions(
    raw: Any,
    *,
    contract_fields: list[RequirementContractField],
    inferred: dict[str, Any],
) -> list[ClarificationQuestion]:
    """Keep only model-authored questions permitted by the reused contract."""

    contract = {item.field: item for item in contract_fields}
    questions: list[ClarificationQuestion] = []
    seen: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()[:64]
        text = str(item.get("text") or "").strip()[:240]
        definition = contract.get(field)
        kind = str(item.get("kind") or (definition.kind if definition else "single"))
        if (
            not field
            or field in seen
            or field in inferred
            or definition is None
            or not text
            or kind not in {"single", "multiple", "text"}
        ):
            continue
        options: list[ClarificationOption] = []
        for option in item.get("options", []) if isinstance(item.get("options"), list) else []:
            if not isinstance(option, dict):
                continue
            value = str(option.get("value") or "").strip()[:80]
            label = str(option.get("label") or "").strip()[:120]
            allowed_values = EXECUTION_VALUE_SETS.get(field)
            if allowed_values is not None and value not in allowed_values:
                continue
            if value and label:
                options.append(ClarificationOption(
                    value=value,
                    label=label,
                    detail=str(option.get("detail") or "").strip()[:240],
                ))
        if kind != "text" and len(options) < 2:
            continue
        seen.add(field)
        questions.append(ClarificationQuestion(
            field=field,
            text=text,
            reason=str(item.get("reason") or "").strip()[:240],
            kind=kind,
            options=options[:10],
            required=definition.required,
            allow_custom=bool(item.get("allow_custom", False)) and field not in EXECUTION_VALUE_SETS,
            custom_placeholder=str(item.get("custom_placeholder") or "").strip()[:160],
        ))
    return questions[:8]


def fallback_runtime_questions(
    *,
    contract_fields: list[RequirementContractField],
    inferred: dict[str, Any],
    only_fields: set[str] | None = None,
) -> list[ClarificationQuestion]:
    """Recover missing required questions when a model response is malformed.

    Model-authored questions always win. This last-resort copy keeps a learning
    task executable instead of exposing a provider formatting failure to the
    learner.
    """

    questions: list[ClarificationQuestion] = []
    for definition in contract_fields:
        field = definition.field
        if not definition.required or field in inferred:
            continue
        if only_fields is not None and field not in only_fields:
            continue
        copy = LEARNING_PATH_QUESTION_COPY.get(field)
        if copy is not None:
            options = [
                ClarificationOption(value=value, label=label, detail=detail)
                for value, label, detail in copy["options"]
            ]
            questions.append(ClarificationQuestion(
                field=field,
                text=str(copy["text"]),
                reason=str(copy["reason"]),
                kind=EXECUTION_FIELD_KINDS[field],
                options=options,
                required=True,
            ))
            continue
        questions.append(ClarificationQuestion(
            field=field,
            text=f"请补充“{definition.label}”。",
            reason=definition.description or "这项信息会影响任务执行结果。",
            kind="text",
            options=[],
            required=True,
            allow_custom=True,
            custom_placeholder=definition.description or f"填写{definition.label}",
        ))
    return questions[:8]


async def find_requirement_contract(
    db: AsyncSession,
    *,
    task_family: str,
    owner_agent: str,
) -> AgentRequirementContract | None:
    return (
        await db.execute(
            select(AgentRequirementContract).where(
                AgentRequirementContract.task_family == task_family,
                AgentRequirementContract.owner_agent == owner_agent,
            )
        )
    ).scalar_one_or_none()


async def save_requirement_contract(
    db: AsyncSession,
    *,
    task_family: str,
    owner_agent: str,
    fields: list[RequirementContractField],
) -> AgentRequirementContract:
    row = AgentRequirementContract(
        id=f"contract_{uuid.uuid4().hex}",
        task_family=task_family,
        owner_agent=owner_agent,
        contract={"fields": [field.model_dump() for field in fields]},
        usage_count=1,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row
