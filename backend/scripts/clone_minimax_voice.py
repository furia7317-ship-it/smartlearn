"""Provision the configured MiniMax voice clone once.

Run from ``backend`` after setting ``MINIMAX_API_KEY``::

    python scripts/clone_minimax_voice.py
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path


_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.core.config import settings
from app.services.media.minimax_voice_clone import clone_voice, inspect_clone_audio


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload the configured sample and create a MiniMax clone voice")
    parser.add_argument("--source", default=settings.MINIMAX_VOICE_CLONE_SOURCE)
    parser.add_argument("--voice-id", default=settings.MINIMAX_TTS_VOICE_ID)
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if not args.source:
        raise SystemExit("请设置 MINIMAX_VOICE_CLONE_SOURCE 或传入 --source")
    info = inspect_clone_audio(args.source)
    duration = f"，{info.duration_seconds:.1f} 秒" if info.duration_seconds is not None else ""
    print(f"准备克隆：{info.path.name}（{info.size_bytes / 1024 / 1024:.1f} MB{duration}）")
    voice_id = await clone_voice(info.path, args.voice_id)
    print(f"克隆完成。请确认 MINIMAX_TTS_ENABLED=true 且 MINIMAX_TTS_VOICE_ID={voice_id}")


if __name__ == "__main__":
    asyncio.run(main())
