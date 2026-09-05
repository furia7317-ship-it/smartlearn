from __future__ import annotations

import base64
import wave
from io import BytesIO

from app.services.media import mimo_asr


def test_pcm_is_wrapped_as_mono_16k_wav():
    wav_audio = mimo_asr.pcm16_to_wav(b"\x01\x00\x02\x00")
    with wave.open(BytesIO(wav_audio), "rb") as stream:
        assert stream.getnchannels() == 1
        assert stream.getsampwidth() == 2
        assert stream.getframerate() == 16_000
        assert stream.readframes(2) == b"\x01\x00\x02\x00"


def test_request_payload_uses_official_input_audio_shape(monkeypatch):
    monkeypatch.setattr(mimo_asr.settings, "MIMO_ASR_MODEL", "mimo-v2.5-asr")
    payload = mimo_asr.build_request_payload(b"RIFFdemo", language="zh")
    content = payload["messages"][0]["content"][0]
    assert payload["model"] == "mimo-v2.5-asr"
    assert payload["asr_options"] == {"language": "zh"}
    assert content["type"] == "input_audio"
    encoded = content["input_audio"]["data"].split(",", 1)[1]
    assert base64.b64decode(encoded) == b"RIFFdemo"


def test_extract_transcript_strips_text():
    assert mimo_asr.extract_transcript({"choices": [{"message": {"content": "  你好。 "}}]}) == "你好。"
