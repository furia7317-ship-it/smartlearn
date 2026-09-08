from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def disable_external_mimo_tts(monkeypatch):
    """Tests must opt in explicitly before exercising the external provider."""

    from app.core.config import settings

    monkeypatch.setattr(settings, "MIMO_TTS_ENABLED", False)


@pytest.fixture(autouse=True)
def isolate_agent_run_persistence(monkeypatch, request):
    """Ordinary unit tests must not append trace events to the developer DB."""

    if request.node.get_closest_marker("agent_run_db"):
        return

    async def ignore_agent_event(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        "app.services.agent_run_store.persist_agent_event",
        ignore_agent_event,
    )
    monkeypatch.setattr(
        "app.services.agent_run_store.persist_stream_event",
        ignore_agent_event,
    )
