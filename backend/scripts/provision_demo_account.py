"""Explicitly create/update the public furia demo login, preserving its learning data.

Run from backend: python scripts/provision_demo_account.py --password '<demo password>'
This is an operator command, never an automatic authentication bypass or startup seed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.core.config import async_session, engine
from app.core.migrations import migrate_database
from app.models import account as account_models
from app.services.auth import hash_password


async def provision(password: str) -> None:
    await migrate_database(engine)
    async with async_session() as db:
        account = await db.scalar(select(account_models.UserAccount).where(account_models.UserAccount.login == "furia"))
        created = account is None
        if account is None:
            account = account_models.UserAccount(
                id=f"local_{uuid4()}", login="furia", grade="大二上", major="软件工程",
                preferences=["图示讲解", "动手练习"], onboarding_completed=True,
                password_hash=hash_password(password),
            )
            db.add(account)
        else:
            account.password_hash = hash_password(password)
        await db.commit()
        print(json.dumps({"login": account.login, "id": account.id, "created": created, "learning_data": "preserved"}))
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    if not 8 <= len(args.password) <= 128:
        parser.error("Password must contain 8–128 characters")
    asyncio.run(provision(args.password))
