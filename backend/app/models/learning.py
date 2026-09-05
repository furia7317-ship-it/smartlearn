"""学习路径、试卷、错题、目标模型。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, BigInteger, Boolean, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LearningPath(Base):
    """学习路径 — 按知识点组织的树状结构。"""

    __tablename__ = "learning_paths"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    topic: Mapped[str] = mapped_column(String(256))
    nodes: Mapped[dict] = mapped_column(JSON, default=list)
    # [{id, title, knowledge_points, status, children: [...]}]
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class ResourceGenerationPlan(Base):
    """Editable plan and resumable execution state for generated resources."""

    __tablename__ = "resource_generation_plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), index=True)
    request_text: Mapped[str] = mapped_column(Text)
    artifact: Mapped[dict] = mapped_column(JSON, default=dict)
    validation: Mapped[dict] = mapped_column(JSON, default=dict)
    execution_state: Mapped[dict] = mapped_column(JSON, default=dict)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class AgentRequirementContract(Base):
    """Reusable input contract authored by the specialist that owns a task."""

    __tablename__ = "agent_requirement_contracts"
    __table_args__ = (
        UniqueConstraint("task_family", "owner_agent", name="uq_requirement_contract_owner"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    task_family: Mapped[str] = mapped_column(String(64), index=True)
    owner_agent: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    contract: Mapped[dict] = mapped_column(JSON, default=dict)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class ConversationSyncState(Base):
    """Atomic version gate for all conversation mutations of one account."""

    __tablename__ = "conversation_sync_states"

    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ConversationSessionRecord(Base):
    """Persisted teacher conversation, including resource-specific QA sessions."""

    __tablename__ = "conversation_sessions"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(256), default="新会话")
    kind: Mapped[str] = mapped_column(String(32), default="general", index=True)
    teacher: Mapped[str] = mapped_column(String(32), default="raccoon")
    entry_channel: Mapped[str] = mapped_column(String(32), default="desktop", index=True)
    context_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    messages: Mapped[list] = mapped_column(JSON, default=list)
    resource_id: Mapped[str] = mapped_column(String(160), default="")
    resource_title: Mapped[str] = mapped_column(String(256), default="")
    resource_context: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    client_updated_at: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LearnerWorkspaceState(Base):
    """SQLite-owned durable workspace snapshot for one learner.

    The browser may import a legacy local snapshot once, but this row is the
    canonical store for cross-page learning state after migration.
    """

    __tablename__ = "learner_workspace_states"

    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    client_updated_at: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LearnerPreferenceSettings(Base):
    """SQLite-backed learner-controlled teaching, planning and privacy defaults."""

    __tablename__ = "learner_preference_settings"

    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class RuntimeAppSetting(Base):
    """SQLite-owned application setting shared by all learning agents."""

    __tablename__ = "runtime_app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LLMProviderConfig(Base):
    """User-managed OpenAI-compatible provider stored on the local machine."""

    __tablename__ = "llm_provider_configs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    base_url: Mapped[str] = mapped_column(String(512))
    api_key: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class CodeExercise(Base):
    """AI-generated daily coding exercise with server-owned hidden tests."""

    __tablename__ = "code_exercises"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    learning_date: Mapped[str] = mapped_column(String(16), index=True)
    context_title: Mapped[str] = mapped_column(String(256), default="")
    learning_context: Mapped[str] = mapped_column(Text, default="")
    title: Mapped[str] = mapped_column(String(256))
    prompt: Mapped[str] = mapped_column(Text)
    difficulty: Mapped[str] = mapped_column(String(32), default="适中")
    knowledge_points: Mapped[list] = mapped_column(JSON, default=list)
    constraints: Mapped[list] = mapped_column(JSON, default=list)
    starter_code: Mapped[str] = mapped_column(Text)
    function_name: Mapped[str] = mapped_column(String(80))
    examples: Mapped[list] = mapped_column(JSON, default=list)
    hidden_tests: Mapped[list] = mapped_column(JSON, default=list)
    ai_status: Mapped[str] = mapped_column(String(24), default="completed")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CodeSubmission(Base):
    """One immutable code submission and its authoritative grading evidence."""

    __tablename__ = "code_submissions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    exercise_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    code: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    passed_tests: Mapped[int] = mapped_column(Integer, default=0)
    total_tests: Mapped[int] = mapped_column(Integer, default=0)
    feedback: Mapped[dict] = mapped_column(JSON, default=dict)
    execution: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class MemoryEpisode(Base):
    """Compressed autobiographical episode derived from one conversation."""

    __tablename__ = "memory_episodes"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(96), default="", index=True)
    source_fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    summary: Mapped[str] = mapped_column(Text)
    structured_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    source_start_index: Mapped[int] = mapped_column(Integer, default=0)
    source_end_index: Mapped[int] = mapped_column(Integer, default=0)
    source_message_count: Mapped[int] = mapped_column(Integer, default=0)
    estimated_tokens: Mapped[int] = mapped_column(Integer, default=0)
    occurred_at: Mapped[int] = mapped_column(BigInteger, default=0, index=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class SemanticMemoryFact(Base):
    """Versioned learner fact with provenance, confidence and soft deletion."""

    __tablename__ = "semantic_memory_facts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(160), index=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence: Mapped[float] = mapped_column(Float, default=0.7)
    evidence: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="conversation")
    source_conversation_id: Mapped[str] = mapped_column(String(96), default="")
    source_message_id: Mapped[str] = mapped_column(String(96), default="")
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    supersedes_id: Mapped[str] = mapped_column(String(64), default="")
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    valid_from: Mapped[datetime] = mapped_column(server_default=func.now())
    valid_until: Mapped[datetime | None] = mapped_column(nullable=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class ExamPaper(Base):
    """试卷 + 学生作答记录。"""

    __tablename__ = "exam_papers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    exam_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    topic: Mapped[str] = mapped_column(String(256))
    title: Mapped[str] = mapped_column(String(256), default="")
    category: Mapped[str] = mapped_column(String(64), default="未分类", index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    paper_type: Mapped[str] = mapped_column(String(32))  # unit_test / mixed / adaptive
    questions: Mapped[dict] = mapped_column(JSON, default=list)
    # [{id, type, stem, options, answer, score, knowledge_point, ...}]
    answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # {question_id: answer_text}
    results: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # [{question_id, score, correct, feedback}]
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    mastery: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # {knowledge_point: {score, level}}
    status: Mapped[str] = mapped_column(String(32), default="created")
    # created -> submitted -> graded
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Assessment(Base):
    """摸底测评 — 学生自评 + AI 分析，结果写入画像并可导入生成/目标。"""

    __tablename__ = "assessments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    subject: Mapped[str] = mapped_column(String(256))
    self_level: Mapped[str] = mapped_column(String(32))  # 基础 / 进阶 / 完全掌握
    analysis: Mapped[dict] = mapped_column(JSON, default=dict)
    # {summary, narrative, strengths[], gaps[], recommended_focus[], knowledge_seed{}, suggested_modules[]}
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class GeneratedMaterial(Base):
    """AI 生成的学习资料（资源中心持久化）。

    与 SSE content 事件的 data 同构：data 存生成器完整产出，
    type 为 explainer/mindmap/quiz/solution/reading/code/video/courseware/interactive 之一。
    quiz 类材料会同步在 exam_papers 建一份试卷，exam_id 记录关联。
    """

    __tablename__ = "generated_materials"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    subtitle: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[int] = mapped_column(Integer, default=0)
    knowledge_points: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(16), default="form")  # form / studio
    exam_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ResourceCollection(Base):
    """One learner-owned collection of approved resource-center materials."""

    __tablename__ = "resource_collections"
    __table_args__ = (
        UniqueConstraint("student_id", "name", name="uq_resource_collection_student_name"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(64))
    position: Mapped[int] = mapped_column(Integer, default=0)
    resource_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(nullable=True, onupdate=func.now())


class LearningMarketListing(Base):
    """A reviewed resource snapshot shared to the community learning market."""

    __tablename__ = "learning_market_listings"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    publisher_id: Mapped[str] = mapped_column(String(64), index=True)
    author_name: Mapped[str] = mapped_column(String(80), default="学习者")
    kind: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    item_count: Mapped[int] = mapped_column(Integer, default=1)
    saves: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="published", index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LearningMarketImport(Base):
    """Idempotency record for importing one market listing into one workspace."""

    __tablename__ = "learning_market_imports"
    __table_args__ = (
        UniqueConstraint("listing_id", "student_id", name="uq_market_listing_student"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    listing_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    imported_kind: Mapped[str] = mapped_column(String(32))
    target_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CustomAgent(Base):
    """学生自建的生成智能体（只自定义执行者，不自定义资源类型）。

    ``output_type`` 必须取既有 ResourceType 之一：审核门、整合、落库副作用
    （quiz→ExamPaper）和前端 resource-viewer 都按 ``task.type`` 分派，
    造新类型会让这四处同时失配。可过滤字段（owner_id/output_type/status）
    一律用独立列，不藏进 JSON（SQLite 上 JSON 列不可索引）。
    """

    __tablename__ = "custom_agents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True, default="")
    name: Mapped[str] = mapped_column(String(80), default="我的智能体")
    emoji: Mapped[str] = mapped_column(String(16), default="🤖")
    duty: Mapped[str] = mapped_column(Text, default="")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    output_type: Mapped[str] = mapped_column(String(32), default="reading", index=True)
    knowledge_scope: Mapped[list] = mapped_column(JSON, default=list)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source_listing_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class WrongQuestion(Base):
    """错题本。"""

    __tablename__ = "wrong_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    question_id: Mapped[str] = mapped_column(String(64))
    exam_id: Mapped[str] = mapped_column(String(64))
    topic: Mapped[str] = mapped_column(String(256))
    knowledge_point: Mapped[str] = mapped_column(String(256))
    question_type: Mapped[str] = mapped_column(String(32))
    stem: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    student_answer: Mapped[str] = mapped_column(Text)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    feedback: Mapped[str] = mapped_column(Text, default="")
    error_type: Mapped[str] = mapped_column(String(64), default="unknown")
    # conceptual / calculation / careless / method
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LearningGoal(Base):
    """学习目标。"""

    __tablename__ = "learning_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    start_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    topic: Mapped[str] = mapped_column(String(256), default="")
    path_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_mastery: Mapped[float] = mapped_column(Float, default=0.8)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    status: Mapped[str] = mapped_column(String(32), default="active")
    # active / completed / abandoned
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class MemoryCard(Base):
    """可按间隔重复调度的记忆卡。"""

    __tablename__ = "memory_cards"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    front: Mapped[str] = mapped_column(Text)
    back: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(256), default="")
    knowledge_point: Mapped[str] = mapped_column(String(256), default="")
    source: Mapped[str] = mapped_column(String(32), default="manual")
    source_id: Mapped[str] = mapped_column(String(64), default="")
    ease_factor: Mapped[float] = mapped_column(Float, default=2.5)
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    repetitions: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[str] = mapped_column(String(16), index=True)
    state: Mapped[str] = mapped_column(String(16), default="new")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ReviewLog(Base):
    """单次记忆卡复习记录。"""

    __tablename__ = "review_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[str] = mapped_column(String(64), index=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    interval_before: Mapped[int] = mapped_column(Integer)
    interval_after: Mapped[int] = mapped_column(Integer)
    ease_after: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
