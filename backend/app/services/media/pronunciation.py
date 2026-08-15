"""Pronunciation normalization for generated narration.

The caption text always remains untouched. Only the text sent to TTS is
rewritten, so a pronunciation correction can never leak into the lesson copy.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from app.core.config import settings


@dataclass(frozen=True)
class PronunciationHint:
    term: str
    spoken: str
    source: str = "script"


_COMMON_TECH_PRONUNCIATIONS: tuple[tuple[str, str], ...] = (
    ("HTTPS", "H T T P S"),
    ("HTTP", "H T T P"),
    ("HTML", "H T M L"),
    ("JSON", "J S O N"),
    ("SQL", "S Q L"),
    ("API", "A P I"),
    ("CPU", "C P U"),
    ("GPU", "G P U"),
    ("CSS", "C S S"),
    ("AI", "A I"),
    ("C++", "C 加加"),
)


def _iter_hints(value: Any, *, source: str) -> Iterable[PronunciationHint]:
    if isinstance(value, dict):
        for term, spoken in value.items():
            yield PronunciationHint(str(term), str(spoken), source)
        return
    if not isinstance(value, list):
        return
    for item in value:
        if not isinstance(item, dict):
            continue
        term = item.get("term") or item.get("word") or item.get("text")
        spoken = (
            item.get("spoken")
            or item.get("pronunciation")
            or item.get("replacement")
            or item.get("tone")
        )
        if term is not None and spoken is not None:
            yield PronunciationHint(str(term), str(spoken), source)


def _load_persistent_hints() -> list[PronunciationHint]:
    configured = settings.MEDIA_PRONUNCIATION_LEXICON_PATH.strip()
    if not configured:
        return []
    path = Path(configured).expanduser()
    if not path.is_file():
        return []
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return []
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        hints: list[PronunciationHint] = []
        patterns = (
            re.compile(r"^[\s\-]*[“\"]?(.+?)[”\"]?\s*读作\s*[“\"]?(.+?)[”\"]?[。；;]?\s*$"),
            re.compile(r"^[\s\-]*[“\"]?(.+?)[”\"]?\s*(?:->|=>|:|：)\s*[“\"]?(.+?)[”\"]?\s*$"),
        )
        for line in content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = next((pattern.match(stripped) for pattern in patterns if pattern.match(stripped)), None)
            if match:
                hints.append(PronunciationHint(match.group(1), match.group(2), "persistent"))
        return hints
    return list(_iter_hints(payload, source="persistent"))


def collect_pronunciation_hints(
    script: dict[str, Any],
    narration_text: str,
) -> list[PronunciationHint]:
    """Collect rule, persistent, and AI-authored hints with validation.

    Later sources override earlier sources. AI-generated hints are accepted only
    when the original term occurs in the narration; this is the deterministic
    review boundary for model output.
    """

    candidates = [
        PronunciationHint(term, spoken, "rule")
        for term, spoken in _COMMON_TECH_PRONUNCIATIONS
        if term in narration_text
    ]
    candidates.extend(_load_persistent_hints())
    candidates.extend(_iter_hints(script.get("pronunciation_hints"), source="script"))
    render_config = script.get("render_config")
    if isinstance(render_config, dict):
        candidates.extend(
            _iter_hints(render_config.get("pronunciation_hints"), source="render_config")
        )

    validated: dict[str, PronunciationHint] = {}
    for hint in candidates:
        term = re.sub(r"\s+", " ", hint.term).strip()
        spoken = re.sub(r"\s+", " ", hint.spoken).strip()
        if not term or not spoken or term == spoken:
            continue
        if len(term) > 64 or len(spoken) > 96 or term not in narration_text:
            continue
        if any(char in spoken for char in "\r\n\t"):
            continue
        validated[term] = PronunciationHint(term, spoken, hint.source)
    return sorted(validated.values(), key=lambda item: len(item.term), reverse=True)


def apply_pronunciation_hints(text: str, hints: list[PronunciationHint]) -> str:
    """Return the TTS-only spoken form of text."""

    spoken_text = text
    for hint in hints:
        if re.fullmatch(r"[A-Za-z0-9+#.\-]+", hint.term):
            pattern = rf"(?<![A-Za-z0-9]){re.escape(hint.term)}(?![A-Za-z0-9])"
            spoken_text = re.sub(pattern, hint.spoken, spoken_text)
        else:
            spoken_text = spoken_text.replace(hint.term, hint.spoken)
    return spoken_text


def minimax_tone_entries(hints: list[PronunciationHint]) -> list[str]:
    """Convert validated hints to MiniMax pronunciation-dictionary entries."""

    return [f"{hint.term}/{hint.spoken}" for hint in hints[:20]]
