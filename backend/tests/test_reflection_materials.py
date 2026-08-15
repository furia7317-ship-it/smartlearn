import pytest


class FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        return None


@pytest.mark.asyncio
async def test_reflection_preserves_student_text_and_labels_ai_supplement():
    from app.routers.materials import ReflectionSave, save_reflection

    db = FakeSession()
    result = await save_reflection(
        ReflectionSave(
            student_id="student-reflection",
            task_key="D1-review",
            day="D1",
            title="D1 学习复盘",
            knowledge_points="链表",
            user_content="我今天混淆了头结点与首元结点，已经用一次插入操作重新验证。",
            ai_supplement="建议明天再用空链表测试边界条件。",
            context_summary="今日完成一次链表测验。",
        ),
        db,
    )

    assert db.commits == 1
    assert len(db.added) == 1
    material = db.added[0]
    assert material.source == "reflection"
    assert material.type == "reading"
    assert result["review_approved"] is True
    assert result["data"]["authored_by_user"] is True
    assert result["data"]["user_content"].startswith("我今天混淆")
    assert result["data"]["ai_supplement"].startswith("建议明天")
    assert "## 我的复盘" in result["data"]["content"]
    assert "## AI 补充" in result["data"]["content"]
