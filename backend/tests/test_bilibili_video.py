import pytest


def test_extract_bvid_from_common_bilibili_urls():
    from app.services.bilibili import extract_bvid

    assert extract_bvid("https://www.bilibili.com/video/BV1VAMXz6ETz/?spm_id_from=333") == "BV1VAMXz6ETz"
    assert extract_bvid("BV1VAMXz6ETz") == "BV1VAMXz6ETz"
    assert extract_bvid("https://example.com/no-video") is None


def test_search_bilibili_videos_normalizes_web_search_results(monkeypatch):
    from app.services import bilibili

    def fake_bocha_search(query: str, count: int):
      assert "site:bilibili.com/video" in query
      return [
          {
              "id": "x",
              "title": "动态规划入门 - 哔哩哔哩",
              "url": "https://www.bilibili.com/video/BV1VAMXz6ETz/?from=search",
              "snippet": "用背包问题解释状态转移。",
              "summary": "适合数据结构复习。",
              "site": "哔哩哔哩",
              "date": "2026-06-01",
          },
          {
              "id": "bad",
              "title": "不是视频",
              "url": "https://www.bilibili.com/read/cv123",
              "snippet": "",
              "summary": "",
              "site": "哔哩哔哩",
              "date": "",
          },
      ]

    monkeypatch.setattr(bilibili, "bocha_search", fake_bocha_search)

    results = bilibili.search_bilibili_videos("动态规划", count=5)

    assert len(results) == 1
    assert results[0].bvid == "BV1VAMXz6ETz"
    assert results[0].title == "动态规划入门"
    assert results[0].embed_url.endswith("bvid=BV1VAMXz6ETz&autoplay=0")
    assert results[0].summary == "适合数据结构复习。"


def test_search_bilibili_videos_falls_back_to_public_search_without_bocha(monkeypatch):
    from app.services import bilibili

    fallback = bilibili.BilibiliVideoResult(
        bvid="BV1VAMXz6ETz",
        title="动态规划入门",
        url="https://www.bilibili.com/video/BV1VAMXz6ETz/",
        embed_url="https://player.bilibili.com/player.html?bvid=BV1VAMXz6ETz&autoplay=0",
    )

    monkeypatch.setattr(
        bilibili,
        "bocha_search",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("no key")),
    )
    monkeypatch.setattr(bilibili, "_search_bilibili_public", lambda keyword, count: [fallback])

    assert bilibili.search_bilibili_videos("动态规划", count=5) == [fallback]


def test_bilibili_view_metadata_is_normalized_and_ranked():
    from app.services import bilibili

    video = bilibili._result_from_view({
        "code": 0,
        "data": {
            "bvid": "BV1VAMXz6ETz",
            "title": "动态规划：状态转移入门",
            "desc": "结合数据结构例题讲解",
            "pic": "http://i0.hdslb.com/demo.jpg",
            "duration": 605,
            "pubdate": 1_700_000_000,
            "owner": {"name": "算法老师"},
        },
    })

    assert video is not None
    assert video.duration == "10:05"
    assert video.cover.startswith("https://")
    assert bilibili._search_relevance("动态规划 数据结构", video) > 0
    assert bilibili._search_relevance("高中英语", video) == 0


@pytest.mark.asyncio
async def test_build_video_learning_payload_creates_summary_and_quiz_resources(monkeypatch):
    from app.services.bilibili import BilibiliVideoResult, build_video_learning_payload

    class FakeResponse:
        content = """
        {
          "summary": "这段视频用状态定义、状态转移和初始化解释动态规划。",
          "key_points": ["状态定义", "状态转移", "边界初始化"],
          "questions": [
            {
              "id": "q1",
              "type": "mcq",
              "stem": "动态规划的核心是什么？",
              "options": ["A. 穷举所有排列", "B. 定义状态并转移", "C. 只写递归"],
              "answer": "B",
              "explanation": "视频强调先定义状态，再写转移。"
            }
          ]
        }
        """

    class FakeLLM:
        async def ainvoke(self, prompt: str):
            assert "动态规划入门" in prompt
            assert "观看进度：已看完" in prompt
            return FakeResponse()

    monkeypatch.setattr("app.services.bilibili.get_llm", lambda temperature=0.2: FakeLLM())

    payload = await build_video_learning_payload(
        BilibiliVideoResult(
            bvid="BV1VAMXz6ETz",
            title="动态规划入门",
            url="https://www.bilibili.com/video/BV1VAMXz6ETz/",
            embed_url="https://player.bilibili.com/player.html?bvid=BV1VAMXz6ETz&autoplay=0",
            author="UP主",
            cover="",
            duration="10:00",
            summary="状态转移示例",
            published_at="2026-06-01",
        ),
        watched_seconds=600,
        note="我看完了，对转移方程还有疑问。",
    )

    assert payload["video"]["bvid"] == "BV1VAMXz6ETz"
    assert payload["summary_resource"]["type"] == "reading"
    assert "状态定义" in payload["summary_resource"]["data"]["key_points"]
    assert payload["quiz_resource"]["type"] == "quiz"
    assert payload["quiz_resource"]["data"]["questions"][0]["answer"] == "B"
    assert payload["path_attachment"]["type"] == "video"
