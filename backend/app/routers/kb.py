"""知识库路由 — 导入 + 检索。"""

from __future__ import annotations

import asyncio
import hashlib
import re
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.deps import get_llm
from app.core.blocking import run_retrieval
from app.core.llm import parse_json_response
from app.services.knowledge_documents import smart_chunk_markdown
from app.services.rag import (
    add_documents,
    build_knowledge_index,
    get_retrieval_health,
    retrieve_with_diagnostics,
)
from app.services.web_search import bocha_search, chunk_plain_text, fetch_readable_text

router = APIRouter()

# 网络资料独立集合：与课程精编库分开，不参与防幻觉裁判
WEB_KB_COLLECTION = "web_kb"


def _smart_chunk_markdown(content: str, source: str) -> list[dict]:
    """Backward-compatible import surface for scripts and tests."""

    return smart_chunk_markdown(content, source)


@router.post("/import")
async def import_knowledge():
    """Rebuild and atomically publish the complete curated knowledge index."""
    try:
        result = await asyncio.to_thread(build_knowledge_index, True)
        return {"message": "索引构建完成", **result}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"导入失败: {str(e)}")


@router.get("/search")
async def search_knowledge(query: str, n_results: int = 5):
    """检索知识库。"""
    try:
        docs, sources, retrieval = await run_retrieval(
            retrieve_with_diagnostics, query, n_results=n_results,
        )
        return {"query": query, "results": docs, "sources": sources, "retrieval": retrieval}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"检索失败: {str(e)}")


@router.get("/status")
async def retrieval_status():
    """Expose whether complete hybrid retrieval is ready or unavailable."""
    return await asyncio.to_thread(get_retrieval_health)


# ════════════ 联网找教材（博查）→ 抓取 → 导入独立 web_kb 集合 ════════════


@router.get("/websearch")
async def web_search(query: str, count: int = 8):
    """联网搜索教材/资料（博查，国内可达）。"""
    q = (query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query 不能为空")
    try:
        results = await asyncio.to_thread(bocha_search, q, count)
        return {"query": q, "results": results}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"联网搜索失败: {e}")


class WebImportRequest(BaseModel):
    url: str
    title: str = ""


class BookGraphRequest(BaseModel):
    url: str
    title: str = ""
    summary: str = ""


class BookPreviewRequest(WebImportRequest):
    summary: str = ""


def _clean_book_text(text: str, limit: int = 24000) -> str:
    """Collapse whitespace and stop before document-platform boilerplate."""
    cleaned = re.sub(r"[ \t\u00a0]+", " ", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    boilerplate_markers = (
        "您可能关注的文档",
        "猜你喜欢",
        "原创力文档",
        "知识共享平台",
        "版权声明",
        "网站声明",
        "用户协议",
        "隐私政策",
        "上传者QQ",
        "ICP备案",
    )
    cut_positions = [cleaned.find(marker) for marker in boilerplate_markers if cleaned.find(marker) >= 0]
    if cut_positions:
        cleaned = cleaned[:min(cut_positions)].strip()
    lines = []
    for line in cleaned.splitlines():
        value = line.strip()
        if not value:
            continue
        # Recommendation/download pages often append long rows of unrelated filenames.
        file_mentions = len(re.findall(r"\.(?:docx?|pdf|pptx?|xlsx?)\b", value, flags=re.IGNORECASE))
        if file_mentions >= 3:
            continue
        lines.append(value)
    cleaned = "\n\n".join(lines)
    return cleaned[:limit]


def _normalize_book_graph(raw: object, title: str) -> dict:
    """Validate LLM graph output so the UI never receives dangling edges or duplicate ids."""
    payload = raw if isinstance(raw, dict) else {}
    raw_nodes = payload.get("nodes") if isinstance(payload, dict) else []
    raw_edges = payload.get("edges") if isinstance(payload, dict) else []
    nodes: list[dict] = []
    seen: set[str] = set()
    allowed_kinds = {"root", "chapter", "concept", "example"}
    for index, item in enumerate(raw_nodes if isinstance(raw_nodes, list) else []):
        if not isinstance(item, dict) or not str(item.get("label", "")).strip():
            continue
        node_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(item.get("id", ""))) or f"node_{index}"
        if node_id in seen:
            node_id = f"{node_id}_{index}"
        seen.add(node_id)
        kind = str(item.get("kind", "concept"))
        try:
            importance = int(item.get("importance", 3) or 3)
        except (TypeError, ValueError):
            importance = 3
        nodes.append({
            "id": node_id,
            "label": str(item.get("label", "")).strip()[:24],
            "kind": kind if kind in allowed_kinds else "concept",
            "group": str(item.get("group", "核心内容")).strip()[:20] or "核心内容",
            "summary": str(item.get("summary", "")).strip()[:240],
            "importance": max(1, min(5, importance)),
        })
        if len(nodes) >= 36:
            break
    valid_ids = {node["id"] for node in nodes}
    edges: list[dict] = []
    for item in raw_edges if isinstance(raw_edges, list) else []:
        if not isinstance(item, dict):
            continue
        source, target = str(item.get("source", "")), str(item.get("target", ""))
        if source in valid_ids and target in valid_ids and source != target:
            edges.append({"source": source, "target": target, "relation": str(item.get("relation", "关联"))[:16]})
        if len(edges) >= 72:
            break
    return {
        "title": str(payload.get("title") or title),
        "overview": str(payload.get("overview") or "")[:500],
        "nodes": nodes,
        "edges": edges,
    }


_BOOK_GRAPH_PROMPT = """你是教材结构分析 Agent。请只根据下方提供的书籍正文与摘要，提炼一张覆盖全书结构、可供学生浏览的整体知识图谱。

书名：{title}
资料摘要：{summary}
正文（可能包含目录、章节标题与正文）：
{content}

要求：
1. 生成 18-32 个节点，必须包含且只包含 1 个 root，并尽量覆盖正文或目录中出现的全部主要章节。
2. 建立“全书主题 root → 章节 chapter → 核心概念 concept → 示例/应用 example”的层级；每个主要章节提炼 2-4 个最关键概念。
3. group 必须填写节点所属章节名；章节节点的 group 填“全书结构”。边方向必须从上层或前置知识指向下层或后续知识。
4. 除“包含”关系外，补充有正文依据的跨章节“依赖、应用、对比”关系，让学生能看出全书学习顺序。
5. 节点 id 只能使用英文、数字、下划线；重要度 importance 为 1-5；label 保持简短可读。
6. 不要补充正文中没有依据的作者观点或知识；正文不足以支撑全书时，在 overview 中明确说明覆盖范围。
7. 只输出 JSON：
{{"title":"书名","overview":"全书结构概述","nodes":[{{"id":"root","label":"核心主题","kind":"root","group":"总览","summary":"说明","importance":5}}],"edges":[{{"source":"root","target":"chapter_1","relation":"包含"}}]}}"""


@router.post("/book-preview")
async def book_preview(req: BookPreviewRequest):
    """Fetch a readable excerpt for an item saved to the learner's bookshelf."""
    if not req.url:
        raise HTTPException(status_code=400, detail="url 不能为空")
    try:
        text = await asyncio.to_thread(fetch_readable_text, req.url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"预览抓取失败: {exc}")
    cleaned = _clean_book_text(text, 6000)
    if len(cleaned) < 200:
        summary = _clean_book_text(req.summary, 1200)
        if len(summary) >= 40:
            return {
                "title": req.title.strip() or req.url,
                "url": req.url,
                "excerpt": summary,
                "chars": len(text),
                "notice": "来源站点只提供下载/详情页，暂时无法读取文件正文；这里显示搜索摘要，可点击“原文”访问来源页面。",
                "full_text_available": False,
            }
        raise HTTPException(status_code=422, detail="来源站点没有公开可读正文。请点击“原文”访问下载页，或把本地文件拖入智能教师。")
    return {
        "title": req.title.strip() or req.url,
        "url": req.url,
        "excerpt": cleaned,
        "chars": len(text),
        "notice": "",
        "full_text_available": True,
    }


@router.post("/book-graph")
async def book_graph(req: BookGraphRequest):
    """Let an LLM agent turn one saved book/source into a validated knowledge graph."""
    if not req.url:
        raise HTTPException(status_code=400, detail="url 不能为空")
    try:
        text = await asyncio.to_thread(fetch_readable_text, req.url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"正文抓取失败: {exc}")
    cleaned = _clean_book_text(text)
    if len(cleaned) < 400:
        raise HTTPException(status_code=422, detail="正文内容不足，无法生成可靠知识图谱")
    try:
        llm = get_llm(temperature=0.2)
        response = await llm.ainvoke(_BOOK_GRAPH_PROMPT.format(
            title=req.title or req.url,
            summary=req.summary.strip() or "未提供",
            content=cleaned,
        ))
        graph = _normalize_book_graph(parse_json_response(response.content), req.title or req.url)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"知识图谱生成失败: {exc}")
    if len(graph["nodes"]) < 3:
        raise HTTPException(status_code=502, detail="Agent 返回的知识节点不足，请重试")
    return graph


@router.post("/webimport")
async def web_import(req: WebImportRequest):
    """抓取网页正文 → 分块 → bge 向量化 → 写入独立 web_kb 集合（不污染精编库）。"""
    if not req.url:
        raise HTTPException(status_code=400, detail="url 不能为空")
    try:
        text = await asyncio.to_thread(fetch_readable_text, req.url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"抓取失败: {e}")

    if len(text) < 200:
        raise HTTPException(status_code=422, detail="正文过少（可能是下载页/需登录页），换一条试试")

    source = req.title.strip() or req.url
    chunks = chunk_plain_text(text, source)
    uid = hashlib.md5(req.url.encode("utf-8")).hexdigest()[:8]
    for i, c in enumerate(chunks):
        c["id"] = f"web_{uid}_{i}"
        c["metadata"]["origin"] = "web"
        c["metadata"]["url"] = req.url

    try:
        await asyncio.to_thread(add_documents, chunks, WEB_KB_COLLECTION)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"入库失败: {e}")

    return {"imported": len(chunks), "title": source, "url": req.url, "chars": len(text)}


@router.get("/webdocs")
async def web_docs():
    """列出已导入的网络资料（按 url 聚合，供前端在知识库展示）。"""
    try:
        from app.services.rag import get_or_create_collection

        col = get_or_create_collection(WEB_KB_COLLECTION)
        got = col.get(include=["metadatas"])
        agg: dict[str, dict] = {}
        for m in got.get("metadatas") or []:
            url = m.get("url", "")
            if not url:
                continue
            entry = agg.setdefault(url, {"url": url, "title": m.get("source", url), "chunks": 0})
            entry["chunks"] += 1
        return {"docs": list(agg.values())}
    except Exception:
        return {"docs": []}


# ════════════ 智能荐书：按专业/年级让 agent 判别核心教材 ════════════

_RECOMMEND_BOOKS_PROMPT = """你是高校教务与教材顾问。根据学生的专业和年级，列出该阶段最核心、最主流的课程教材（3-6 本）。

专业：{major}
年级：{grade}

要求：
1. 只列公认的经典/权威教材（例：《数据结构》严蔚敏、《计算机组成原理》唐朔飞、《操作系统概念》）。
2. 贴合该专业该年级实际开设的课程。
3. 输出 JSON 数组，不要任何多余文字：
[{{"title":"书名","author":"作者","course":"对应课程","reason":"这一阶段为什么需要它（一句话）"}}]"""


@router.get("/recommend-books")
async def recommend_books(major: str, grade: str):
    """按专业 + 年级，让 LLM 推荐该阶段核心教材书单。"""
    major = (major or "").strip()
    grade = (grade or "").strip()
    if not major or not grade:
        raise HTTPException(status_code=400, detail="major 和 grade 必填")
    try:
        llm = get_llm(temperature=0.3)
        resp = await llm.ainvoke(_RECOMMEND_BOOKS_PROMPT.format(major=major, grade=grade))
        books = parse_json_response(resp.content)
        if isinstance(books, dict):
            books = books.get("books") or books.get("list") or books.get("教材") or []
        out = []
        for b in books[:8]:
            if isinstance(b, dict) and b.get("title"):
                out.append({
                    "title": str(b.get("title", "")),
                    "author": str(b.get("author", "")),
                    "course": str(b.get("course", "")),
                    "reason": str(b.get("reason", "")),
                })
        return {"major": major, "grade": grade, "books": out}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"荐书失败: {e}")


_RECOMMEND_EDITIONS_PROMPT = """你是高校教材版本顾问。学生想学习「{subject}」，但知识库里还没有这门科目的教材。
请列出该科目最权威、最主流的 2-4 个教材版本（可以是不同作者、不同版次、不同出版社），供学生选择下载哪一版。

要求：
1. 必须是真实存在、广泛使用的教材与版次（例：《数据结构（C语言版）》严蔚敏 清华大学出版社；《算法导论》第3版 机械工业出版社）。
2. 给最推荐的一版标 recommended=true，其余 false。
3. note 用一句话说明这一版的特点 / 适合谁。
4. 只输出 JSON 数组，不要任何多余文字：
[{{"title":"书名","author":"作者","edition":"版次(如 第3版/C语言版)","publisher":"出版社","note":"一句话特点","recommended":true}}]"""


@router.get("/recommend-editions")
async def recommend_editions(subject: str):
    """某科目在知识库未命中时：让 LLM 列出该科目的主流教材版本，供用户选择下载哪一版。"""
    subject = (subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="subject 必填")
    try:
        llm = get_llm(temperature=0.3)
        resp = await llm.ainvoke(_RECOMMEND_EDITIONS_PROMPT.format(subject=subject))
        editions = parse_json_response(resp.content)
        if isinstance(editions, dict):
            editions = editions.get("editions") or editions.get("list") or editions.get("books") or []
        out = []
        for b in editions[:5]:
            if isinstance(b, dict) and b.get("title"):
                out.append({
                    "title": str(b.get("title", "")),
                    "author": str(b.get("author", "")),
                    "edition": str(b.get("edition", "")),
                    "publisher": str(b.get("publisher", "")),
                    "note": str(b.get("note", "")),
                    "recommended": bool(b.get("recommended", False)),
                })
        return {"subject": subject, "editions": out}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"版本推荐失败: {e}")


class AutoImportRequest(BaseModel):
    query: str
    title: str = ""


@router.post("/autoimport")
async def auto_import(req: AutoImportRequest):
    """给定书名/关键词：博查搜索 → 逐条尝试抓取 → 第一条能抓到正文的入 web_kb。"""
    q = (req.query or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="query 不能为空")
    try:
        results = await asyncio.to_thread(bocha_search, q, 8)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"搜索失败: {e}")

    for r in results:
        url = r.get("url", "")
        if not url:
            continue
        try:
            text = await asyncio.to_thread(fetch_readable_text, url)
        except Exception:
            continue
        if len(text) < 200:
            continue
        source = req.title.strip() or r.get("title") or url
        chunks = chunk_plain_text(text, source)
        uid = hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
        for i, c in enumerate(chunks):
            c["id"] = f"web_{uid}_{i}"
            c["metadata"]["origin"] = "web"
            c["metadata"]["url"] = url
        try:
            await asyncio.to_thread(add_documents, chunks, WEB_KB_COLLECTION)
        except Exception:
            continue
        return {"imported": len(chunks), "title": source, "url": url, "site": r.get("site", "")}

    raise HTTPException(status_code=404, detail="没找到能抓取正文的资料，换个书名/关键词试试")
