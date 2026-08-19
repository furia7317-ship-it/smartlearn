from app.models.learning import GeneratedMaterial
from app.routers.materials import material_summary


def test_material_summary_exposes_safe_external_video_link_without_full_data():
    material = GeneratedMaterial(
        id="material-video-summary",
        student_id="student-a",
        type="reading",
        title="归并排序视频学习总结",
        subtitle="分治过程复盘",
        meta=["B站视频"],
        sources=1,
        knowledge_points="归并排序",
        source="video",
        data={
            "review_approved": True,
            "content": "这段正文不应进入列表摘要。",
            "video": {
                "bvid": "BV1MERGESORT",
                "title": "归并排序：分治过程讲解",
                "url": "https://www.bilibili.com/video/BV1MERGESORT/",
                "embed_url": "https://player.bilibili.com/player.html?bvid=BV1MERGESORT&autoplay=0",
                "author": "算法课堂",
                "duration": "04:18",
                "summary": "分解、递归与合并。",
            },
        },
    )

    summary = material_summary(material)

    assert summary["source"] == "video"
    assert summary["external_video"] == {
        "bvid": "BV1MERGESORT",
        "title": "归并排序：分治过程讲解",
        "url": "https://www.bilibili.com/video/BV1MERGESORT/",
        "embed_url": "https://player.bilibili.com/player.html?bvid=BV1MERGESORT&autoplay=0",
        "author": "算法课堂",
        "duration": "04:18",
        "summary": "分解、递归与合并。",
    }
    assert "data" not in summary


def test_material_summary_does_not_treat_rag_documents_as_resource_links():
    material = GeneratedMaterial(
        id="material-reading",
        student_id="student-a",
        type="reading",
        title="数据结构讲义",
        source="form",
        data={"review_approved": True, "sources": [{"doc": "04-排序算法.md"}]},
    )

    assert material_summary(material)["external_video"] is None
