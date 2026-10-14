"""Durable evidence ledger and versioned outputs owned by the learning-data agent."""
from datetime import datetime
from sqlalchemy import JSON, String, Integer, Float, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class LearningEvidence(Base):
    __tablename__ = "learning_evidence"
    __table_args__ = (UniqueConstraint("student_id", "source_key", name="uq_learning_evidence_owner_source"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    source_key: Mapped[str] = mapped_column(String(240))
    fingerprint: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(40), index=True)
    weight: Mapped[float] = mapped_column(Float)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column()
    ingested_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LearningDataState(Base):
    __tablename__ = "learning_data_states"
    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    applied_fingerprints: Mapped[dict] = mapped_column(JSON, default=dict)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    pending_weight: Mapped[float] = mapped_column(Float, default=0)
    pending_since: Mapped[datetime | None] = mapped_column(nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    reason: Mapped[str] = mapped_column(String(80), default="等待学习数据")


class LearningDataRevision(Base):
    __tablename__ = "learning_data_revisions"
    __table_args__ = (UniqueConstraint("student_id", "revision", name="uq_learning_data_revision"),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(64), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class LearnerTrainingArchive(Base):
    __tablename__ = "learner_training_archives"
    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class LearnerTrainingRun(Base):
    """Keep every uploaded run even after the workbench's recent-history window rolls."""
    __tablename__ = "learner_training_runs"
    student_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(160), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(160), index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column()
