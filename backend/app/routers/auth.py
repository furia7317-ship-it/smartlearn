"""注册、登录、会话恢复与首次学情引导。"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from ipaddress import ip_address
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_db, settings
from app.models.account import UserAccount, UserSession
from app.models.learning import LearningGoal
from app.models.profile import Profile
from app.services.auth import hash_password, hash_session_token, new_session_token, verify_password
from app.services.major_catalog import MajorLevel, get_major, search_majors


router = APIRouter()

SESSION_COOKIE = "sl_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
LOCAL_STUDENT_ID = re.compile(
    r"^local_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
VALID_LOGIN = re.compile(r"^[^\s/\\]{3,128}$")
_DUMMY_PASSWORD_HASH = hash_password("invalid-account-password")


def _normalized_login(value: str) -> str:
    return value.strip().casefold()


class Credentials(BaseModel):
    login: str = Field(min_length=3, max_length=128)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("login")
    @classmethod
    def validate_login(cls, value: str) -> str:
        normalized = _normalized_login(value)
        if not VALID_LOGIN.fullmatch(normalized):
            raise ValueError("账号只能使用邮箱或不含空格的用户名")
        return normalized


class RegisterRequest(Credentials):
    anonymous_student_id: str | None = None


class OnboardingRequest(BaseModel):
    grade: Literal[
        "大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下",
        "研一上", "研一下", "研二上", "研二下", "研三上", "研三下", "博士",
        # Accept existing accounts while all new selections include a semester.
        "大一", "大二", "大三", "大四", "研一", "研二", "研三",
    ]
    major: str = Field(min_length=1, max_length=128)
    major_code: str = Field(min_length=4, max_length=9)
    major_level: MajorLevel
    preferences: list[str] = Field(min_length=1, max_length=8)
    long_term_goal: str = Field(default="", max_length=1000)
    mid_term_goal: str = Field(default="", max_length=1000)
    short_term_goal: str = Field(default="", max_length=1000)

    @field_validator("major")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("该项不能为空")
        return normalized

    @field_validator("major_code")
    @classmethod
    def normalize_major_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("long_term_goal", "mid_term_goal", "short_term_goal")
    @classmethod
    def trim_optional_goal(cls, value: str) -> str:
        return value.strip()

    @field_validator("preferences")
    @classmethod
    def normalize_preferences(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not normalized:
            raise ValueError("至少选择一项学习偏好")
        if any(len(item) > 32 for item in normalized):
            raise ValueError("学习偏好内容过长")
        return normalized


class AccountResponse(BaseModel):
    id: str
    login: str
    display_name: str
    grade: str
    major: str
    preferences: list[str]
    long_term_goal: str
    mid_term_goal: str
    short_term_goal: str
    onboarding_completed: bool


class SessionResponse(BaseModel):
    user: AccountResponse | None


def account_display_name(account: UserAccount) -> str:
    """Return the stable account fallback used when no profile override exists."""

    return account.login.split("@", 1)[0]


def _serialize_account(account: UserAccount) -> AccountResponse:
    display_name = account_display_name(account)
    return AccountResponse(
        id=account.id,
        login=account.login,
        display_name=display_name,
        grade=account.grade or "",
        major=account.major or "",
        preferences=list(account.preferences or []),
        long_term_goal=account.long_term_goal or "",
        mid_term_goal=account.mid_term_goal or "",
        short_term_goal=account.short_term_goal or "",
        onboarding_completed=bool(account.onboarding_completed),
    )


def _desktop_cookie_request(request: Request) -> bool:
    return request.headers.get("origin", "").rstrip("/") == "app://local"


def _local_http_cookie_request(request: Request) -> bool:
    """Local portable Web runs on HTTP, where browsers reject Secure cookies."""
    if request.url.scheme != "http":
        return False
    hostname = request.url.hostname or ""
    if hostname == "localhost":
        return True
    try:
        address = ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def _session_cookie_options(request: Request) -> dict[str, bool | str]:
    if _desktop_cookie_request(request):
        # The Electron renderer is served from app://local while the bundled
        # backend remains on http://localhost:8000. A Lax cookie is discarded
        # in that cross-site response, so the successful login is immediately
        # followed by an unauthenticated /me request.
        return {"secure": True, "samesite": "none"}
    if _local_http_cookie_request(request):
        return {"secure": False, "samesite": "lax"}
    return {"secure": not settings.DEBUG, "samesite": "lax"}


def _set_session_cookie(response: Response, token: str, request: Request) -> None:
    cookie_options = _session_cookie_options(request)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=bool(cookie_options["secure"]),
        samesite=str(cookie_options["samesite"]),
        path="/",
    )


async def _start_session(
    db: AsyncSession,
    response: Response,
    account: UserAccount,
    request: Request,
) -> None:
    now = int(time.time())
    await db.execute(delete(UserSession).where(UserSession.expires_at <= now))
    token = new_session_token()
    db.add(
        UserSession(
            token_hash=hash_session_token(token),
            user_id=account.id,
            expires_at=now + SESSION_SECONDS,
        )
    )
    await db.commit()
    _set_session_cookie(response, token, request)


async def get_current_account(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    db: AsyncSession = Depends(get_db),
) -> UserAccount:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="尚未登录")

    token_hash = hash_session_token(session_token)
    session = await db.get(UserSession, token_hash)
    if session is None or session.expires_at <= int(time.time()):
        if session is not None:
            await db.delete(session)
            await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期")

    account = await db.get(UserAccount, session.user_id)
    if account is None:
        await db.delete(session)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账户不存在")
    return account


async def require_account_student_scope(
    request: Request,
    account: UserAccount = Depends(get_current_account),
) -> UserAccount:
    """Authenticate one API request and reject client-selected learner identities.

    Account IDs are the canonical ``student_id`` across the application.  Older
    clients still send that value in paths, query strings, and JSON bodies, so
    the compatibility boundary validates every supplied value instead of
    trusting it as authorization.
    """

    supplied: list[str] = []
    path_student_id = request.path_params.get("student_id")
    if path_student_id:
        supplied.append(str(path_student_id))
    query_student_id = request.query_params.get("student_id")
    if query_student_id:
        supplied.append(str(query_student_id))

    content_type = request.headers.get("content-type", "").casefold()
    if "application/json" in content_type:
        try:
            payload = await request.json()
        except (ValueError, TypeError):
            payload = None
        if isinstance(payload, dict) and payload.get("student_id"):
            supplied.append(str(payload["student_id"]))

    if any(student_id != account.id for student_id in supplied):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "student_scope_forbidden",
                "message": "不能访问或修改其他学习者的数据。",
            },
        )
    return account


@router.post("/register", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
async def register(
    req: RegisterRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.scalar(select(UserAccount).where(UserAccount.login == req.login))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该账号已注册")

    account_count = int(await db.scalar(select(func.count(UserAccount.id))) or 0)
    can_claim_anonymous = (
        account_count == 0
        and req.anonymous_student_id is not None
        and LOCAL_STUDENT_ID.fullmatch(req.anonymous_student_id) is not None
    )
    account_id = req.anonymous_student_id if can_claim_anonymous else f"local_{uuid4()}"
    account = UserAccount(
        id=account_id,
        login=req.login,
        password_hash=hash_password(req.password),
    )
    db.add(account)
    await db.flush()
    await _start_session(db, response, account, request)
    return _serialize_account(account)


@router.post("/login", response_model=AccountResponse)
async def login(
    req: Credentials,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    account = await db.scalar(select(UserAccount).where(UserAccount.login == req.login))
    encoded = account.password_hash if account is not None else _DUMMY_PASSWORD_HASH
    if not verify_password(req.password, encoded) or account is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    await _start_session(db, response, account, request)
    return _serialize_account(account)


@router.get("/me", response_model=AccountResponse)
async def me(account: UserAccount = Depends(get_current_account)):
    return _serialize_account(account)


@router.get("/session", response_model=SessionResponse)
async def session(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        account = await get_current_account(session_token, db)
    except HTTPException as error:
        if error.status_code == status.HTTP_401_UNAUTHORIZED:
            return SessionResponse(user=None)
        raise
    return SessionResponse(user=_serialize_account(account))


@router.get("/majors")
async def list_majors(
    query: str = Query(min_length=1, max_length=64),
    level: MajorLevel = Query(),
):
    return {"results": search_majors(query, level)}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = await db.get(UserSession, hash_session_token(token))
        if session is not None:
            await db.delete(session)
            await db.commit()
    cookie_options = _session_cookie_options(request)
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        secure=bool(cookie_options["secure"]),
        samesite=str(cookie_options["samesite"]),
    )
    return {"ok": True}


@router.put("/onboarding", response_model=AccountResponse)
async def complete_onboarding(
    req: OnboardingRequest,
    account: UserAccount = Depends(get_current_account),
    db: AsyncSession = Depends(get_db),
):
    expected_level: MajorLevel = "undergraduate" if req.grade.startswith("大") else "graduate"
    selected_major = get_major(req.major_code, req.major_level)
    if req.major_level != expected_level or selected_major is None or selected_major["name"] != req.major:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="专业必须从当前年级对应的教育部专业目录中选择",
        )

    canonical_major = selected_major["name"]
    account.grade = req.grade
    account.major = canonical_major
    account.preferences = req.preferences
    account.long_term_goal = req.long_term_goal
    account.mid_term_goal = req.mid_term_goal
    account.short_term_goal = req.short_term_goal
    account.onboarding_completed = True

    profile = await db.get(Profile, account.id)
    if profile is None:
        profile = Profile(student_id=account.id)
        db.add(profile)
    profile.interests = [{"topic": item, "level": "preferred"} for item in req.preferences]
    cognitive_style = dict(profile.cognitive_style or {})
    cognitive_style["learning_preferences"] = req.preferences
    profile.cognitive_style = cognitive_style
    profile_goals = dict(profile.goals or {})
    profile_goals["education"] = {
        "grade": req.grade,
        "major": canonical_major,
        "major_code": selected_major["code"],
        "major_level": selected_major["level"],
    }
    profile_goals["onboarding"] = {
        "long": req.long_term_goal,
        "mid": req.mid_term_goal,
        "short": req.short_term_goal,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    profile.goals = profile_goals

    result = await db.execute(
        select(LearningGoal).where(
            LearningGoal.student_id == account.id,
            LearningGoal.source.in_(["onboarding:long", "onboarding:mid", "onboarding:short"]),
        )
    )
    existing_goals = {str(goal.source).rsplit(":", 1)[-1]: goal for goal in result.scalars().all()}
    for horizon, title in (
        ("long", req.long_term_goal),
        ("mid", req.mid_term_goal),
        ("short", req.short_term_goal),
    ):
        if not title:
            continue
        goal = existing_goals.get(horizon)
        if goal is None:
            db.add(
                LearningGoal(
                    student_id=account.id,
                    title=title,
                    description="首次学情引导设置",
                    topic=canonical_major,
                    source=f"onboarding:{horizon}",
                )
            )
        else:
            goal.title = title
            goal.topic = canonical_major
            goal.status = "active"

    await db.commit()
    await db.refresh(account)
    return _serialize_account(account)
