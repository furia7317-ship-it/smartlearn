from __future__ import annotations

from app.routers import voice
from app.services.iflytek.iat import IatTranscriptAssembler


def _result(sequence: int, text: str, **extra):
    return {
        "sn": sequence,
        "ws": [{"cw": [{"w": text}]}],
        **extra,
    }


def test_iat_dynamic_correction_replaces_old_segments_without_duplication():
    assembler = IatTranscriptAssembler()
    assert assembler.apply(_result(0, "我想")) == "我想"
    assert assembler.apply(_result(1, "学习树")) == "我想学习树"
    assert assembler.apply(_result(2, "学习数据结构", pgs="rpl", rg=[1, 1])) == "我想学习数据结构"


def test_voice_tts_prefers_minimax_clone(monkeypatch):
    monkeypatch.setattr(voice.mimo_tts, "is_configured", lambda: True)
    monkeypatch.setattr(voice.minimax_tts, "is_configured", lambda: True)
    monkeypatch.setattr(voice.iflytek_tts, "is_configured", lambda: True)
    assert voice.preferred_tts_provider() == "minimax"

    monkeypatch.setattr(voice.minimax_tts, "is_configured", lambda: False)
    assert voice.preferred_tts_provider() == "mimo"

    monkeypatch.setattr(voice.mimo_tts, "is_configured", lambda: False)
    assert voice.preferred_tts_provider() == "iflytek"

    monkeypatch.setattr(voice.iflytek_tts, "is_configured", lambda: False)
    assert voice.preferred_tts_provider() is None


def test_voice_asr_prefers_mimo(monkeypatch):
    monkeypatch.setattr(voice.mimo_asr, "is_configured", lambda: True)
    monkeypatch.setattr(voice.iat, "is_configured", lambda: True)
    assert voice.preferred_asr_provider() == "mimo"

    monkeypatch.setattr(voice.mimo_asr, "is_configured", lambda: False)
    assert voice.preferred_asr_provider() == "iflytek"

    monkeypatch.setattr(voice.iat, "is_configured", lambda: False)
    assert voice.preferred_asr_provider() is None
