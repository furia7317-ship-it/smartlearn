"""功能补全方案的后端契约测试。"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest.fixture
async def db_session():
    from app.models.base import Base
    from app.models import learning, profile  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


class TestTtsApi:
    def test_request_rejects_text_over_500_characters(self):
        from app.routers.media import TtsRequest

        with pytest.raises(ValidationError):
            TtsRequest(text="x" * 501)

    @pytest.mark.asyncio
    async def test_create_tts_uses_stable_id_and_cache(self, tmp_path, monkeypatch):
        from app.routers import media

        calls: list[tuple[str, Path, str]] = []

        async def fake_synthesize(text: str, output_path: Path, voice: str):
            calls.append((text, Path(output_path), voice))
            Path(output_path).write_bytes(b"mp3")

        monkeypatch.setattr(media.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
        monkeypatch.setattr(media, "synthesize", fake_synthesize)
        monkeypatch.setattr(media, "tts_is_configured", lambda: True)

        req = media.TtsRequest(text="讲解冒泡排序", voice="xiaoyu")
        first = await media.create_tts(req)
        second = await media.create_tts(req)

        expected_id = hashlib.md5(req.text.encode("utf-8")).hexdigest()
        assert first == {"tts_id": expected_id}
        assert second == first
        assert calls == [(req.text, tmp_path / "tts" / f"{expected_id}.mp3", "xiaoyu")]

    @pytest.mark.asyncio
    async def test_create_tts_maps_synthesis_failure_to_502(self, tmp_path, monkeypatch):
        from app.routers import media

        async def fake_synthesize(*args, **kwargs):
            raise RuntimeError("provider unavailable")

        monkeypatch.setattr(media.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))
        monkeypatch.setattr(media, "synthesize", fake_synthesize)
        monkeypatch.setattr(media, "tts_is_configured", lambda: True)

        with pytest.raises(HTTPException) as exc:
            await media.create_tts(media.TtsRequest(text="测试"))

        assert exc.value.status_code == 502
        assert "provider unavailable" in exc.value.detail

    @pytest.mark.asyncio
    async def test_create_tts_reports_unconfigured_credentials(self, monkeypatch):
        from app.routers import media

        monkeypatch.setattr(media, "tts_is_configured", lambda: False)
        with pytest.raises(HTTPException) as exc:
            await media.create_tts(media.TtsRequest(text="测试"))

        assert exc.value.status_code == 503
        assert "尚未配置" in str(exc.value.detail)

    @pytest.mark.asyncio
    async def test_download_tts_returns_cached_mp3(self, tmp_path, monkeypatch):
        from app.routers import media

        tts_id = "a" * 32
        target = tmp_path / "tts" / f"{tts_id}.mp3"
        target.parent.mkdir(parents=True)
        target.write_bytes(b"mp3")
        monkeypatch.setattr(media.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))

        response = await media.download_tts(tts_id)

        assert Path(response.path) == target
        assert response.media_type == "audio/mpeg"

    @pytest.mark.asyncio
    async def test_download_tts_rejects_non_md5_identifier(self, tmp_path, monkeypatch):
        from app.routers import media

        outside = tmp_path / "outside.mp3"
        outside.write_bytes(b"private")
        monkeypatch.setattr(media.settings, "MEDIA_OUTPUT_DIR", str(tmp_path))

        with pytest.raises(HTTPException) as exc:
            await media.download_tts("../outside")

        assert exc.value.status_code == 404


class TestLearningModels:
    def test_goal_and_paper_columns_match_feature_contract(self):
        from app.models.learning import ExamPaper, LearningGoal

        goal_columns = set(LearningGoal.__table__.columns.keys())
        paper_columns = set(ExamPaper.__table__.columns.keys())

        assert {"topic", "path_id", "target_mastery", "source"} <= goal_columns
        assert {"title", "category", "tags", "starred", "archived"} <= paper_columns

    def test_memory_tables_are_registered_with_required_columns(self):
        from app.models.learning import MemoryCard, ReviewLog

        assert MemoryCard.__tablename__ == "memory_cards"
        assert {
            "id", "student_id", "front", "back", "topic", "knowledge_point",
            "source", "source_id", "ease_factor", "interval_days", "repetitions",
            "due_date", "state", "created_at",
        } <= set(MemoryCard.__table__.columns.keys())
        assert ReviewLog.__tablename__ == "review_logs"
        assert {
            "id", "card_id", "student_id", "rating", "interval_before",
            "interval_after", "ease_after", "created_at",
        } <= set(ReviewLog.__table__.columns.keys())


class TestGoalLinkage:
    @pytest.mark.asyncio
    async def test_goal_crud_accepts_json_and_returns_extended_fields(self, db_session):
        from app.routers.goals import (
            GoalCreate,
            GoalUpdate,
            create_goal,
            delete_goal,
            get_goals,
            update_goal,
        )

        created = await create_goal(
            "student-crud",
            GoalCreate(
                title="期末 85 分",
                description="数据结构",
                target_date="2026-07-01",
                topic="排序算法",
                target_mastery=0.85,
                source="manual",
                horizon="long",
            ),
            db_session,
        )
        assert created["topic"] == "排序算法"
        assert created["path_id"] is None
        assert created["progress"] == 0.0
        assert created["horizon"] == "long"

        listed = await get_goals("student-crud", db_session)
        assert listed[0]["target_mastery"] == 0.85
        assert listed[0]["source"] == "manual"

        from app.models.profile import Profile
        profile = await db_session.get(Profile, "student-crud")
        assert profile is not None
        assert profile.goals["learning_targets"]["long"][0]["title"] == "期末 85 分"

        updated = await update_goal(created["id"], GoalUpdate(status="abandoned", title="新标题"), db_session)
        assert updated["status"] == "abandoned"
        assert updated["title"] == "新标题"
        assert profile.goals["learning_targets"]["long"] == []

        assert await delete_goal(created["id"], db_session) == {"ok": True}
        assert await get_goals("student-crud", db_session) == []

    @pytest.mark.asyncio
    async def test_recalculate_goal_uses_path_and_mastery_weights(self, db_session):
        from app.models.learning import LearningGoal, LearningPath
        from app.models.profile import Profile
        from app.services.goals import recalculate_goal

        path = LearningPath(
            id="path-1", student_id="student-1", topic="排序算法", nodes=[], progress=0.5,
        )
        goal = LearningGoal(
            student_id="student-1", title="掌握排序", topic="排序算法",
            path_id=path.id, target_mastery=0.8,
        )
        profile = Profile(student_id="student-1", knowledge_level={"冒泡排序算法": {"score": 0.4}})
        db_session.add_all([path, goal, profile])
        await db_session.flush()

        result = await recalculate_goal(db_session, goal)

        assert result == {"progress": 0.5, "status": "active"}
        assert goal.progress == 0.5

    @pytest.mark.asyncio
    async def test_recalculate_goal_completes_but_never_reopens_goal(self, db_session):
        from app.models.learning import LearningGoal
        from app.models.profile import Profile
        from app.services.goals import recalculate_goal

        profile = Profile(student_id="student-2", knowledge_level={"树": {"score": 0.9}})
        goal = LearningGoal(
            student_id="student-2", title="掌握树", topic="树",
            target_mastery=0.8, status="active",
        )
        db_session.add_all([profile, goal])
        await db_session.flush()

        await recalculate_goal(db_session, goal)
        assert goal.progress == 1.0
        assert goal.status == "completed"

        profile.knowledge_level = {"树": {"score": 0.1}}
        await recalculate_goal(db_session, goal)
        assert goal.status == "completed"

    @pytest.mark.asyncio
    async def test_recalculate_goal_uses_mature_memory_ratio_when_higher(self, db_session):
        from app.models.learning import LearningGoal, MemoryCard
        from app.models.profile import Profile
        from app.services.goals import recalculate_goal

        profile = Profile(student_id="memory-goal", knowledge_level={"排序": {"score": 0.2}})
        goal = LearningGoal(
            student_id="memory-goal", title="掌握排序", topic="排序", target_mastery=0.8,
        )
        cards = [
            MemoryCard(
                id="mature", student_id="memory-goal", front="f", back="b", topic="排序",
                due_date=date.today().isoformat(), state="review", interval_days=21,
            ),
            MemoryCard(
                id="learning", student_id="memory-goal", front="f", back="b", topic="排序",
                due_date=date.today().isoformat(), state="learning", interval_days=3,
            ),
        ]
        db_session.add_all([profile, goal, *cards])
        await db_session.flush()

        await recalculate_goal(db_session, goal)

        assert goal.progress == 0.625
        assert goal.status == "active"

    @pytest.mark.asyncio
    async def test_advance_goals_only_updates_matching_active_topics(self, db_session):
        from app.models.learning import LearningGoal
        from app.models.profile import Profile
        from app.services.goals import advance_goals

        db_session.add(Profile(student_id="student-3", knowledge_level={"快速排序": {"score": 0.8}}))
        matching = LearningGoal(student_id="student-3", title="排序", topic="排序", target_mastery=0.8)
        other = LearningGoal(student_id="student-3", title="图", topic="图论", target_mastery=0.8)
        abandoned = LearningGoal(
            student_id="student-3", title="旧排序", topic="排序", target_mastery=0.8,
            status="abandoned",
        )
        db_session.add_all([matching, other, abandoned])
        await db_session.flush()

        updated = await advance_goals(db_session, "student-3", "快速排序", {"快速排序": {"score": 0.8}})

        assert updated == [matching]
        assert matching.progress == 1.0
        assert other.progress == 0.0
        assert abandoned.progress == 0.0

    @pytest.mark.asyncio
    async def test_advance_goals_merges_current_mastery_with_profile_history(self, db_session):
        from app.models.learning import LearningGoal
        from app.models.profile import Profile
        from app.services.goals import advance_goals

        profile = Profile(
            student_id="history-student",
            knowledge_level={"冒泡排序": {"score": 0.4}},
        )
        goal = LearningGoal(
            student_id="history-student", title="掌握排序", topic="排序", target_mastery=0.8,
        )
        db_session.add_all([profile, goal])
        await db_session.flush()

        await advance_goals(
            db_session,
            "history-student",
            "快速排序",
            {"快速排序": {"score": 0.8}},
        )

        assert goal.progress == 0.75
        assert goal.status == "active"

    @pytest.mark.asyncio
    async def test_path_node_patch_counts_nested_nodes_and_recalculates_goal(self, db_session):
        from app.models.learning import LearningGoal, LearningPath
        from app.routers.path import PathNodeUpdate, update_path_node

        path = LearningPath(
            id="path-2",
            student_id="student-4",
            topic="图",
            nodes=[{
                "id": "n1", "title": "基础", "status": "current",
                "children": [{"id": "n1-1", "title": "遍历", "status": "pending", "children": []}],
            }],
            progress=0.0,
        )
        goal = LearningGoal(
            student_id="student-4", title="掌握图", topic="图", path_id=path.id,
            target_mastery=0.8,
        )
        db_session.add_all([path, goal])
        await db_session.flush()

        result = await update_path_node(path.id, "n1-1", PathNodeUpdate(status="completed"), db_session)

        assert result["progress"] == 0.5
        assert result["goal"] == {"id": goal.id, "progress": 0.2}

    @pytest.mark.asyncio
    async def test_path_recommendation_includes_due_memory_count(self, db_session):
        from app.models.learning import LearningPath, MemoryCard
        from app.routers.path import get_recommendation

        path = LearningPath(
            id="path-memory", student_id="student-memory", topic="排序", nodes=[], progress=0,
        )
        db_session.add_all([
            path,
            MemoryCard(
                id="due-memory", student_id="student-memory", front="f", back="b", topic="排序",
                due_date=date.today().isoformat(),
            ),
            MemoryCard(
                id="future-memory", student_id="student-memory", front="f", back="b", topic="排序",
                due_date=(date.today() + timedelta(days=1)).isoformat(),
            ),
        ])
        await db_session.commit()

        result = await get_recommendation(path.id, db_session)

        assert {item["type"] for item in result["recommendations"]} == {"memory"}
        assert result["recommendations"][0]["title"] == "复习 1 张到期卡"


class TestMaterialLibrary:
    @pytest.mark.asyncio
    async def test_clear_materials_removes_student_materials_and_generated_papers(self, db_session):
        from sqlalchemy import select

        from app.models.learning import ExamPaper, GeneratedMaterial
        from app.routers.materials import clear_materials

        material = GeneratedMaterial(
            id="mat-clear",
            student_id="student-clear",
            type="quiz",
            title="Quiz",
            subtitle="",
            meta=[],
            sources=0,
            knowledge_points="dp",
            data={"questions": []},
            source="form",
            exam_id="exam-clear",
        )
        other_material = GeneratedMaterial(
            id="mat-other",
            student_id="student-other",
            type="explainer",
            title="Other",
            subtitle="",
            meta=[],
            sources=0,
            knowledge_points="graph",
            data={},
            source="form",
        )
        paper = ExamPaper(
            id="paper-clear",
            exam_id="exam-clear",
            student_id="student-clear",
            topic="dp",
            title="Quiz",
            category="AI",
            tags=[],
            paper_type="generated",
            questions=[],
            status="created",
        )
        other_paper = ExamPaper(
            id="paper-other",
            exam_id="exam-clear",
            student_id="student-other",
            topic="dp",
            title="Other",
            category="AI",
            tags=[],
            paper_type="generated",
            questions=[],
            status="created",
        )
        db_session.add_all([material, other_material, paper, other_paper])
        await db_session.commit()

        result = await clear_materials("student-clear", db_session)

        assert result == {"ok": True, "deleted": 1, "papers_deleted": 1}
        material_ids = {
            row.id
            for row in (await db_session.execute(select(GeneratedMaterial))).scalars().all()
        }
        paper_ids = {
            row.id
            for row in (await db_session.execute(select(ExamPaper))).scalars().all()
        }
        assert material_ids == {"mat-other"}
        assert paper_ids == {"paper-other"}


class TestPaperLibrary:
    @pytest.fixture
    async def papers(self, db_session):
        from app.models.learning import ExamPaper

        first = ExamPaper(
            id="paper-1", exam_id="exam-1", student_id="paper-student",
            topic="排序", title="排序期末卷", category="期末", tags=["期末", "重点"],
            starred=True, archived=False, paper_type="mixed",
            questions=[{"id": "q1", "stem": "冒泡排序？", "answer": "交换", "score": 10}],
            answers={"q1": "交换"}, results=[{"question_id": "q1", "correct": True}],
            mastery={"排序": {"score": 1}}, overall_score=100, status="graded",
        )
        second = ExamPaper(
            id="paper-2", exam_id="exam-2", student_id="paper-student",
            topic="图论", title="图论练习", category="练习", tags=["图"],
            starred=False, archived=False, paper_type="mixed",
            questions=[
                {"id": "q2", "stem": "BFS？", "answer": "队列", "score": 10},
                {"id": "q3", "stem": "DFS？", "answer": "栈", "score": 10},
            ],
            status="created",
        )
        db_session.add_all([first, second])
        await db_session.commit()
        return first, second

    @pytest.mark.asyncio
    async def test_list_filters_and_returns_summaries_only(self, db_session, papers):
        from app.routers.papers import list_papers

        result = await list_papers(
            "paper-student", category="期末", tag="重点", status="graded",
            keyword="排序", starred=True, db=db_session,
        )

        assert len(result) == 1
        assert result[0]["id"] == "paper-1"
        assert result[0]["question_count"] == 1
        assert not ({"questions", "answers", "results", "mastery"} & result[0].keys())

    @pytest.mark.asyncio
    async def test_detail_patch_categories_rename_and_delete(self, db_session, papers):
        from app.routers.papers import (
            CategoryRename,
            PaperUpdate,
            delete_paper,
            get_categories,
            get_paper_detail,
            rename_category,
            update_paper,
        )

        detail = await get_paper_detail("paper-1", db_session)
        assert detail["questions"][0]["id"] == "q1"
        assert detail["mastery"]["排序"]["score"] == 1
        assert (await get_paper_detail("exam-1", db_session))["id"] == "paper-1"

        updated = await update_paper(
            "paper-1", PaperUpdate(title="新标题", category="冲刺", starred=False), db_session,
        )
        assert updated["title"] == "新标题"
        assert updated["category"] == "冲刺"

        renamed = await rename_category(
            "paper-student", CategoryRename(**{"from": "练习", "to": "专项"}), db_session,
        )
        assert renamed == {"updated": 1}
        categories = await get_categories("paper-student", db_session)
        assert {item["name"] for item in categories["categories"]} == {"冲刺", "专项"}

        assert await delete_paper("paper-1", db_session) == {"ok": True}

    @pytest.mark.asyncio
    async def test_redo_and_exam_from_bank_clone_existing_questions(self, db_session, papers):
        from app.routers.assess import ExamFromBankRequest, create_exam_from_bank
        from app.routers.papers import redo_paper

        redo = await redo_paper("paper-1", db_session)
        assert redo["exam_id"] != "exam-1"
        assert redo["questions"] == papers[0].questions

        assembled = await create_exam_from_bank(
            ExamFromBankRequest(
                student_id="paper-student",
                question_ids=["q1", "q3", "q1"],
                title="强化卷",
                category="专项",
            ),
            db_session,
        )
        assert [q["id"] for q in assembled["questions"]] == ["q1", "q3"]
        assert assembled["exam_id"] not in {"exam-1", "exam-2", redo["exam_id"]}


class TestMemoryTraining:
    def test_schedule_uses_fixed_sm2_rules_for_all_ratings(self):
        from app.models.learning import MemoryCard
        from app.services.memory import schedule

        forgot = MemoryCard(
            id="c0", student_id="s", front="f", back="b", due_date=date.today().isoformat(),
            repetitions=3, interval_days=10, ease_factor=2.5,
        )
        hard = MemoryCard(
            id="c1", student_id="s", front="f", back="b", due_date=date.today().isoformat(),
        )
        remembered = MemoryCard(
            id="c2", student_id="s", front="f", back="b", due_date=date.today().isoformat(),
        )
        easy = MemoryCard(
            id="c3", student_id="s", front="f", back="b", due_date=date.today().isoformat(),
            repetitions=2, interval_days=10, ease_factor=2.5,
        )

        schedule(forgot, 0)
        schedule(hard, 1)
        schedule(remembered, 2)
        schedule(easy, 3)

        assert (forgot.repetitions, forgot.interval_days, forgot.ease_factor, forgot.state) == (0, 0, 2.3, "lapsed")
        assert (hard.repetitions, hard.interval_days, hard.ease_factor, hard.state) == (1, 1, 2.35, "learning")
        assert (remembered.repetitions, remembered.interval_days, remembered.ease_factor) == (1, 1, 2.5)
        assert (easy.repetitions, easy.interval_days, easy.ease_factor, easy.state) == (3, 32, 2.6, "review")
        assert forgot.due_date == date.today().isoformat()
        assert easy.due_date == (date.today() + timedelta(days=32)).isoformat()

    @pytest.mark.asyncio
    async def test_card_creation_deduplicates_and_wrongbook_imports(self, db_session):
        from app.models.learning import WrongQuestion
        from app.routers.memory import CardCreate, WrongbookImport, create_card, import_wrongbook

        req = CardCreate(
            student_id="memory-student", front="什么是栈？", back="后进先出",
            topic="数据结构", knowledge_point="栈", source="selection", source_id="source-1",
        )
        first = await create_card(req, db_session)
        second = await create_card(req, db_session)
        assert second["id"] == first["id"]

        db_session.add(WrongQuestion(
            student_id="memory-student", question_id="wrong-1", exam_id="exam",
            topic="排序", knowledge_point="冒泡排序", question_type="short",
            stem="冒泡排序如何工作？", answer="相邻交换", student_answer="",
            score=0, feedback="注意循环边界",
        ))
        await db_session.commit()

        imported = await import_wrongbook(WrongbookImport(student_id="memory-student", topic="排序"), db_session)
        repeated = await import_wrongbook(WrongbookImport(student_id="memory-student", topic="排序"), db_session)
        assert imported == {"created": 1, "skipped": 0}
        assert repeated == {"created": 0, "skipped": 1}

    @pytest.mark.asyncio
    async def test_due_review_logs_and_stats(self, db_session):
        from app.models.learning import MemoryCard
        from app.models.profile import Profile
        from app.routers.memory import ReviewRequest, get_due_cards, get_logs, get_stats, review_card

        db_session.add(Profile(student_id="review-student", pace={"question_count": 1}))
        cards = [
            MemoryCard(
                id="due-1", student_id="review-student", front="1", back="1", topic="排序",
                knowledge_point="冒泡", due_date=(date.today() - timedelta(days=1)).isoformat(),
            ),
            MemoryCard(
                id="due-2", student_id="review-student", front="2", back="2", topic="排序",
                knowledge_point="快排", due_date=date.today().isoformat(),
            ),
            MemoryCard(
                id="future", student_id="review-student", front="3", back="3", topic="图",
                knowledge_point="BFS", due_date=(date.today() + timedelta(days=2)).isoformat(),
            ),
        ]
        db_session.add_all(cards)
        await db_session.commit()

        due = await get_due_cards("review-student", limit=None, db=db_session)
        assert [card["id"] for card in due] == ["due-1", "due-2"]

        reviewed = await review_card(ReviewRequest(card_id="due-1", rating=2), db_session)
        assert reviewed["interval_days"] == 1
        logs = await get_logs("due-1", db_session)
        assert logs[0]["rating"] == 2

        stats = await get_stats("review-student", db_session)
        assert stats["reviewed_today"] == 1
        assert stats["streak"] == 1
        assert len(stats["upcoming"]) == 7
        assert stats["weak_points"]


class TestSubmitIntegration:
    @pytest.mark.asyncio
    async def test_submit_owner_scope_hides_another_students_paper(self, db_session):
        from app.models.learning import ExamPaper
        from app.routers.assess import submit_exam
        from app.schemas.exam import SubmitRequest

        db_session.add(ExamPaper(
            id="paper-owner",
            exam_id="exam-owner",
            student_id="owner",
            topic="数据结构",
            title="归属测试",
            paper_type="mixed",
            questions=[],
            status="created",
        ))
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await submit_exam(
                "exam-owner",
                SubmitRequest(student_id="other", answers={}),
                db_session,
            )

        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_submit_idempotent_replays_existing_grade_without_graph(
        self, db_session, monkeypatch
    ):
        from app.models.learning import ExamPaper
        from app.routers import assess
        from app.schemas.exam import SubmitRequest

        class BombGraph:
            def stream(self, *args, **kwargs):
                raise AssertionError("graded paper must not run the grading graph")

        db_session.add(ExamPaper(
            id="paper-graded",
            exam_id="exam-graded",
            student_id="owner",
            topic="数据结构",
            title="已评分试卷",
            paper_type="mixed",
            questions=[],
            answers={"q1": "A"},
            results=[{"question_id": "q1", "score": 10}],
            overall_score=100,
            mastery={"线性表": {"score": 1.0}},
            status="graded",
        ))
        await db_session.commit()
        monkeypatch.setattr(assess, "grade_app", BombGraph())

        response = await assess.submit_exam(
            "exam-graded",
            SubmitRequest(student_id="owner", answers={"q1": "A"}),
            db_session,
        )
        body = "".join([
            chunk.decode() if isinstance(chunk, bytes) else chunk
            async for chunk in response.body_iterator
        ])

        assert "event: graded" in body
        assert '"overall": 100.0' in body
        assert "event: done" in body

    @pytest.mark.asyncio
    async def test_finalize_submission_adds_deduplicated_card_and_advances_goal(self, db_session):
        from sqlalchemy import func, select

        from app.models.learning import ExamPaper, LearningGoal, MemoryCard, WrongQuestion
        from app.routers.assess import finalize_exam_submission

        paper = ExamPaper(
            id="submit-paper", exam_id="submit-exam", student_id="submit-student",
            topic="排序", title="排序卷", category="练习", paper_type="mixed",
            questions=[{
                "id": "submit-q1", "type": "short", "stem": "解释快排",
                "answer": "分治", "score": 10, "knowledge_point": "快速排序",
            }],
            status="created",
        )
        goal = LearningGoal(
            student_id="submit-student", title="掌握排序", topic="排序", target_mastery=0.8,
        )
        db_session.add_all([paper, goal])
        await db_session.commit()

        final_state = {
            "results": [{
                "question_id": "submit-q1", "type": "short", "score": 0,
                "max_score": 10, "correct": False, "student_answer": "不会",
                "answer": "分治", "knowledge_point": "快速排序",
                "feedback": "复习分治", "error_type": "conceptual",
            }],
            "overall": 0,
            "mastery": {"快速排序": {"score": 0.8, "level": "优秀"}},
        }

        await finalize_exam_submission(db_session, paper, "submit-student", {"submit-q1": "不会"}, final_state)
        await finalize_exam_submission(db_session, paper, "submit-student", {"submit-q1": "不会"}, final_state)

        card_count = await db_session.scalar(select(func.count()).select_from(MemoryCard))
        wrong_count = await db_session.scalar(select(func.count()).select_from(WrongQuestion))
        assert card_count == 1
        assert wrong_count == 1
        assert goal.progress == 1.0
        assert goal.status == "completed"

    @pytest.mark.asyncio
    async def test_finalize_diagnostic_persists_objective_assessment_once(self, db_session):
        from sqlalchemy import select

        from app.models.learning import Assessment, ExamPaper
        from app.routers.assess import finalize_exam_submission

        paper = ExamPaper(
            id="diagnostic-paper",
            exam_id="diagnostic-exam",
            student_id="diagnostic-student",
            topic="数据结构",
            title="数据结构摸底",
            category="学情摸底",
            paper_type="adaptive",
            questions=[{
                "id": "diagnostic-q1",
                "type": "mcq",
                "stem": "队列遵循什么原则？",
                "options": ["A. FIFO", "B. LIFO"],
                "answer": "A",
                "score": 10,
                "knowledge_point": "队列",
            }],
            status="created",
        )
        db_session.add(paper)
        await db_session.commit()

        final_state = {
            "results": [{
                "question_id": "diagnostic-q1",
                "type": "mcq",
                "score": 10,
                "max_score": 10,
                "correct": True,
                "student_answer": "A",
                "answer": "A",
                "knowledge_point": "队列",
                "feedback": "回答正确",
                "error_type": "unknown",
            }],
            "overall": 88,
            "mastery": {"队列": {"score": 0.88, "level": "优秀"}},
            "assessment": {
                "summary": "队列基础扎实",
                "strengths": ["队列"],
                "weaknesses": ["循环队列边界"],
                "suggestions": ["复习判满条件"],
                "next_steps": ["完成循环队列练习"],
                "encouragement": "继续保持。",
            },
        }

        await finalize_exam_submission(
            db_session,
            paper,
            "diagnostic-student",
            {"diagnostic-q1": "A"},
            final_state,
        )
        await finalize_exam_submission(
            db_session,
            paper,
            "diagnostic-student",
            {"diagnostic-q1": "A"},
            final_state,
        )

        records = (await db_session.execute(select(Assessment))).scalars().all()
        assert len(records) == 1
        assert records[0].subject == "数据结构"
        assert records[0].self_level == "完全掌握"
        assert records[0].analysis["overall_score"] == 88
        assert records[0].analysis["knowledge_seed"] == {"队列": 0.88}
        assert records[0].analysis["gaps"] == ["循环队列边界"]
        assert records[0].analysis["recommended_focus"] == ["复习判满条件", "完成循环队列练习"]
