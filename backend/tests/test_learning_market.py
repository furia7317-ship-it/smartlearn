import pytest


class ScalarResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return self

    def all(self):
        return list(self.values)

    def scalar_one_or_none(self):
        return self.values[0] if self.values else None


class FakeSession:
    def __init__(self, *, rows=None, objects=None):
        self.rows = list(rows or [])
        self.objects = dict(objects or {})
        self.added = []
        self.commits = 0

    async def execute(self, _stmt):
        values, self.rows = self.rows, []
        return ScalarResult(values)

    async def get(self, _model, object_id):
        return self.objects.get(object_id)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        return None


@pytest.mark.asyncio
async def test_publish_bundle_only_snapshots_owned_approved_materials():
    from app.models.learning import GeneratedMaterial, LearningMarketListing
    from app.routers.market import MarketPublishRequest, publish_listing

    materials = [
        GeneratedMaterial(
            id=f"m-{index}", student_id="owner", type="reading", title=f"资料 {index}",
            subtitle="", meta=[], sources=0, knowledge_points="", source="studio",
            data={"content": "safe", "api_key": "must-not-leak", "review_approved": True},
        )
        for index in (1, 2)
    ]
    db = FakeSession(rows=materials)
    result = await publish_listing(
        MarketPublishRequest(
            student_id="owner", kind="bundle", title="精选资料包",
            material_ids=["m-1", "m-2"], tags=["复习"],
        ),
        db,
    )

    listing = next(value for value in db.added if isinstance(value, LearningMarketListing))
    assert result["item_count"] == 2
    assert listing.payload["materials"][0]["data"]["content"] == "safe"
    assert "api_key" not in listing.payload["materials"][0]["data"]
    assert db.commits == 1


@pytest.mark.asyncio
async def test_learning_path_import_is_idempotent_and_returns_standalone_snapshot():
    from app.models.learning import LearningMarketImport, LearningMarketListing
    from app.routers.market import MarketImportRequest, import_listing

    snapshot = {
        "title": "数据结构冲刺",
        "requestSummary": "七天复习",
        "dailyMinutes": 45,
        "path": [{"day": "D1", "title": "链表", "steps": []}],
    }
    listing = LearningMarketListing(
        id="listing-path", publisher_id="author", author_name="小林",
        kind="learning_path", title="数据结构冲刺", description="", tags=[],
        payload={"materials": [], "path": snapshot}, item_count=1, saves=0, status="published",
    )
    db = FakeSession(rows=[], objects={"listing-path": listing})
    first = await import_listing("listing-path", MarketImportRequest(student_id="reader"), db)

    assert first["path_snapshot"] == snapshot
    assert first["already_imported"] is False
    assert listing.saves == 1
    assert any(isinstance(value, LearningMarketImport) for value in db.added)

    previous = next(value for value in db.added if isinstance(value, LearningMarketImport))
    second_db = FakeSession(rows=[previous], objects={"listing-path": listing})
    second = await import_listing("listing-path", MarketImportRequest(student_id="reader"), second_db)
    assert second["already_imported"] is True
    assert second["path_snapshot"] == snapshot
    assert listing.saves == 1


@pytest.mark.asyncio
async def test_learning_path_publish_counts_and_previews_real_stages():
    from app.routers.market import MarketPublishRequest, publish_listing

    stages = [
        {"title": "复杂度", "steps": []},
        {"title": "线性表", "steps": []},
        {"title": "树结构", "steps": []},
    ]
    db = FakeSession()
    result = await publish_listing(
        MarketPublishRequest(
            student_id="owner",
            author_name="学习者",
            kind="learning_path",
            title="数据结构路径",
            path_snapshot={"title": "数据结构路径", "path": stages},
        ),
        db,
    )

    assert result["item_count"] == 3
    assert [item["title"] for item in result["preview_items"]] == ["复杂度", "线性表", "树结构"]
