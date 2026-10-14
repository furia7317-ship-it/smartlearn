"""Prepare the small set of UI cues used by SmartLearn (numpy + imageio-ffmpeg)."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import wave

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/audio/desk-v2"
CACHE = Path(os.environ.get("TEMP", "/tmp")) / "smartlearn-sound-research"
OCTAVE = "198251e306a52e7570905e295d18e001899d6bf0"
SOUNDCN = "7cbfbb3f56e8548b81fb26410bdcea657447d087"
SOURCES = {
    "wood-tap": ("octave", "taps/tap-wooden.aif"),
    "warm-tap": ("octave", "taps/tap-warm.aif"),
    "muted-tap": ("octave", "taps/tap-muted.aif"),
    "mellow-tap": ("octave", "taps/tap-mellow.aif"),
    "paper-open": ("zhixue", "turn.wav"),
    "paper-close": ("zhixue", "turn.wav"),
    "paper-slide": ("soundcn", "card-slide-1.ogg"),
    "start-timber": ("octave", "beeps/beep-timber.aif"),
    "done-piano": ("octave", "beeps/beep-piano.aif"),
    "success-guitar": ("octave", "beeps/beep-warmguitar.aif"),
    "soft-error": ("octave", "beeps/beep-rejected.aif"),
}
OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)
manifest = []
for name, (collection, path) in SOURCES.items():
    if collection == "zhixue":
        reference = Path(os.environ.get("SMARTLEARN_BOOK_AUDIO", r"D:\智学云枢\ZXYS\src\assets\TcmBook\turn.wav"))
        original = reference
        url = reference.as_uri()
    else:
        url = (f"https://raw.githubusercontent.com/scopegate/octave/{OCTAVE}/Octave-Sounds/{path}"
               if collection == "octave" else
               f"https://raw.githubusercontent.com/kapishdima/soundcn/{SOUNDCN}/assets/kenney_casino-audio/{path}")
        original = CACHE / Path(path).name
        if not original.exists():
            urllib.request.urlretrieve(url, original)
    pcm = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(original),
        "-af", "lowpass=f=4000", "-ac", "1", "-ar", "32000", "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    samples = np.frombuffer(pcm, dtype="<f4").copy()
    peak = float(np.max(np.abs(samples)))
    audible = np.flatnonzero(np.abs(samples) > peak * 0.005)
    samples = samples[max(0, int(audible[0]) - 32):min(len(samples), int(audible[-1]) + 321)]
    samples = samples[:24000]  # No UI cue lasts longer than 750 ms.
    samples *= min(4.0, 0.45 / max(peak, 0.00001))
    attack = min(24, len(samples) // 8)
    release = min(320, len(samples) // 5)
    samples[:attack] *= np.linspace(0, 1, attack)
    samples[-release:] *= np.linspace(1, 0, release)
    output = OUT / f"{name}.wav"
    with wave.open(str(output), "wb") as wav:
        wav.setparams((1, 2, 32000, 0, "NONE", "not compressed"))
        wav.writeframes((samples * 32767).astype("<i2").tobytes())
    manifest.append({"file": output.name, "source": url,
        "sourceSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "durationMs": round(len(samples) / 32, 2), "peak": round(float(np.max(np.abs(samples))), 5),
        "bytes": output.stat().st_size})
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2))
