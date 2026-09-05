"""Bound local CPU/disk work without occupying the API event loop."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from weakref import WeakKeyDictionary

_workers = ThreadPoolExecutor(max_workers=4, thread_name_prefix="local-retrieval")
_limits: WeakKeyDictionary = WeakKeyDictionary()


async def run_retrieval(function, /, *args, **kwargs):
    loop = asyncio.get_running_loop()
    limit = _limits.setdefault(loop, asyncio.Semaphore(4))
    async with limit:
        future = loop.run_in_executor(_workers, partial(function, *args, **kwargs))
        try:
            return await asyncio.shield(future)
        except asyncio.CancelledError:
            # Cancellation cannot kill a Python thread. Keep its admission slot
            # until it exits, so disconnects cannot create an unbounded backlog.
            await asyncio.gather(future, return_exceptions=True)
            raise
