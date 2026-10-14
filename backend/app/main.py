"""FastAPI 应用入口 — 装配路由、启动建表、注册图。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from contextlib import suppress
import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import async_session, engine, settings
from app.core.migrations import migrate_database, _migrate_resource_collections, _migrate_agent_memory  # noqa: F401
from app.services.llm_provider_settings import ensure_default_llm_providers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时建表 + 初始化 Chroma；关闭时清理。"""
    await migrate_database(engine)

    # 首次启动把旧 .env 中的模型配置导入为可编辑的 OpenAI 兼容预设。
    async with async_session() as db:
        await ensure_default_llm_providers(db)
        from app.services.procedure_skill_runtime import ensure_builtin_skills
        await ensure_builtin_skills(db)

    # 确保媒体输出目录存在
    Path(settings.MEDIA_OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

    # Cloud model/index changes also require migration in packaged releases.
    from app.services.bootstrap import ensure_kb_imported
    knowledge_worker = asyncio.create_task(ensure_kb_imported())

    from app.services.learning_data import run_learning_data_worker
    learning_data_worker = asyncio.create_task(run_learning_data_worker())
    from app.services.skill_reflection import run_skill_reflection_worker
    skill_reflection_worker = asyncio.create_task(run_skill_reflection_worker())
    from app.services.focus_generation import run_focus_worker
    focus_worker = asyncio.create_task(run_focus_worker())
    try:
        yield
    finally:
        focus_worker.cancel()
        with suppress(asyncio.CancelledError):
            await focus_worker
        skill_reflection_worker.cancel()
        with suppress(asyncio.CancelledError):
            await skill_reflection_worker
        knowledge_worker.cancel()
        with suppress(asyncio.CancelledError):
            await knowledge_worker
        learning_data_worker.cancel()
        with suppress(asyncio.CancelledError):
            await learning_data_worker

    # 清理
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    description="AI 驱动的个性化学习平台 — LangGraph 多智能体编排",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS（开发阶段放通，生产收紧）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 注册路由 ──
from app.routers import (  # noqa: E402
    agent_runs,
    agents,
    assess,
    auth,
    avatar,
    behavior,
    chat,
    code_lab,
    config as config_router,
    conversations,
    custom_agents,
    dashboard,
    diagnostic,
    focus,
    graph,
    goals,
    galgame,
    kb,
    learner_settings,
    market,
    materials,
    media,
    memory,
    papers,
    path as path_router,
    profile,
    procedure_skills,
    resource_collections,
    resource_plans,
    voice,
    videos,
    web as web_router,
    wrongbook,
    training,
    learning_data,
)

app.include_router(agent_runs.router, prefix="/api/agent-runs", tags=["Agent 运行"])
app.include_router(agents.router, prefix="/api/agents", tags=["智能体"])
app.include_router(learning_data.router, prefix="/api/learning-data", tags=["学习数据管家"])
app.include_router(assess.router, prefix="/api/assess", tags=["测评"])
app.include_router(auth.router, prefix="/api/auth", tags=["账户"])
app.include_router(avatar.router, prefix="/api/avatar", tags=["数字人"])
app.include_router(behavior.router, prefix="/api/behavior", tags=["行为埋点"])
app.include_router(chat.router, prefix="/api/chat", tags=["辅导"])
app.include_router(code_lab.router, prefix="/api/code-lab", tags=["代码学习"])
app.include_router(training.router, prefix="/api/training", tags=["路径实训"])
app.include_router(config_router.router, prefix="/api/config", tags=["配置"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["会话"])
app.include_router(custom_agents.router, prefix="/api/custom-agents", tags=["自建智能体"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["仪表盘"])
app.include_router(diagnostic.router, prefix="/api/diagnostic", tags=["摸底"])
app.include_router(focus.router, prefix="/api/focus", tags=["课程国策树"])
app.include_router(graph.router, prefix="/api/graph", tags=["协作图"])
app.include_router(goals.router, prefix="/api/goals", tags=["目标"])
app.include_router(galgame.router, prefix="/api/galgame", tags=["资料剧场"])
app.include_router(kb.router, prefix="/api/kb", tags=["知识库"])
app.include_router(learner_settings.router, prefix="/api/settings", tags=["用户设置"])
app.include_router(market.router, prefix="/api/market", tags=["学习市场"])
app.include_router(materials.router, prefix="/api/materials", tags=["生成资料库"])
app.include_router(media.router, prefix="/api/media", tags=["媒体"])
app.include_router(memory.router, prefix="/api/memory", tags=["记忆训练"])
app.include_router(papers.router, prefix="/api/papers", tags=["题库"])
app.include_router(path_router.router, prefix="/api/path", tags=["学习路径"])
app.include_router(profile.router, prefix="/api/profile", tags=["画像"])
app.include_router(procedure_skills.router, prefix="/api/procedure-skills", tags=["教学方法"])
app.include_router(resource_collections.router, prefix="/api/resource-collections", tags=["资源集合"])
app.include_router(resource_plans.router, prefix="/api/agents", tags=["资源规划"])
app.include_router(voice.router, prefix="/api/voice", tags=["实时语音"])
app.include_router(videos.router, prefix="/api/videos", tags=["视频学习"])
app.include_router(web_router.router, prefix="/api/web", tags=["网页总结"])
app.include_router(wrongbook.router, prefix="/api/wrongbook", tags=["错题本"])


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "0.1.0", "status": "running"}
