"""运行时配置 — pydantic-settings + 数据库连接。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """从环境变量 / .env 读取的全局配置。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── 应用 ──
    APP_NAME: str = "学枢"
    DEBUG: bool = True
    # app://local 供 Electron 桌面壳（渲染进程自定义协议）跨域访问后端
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "app://local",
    ]
    # Portable Web may be opened through the machine/WSL private-network IP.
    # Limit the dynamic allowance to RFC1918/loopback hosts and known frontend
    # development ports instead of accepting arbitrary credentialed origins.
    CORS_ORIGIN_REGEX: str = (
        r"^http://(?:"
        r"localhost|127\.0\.0\.1|\[::1\]|"
        r"10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|"
        r"172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}"
        r"):(?:3000|5173)$"
    )

    # ── 数据库 ──
    DATABASE_URL: str = "sqlite+aiosqlite:///./smartlearn.db"
    # SQL 逐句输出会在 Windows/WSL 桌面开发环境制造大量同步终端 I/O。
    # 与 DEBUG 解耦，按需诊断时再通过环境变量显式开启。
    SQL_ECHO: bool = False

    # ── Chroma 向量库 ──
    CHROMA_PERSIST_DIR: str = "./chroma"
    EMBEDDING_MODEL: str = "BAAI/bge-small-zh-v1.5"  # 中文检索嵌入（512 维）
    # Calibrated on evals/rag_recall_v1.jsonl: all 24 out-of-domain cases stay
    # below this boundary while deterministic lexical anchors preserve known topics.
    KB_RELEVANCE_THRESHOLD: float = 0.75
    RAG_EMBEDDER_RETRY_SECONDS: float = 60.0
    RAG_VECTOR_CANDIDATES: int = 20
    RAG_LEXICAL_CANDIDATES: int = 20
    RAG_RRF_K: int = 60
    RAG_MAX_RESULTS_PER_SOURCE: int = 2
    RAG_INDEX_BATCH_SIZE: int = 64
    PLAN_MAX_OUTPUT_TOKENS: int = 5000
    # Agent runtime safety bounds. Keep retries low because graph nodes already
    # own the business-level retry policy.
    LLM_REQUEST_TIMEOUT_SECONDS: float = 60.0
    LLM_MAX_RETRIES: int = 1
    # Generation and delegated-agent fan-out. The runtime clamps this value to
    # 30 so deployments can tune downward without accidentally exceeding the
    # product-level parallelism ceiling.
    AGENT_MAX_CONCURRENCY: int = 30
    SSE_QUEUE_MAXSIZE: int = 128
    SSE_CANCEL_GRACE_SECONDS: float = 5.0
    # ── 全局智能教师上下文预算 ──
    # The total includes the reserved completion budget.  Section limits are
    # hard ceilings; unused budget is reported rather than filled with noise.
    CHAT_CONTEXT_TOKEN_BUDGET: int = 24000
    CHAT_RESPONSE_TOKEN_RESERVE: int = 4000
    CHAT_SYSTEM_TOKEN_BUDGET: int = 2500
    CHAT_MEMORY_TOKEN_BUDGET: int = 3000
    CHAT_KNOWLEDGE_TOKEN_BUDGET: int = 3500
    CHAT_ATTACHMENT_TOKEN_BUDGET: int = 5000
    CHAT_HISTORY_TOKEN_BUDGET: int = 4500
    CHAT_QUESTION_TOKEN_BUDGET: int = 1500
    # Optional stable HMAC key for short-lived server-issued material approval
    # markers. A random per-process key is used for local single-worker runs.
    MATERIAL_APPROVAL_SECRET: str = ""

    # ── LLM（多 provider） ──
    DEFAULT_LLM_PROVIDER: str = "deepseek"
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    QWEN_API_KEY: str = ""
    QWEN_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    SPARK_API_KEY: str = ""
    SPARK_BASE_URL: str = "https://spark-api-open.xf-yun.com/v1"
    SPARK_MODEL: str = "generalv3.5"
    SPARK_APPID: str = ""
    SPARK_API_SECRET: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    # ── 讯飞 ──
    IFLYTEK_APPID: str = ""
    IFLYTEK_API_KEY: str = ""
    IFLYTEK_API_SECRET: str = ""
    IFLYTEK_TTS_ENABLED: bool = False
    IFLYTEK_TTS_URL: str = "wss://tts-api.xfyun.cn/v2/tts"
    IFLYTEK_IAT_URL: str = "wss://iat-api.xfyun.cn/v2/iat"
    IFLYTEK_OCR_URL: str = "https://webapi.xfyun.cn/v1/ai/v1/ocr"
    # 图片理解与 PDF OCR 可配置独立凭据；留空时复用数字人应用，随后再回退通用讯飞凭据。
    IFLYTEK_VISION_APPID: str = ""
    IFLYTEK_VISION_API_KEY: str = ""
    IFLYTEK_VISION_API_SECRET: str = ""
    IFLYTEK_VISION_URL: str = "wss://spark-api.cn-huabei-1.xf-yun.com/v2.1/image"
    IFLYTEK_PDF_OCR_APPID: str = ""
    IFLYTEK_PDF_OCR_API_SECRET: str = ""
    IFLYTEK_PDF_OCR_START_URL: str = "https://iocr.xfyun.cn/ocrzdq/v1/pdfOcr/start"
    IFLYTEK_PDF_OCR_STATUS_URL: str = "https://iocr.xfyun.cn/ocrzdq/v1/pdfOcr/status"
    IFLYTEK_PDF_OCR_TIMEOUT_SECONDS: int = 120

    # ── Xiaomi MiMo 语音合成（可选，视频配音首选） ──
    MIMO_TTS_ENABLED: bool = False
    MIMO_API_KEY: str = ""
    MIMO_TTS_BASE_URL: str = "https://api.xiaomimimo.com/v1"
    MIMO_TTS_MODEL: str = "mimo-v2.5-tts"
    MIMO_TTS_VOICE: str = "茉莉"
    MIMO_TTS_STYLE: str = "自然、清晰、有亲和力的教学讲解，语速适中，重点词稍作停顿。"

    # ── MiniMax 语音合成（可选，优先于讯飞 TTS） ──
    MINIMAX_TTS_ENABLED: bool = False
    MINIMAX_API_KEY: str = ""
    MINIMAX_GROUP_ID: str = ""
    MINIMAX_TTS_URL: str = "https://api.minimaxi.com/v1/t2a_v2"
    MINIMAX_TTS_MODEL: str = "speech-02-hd"
    MINIMAX_TTS_VOICE_ID: str = "male-qn-qingse"
    MINIMAX_TTS_SPEED: float = 1.0

    # ── 讯飞 2D 虚拟人（数字人）—— 独立 App，与上面的智文/TTS 不是同一套凭证 ──
    IFLYTEK_AVATAR_APPID: str = ""
    IFLYTEK_AVATAR_API_KEY: str = ""
    IFLYTEK_AVATAR_API_SECRET: str = ""
    IFLYTEK_AVATAR_ID: str = ""  # 形象ID（avatarId），如 201294001
    IFLYTEK_AVATAR_SCENE_ID: str = ""  # 场景ID（可选，部分账号需要）
    IFLYTEK_AVATAR_VCN: str = "x4_lingxiaoxuan_oral"  # 发音人（控制台可查可用 vcn）

    # ── 联网搜索（博查 Bocha，国内可达、不翻墙） ──
    BOCHA_API_KEY: str = ""
    BOCHA_SEARCH_URL: str = "https://api.bochaai.com/v1/web-search"

    # ── 媒体渲染 ──
    MEDIA_OUTPUT_DIR: str = "./media/output"
    MANIM_QUALITY: str = "low_quality"  # 演示用 low_quality，生产改 production_quality
    # Optional relevant B-roll provider used by the scene renderer.  The
    # branded animated storyboard remains the offline fallback.
    PEXELS_API_KEY: str = ""
    # Persistent user-maintained pronunciation dictionary. JSON can be either
    # {"API": "A P I"} or a list of {"term": ..., "spoken": ...} objects.
    MEDIA_PRONUNCIATION_LEXICON_PATH: str = str(
        Path(__file__).resolve().parents[3] / "knowledge" / "pronunciation.json"
    )
    # Optional directory containing licensed .mp3/.wav/.m4a background music.
    MEDIA_MUSIC_DIR: str = ""

    # ── 文件路径 ──
    KNOWLEDGE_DIR: str = str(Path(__file__).resolve().parent.parent.parent / "knowledge")

    @field_validator("MEDIA_OUTPUT_DIR")
    @classmethod
    def resolve_media_output_dir(cls, value: str) -> str:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = _BACKEND_ROOT / path
        return str(path.resolve())


@lru_cache
def get_settings() -> Settings:
    return Settings()


# SQLAlchemy async engine 单例
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker  # noqa: E402

settings = get_settings()


def _ensure_sqlite_parent(database_url: str) -> None:
    """为文件型 SQLite URL 创建父目录，容器挂载卷可直接首次启动。"""
    prefix = "sqlite+aiosqlite:///"
    if not database_url.startswith(prefix):
        return
    database_path = database_url.removeprefix(prefix).split("?", 1)[0]
    if not database_path or database_path == ":memory:":
        return
    Path(database_path).expanduser().parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_parent(settings.DATABASE_URL)

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.SQL_ECHO,
    future=True,
)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """FastAPI 依赖：提供 async session。"""
    async with async_session() as session:
        yield session


# 同步 engine —— 供 LangGraph 同步节点内读写画像（与 async engine 指向同一个库文件）
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

sync_engine = create_engine(settings.DATABASE_URL.replace("+aiosqlite", ""), future=True)
sync_session = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)
