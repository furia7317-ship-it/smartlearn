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
async def test_note_preserves_source_passage_and_enters_material_library():
    from app.routers.materials import NoteSave, save_note

    db = FakeSession()
    result = await save_note(
        NoteSave(
            student_id="note-student",
            resource_id="resource-7",
            resource_title="链表入门",
            title="链表指针笔记",
            selected_text="头指针保存链表第一个节点的位置。",
            note_content="我把它理解为进入整条链表的入口，丢失后就不能正常遍历。",
            knowledge_points="链表,指针",
        ),
        db,
    )

    assert db.commits == 1
    assert len(db.added) == 1
    material = db.added[0]
    assert material.type == "reading"
    assert material.source == "note"
    assert result["review_approved"] is True
    assert result["data"]["kind"] == "note"
    assert result["data"]["resource_id"] == "resource-7"
    assert "来源摘录" in result["data"]["content"]
    assert "我的笔记" in result["data"]["content"]

