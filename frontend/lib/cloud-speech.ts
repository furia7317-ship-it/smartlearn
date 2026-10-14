/** MiniMax answer playback. Cancellation covers both synthesis and audio playback. */
export function splitCloudSpeech(text: string, limit = 180): string[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 600) throw new Error("Speech segment limit must be between 1 and 600");
  const parts: string[] = [];
  let pending = text.trim();
  while (pending) {
    let end = Math.min(pending.length, limit);
    if (end < pending.length) {
      const prefix = pending.slice(0, end);
      const boundary = Math.max(...Array.from(prefix.matchAll(/[。！？；.!?;，,]\s*/g), (m) => m.index! + m[0].length), 0);
      if (boundary >= Math.min(24, limit / 2)) end = boundary;
    }
    parts.push(pending.slice(0, end).trim());
    pending = pending.slice(end).trim();
  }
  return parts;
}

export async function requestMiniMaxSpeech(base: string, text: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`${base}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, provider: "minimax" }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof body?.detail === "string" ? body.detail : `HTTP ${response.status}`;
    throw new Error(`MiniMax 语音合成失败：${detail}`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("MiniMax 未返回可播放的音频");
  return blob;
}

export function playSpeechBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      signal.removeEventListener("abort", abort);
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason || new DOMException("Playback interrupted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error("MiniMax 音频播放失败，请重试"));
    void audio.play().catch(finish);
  });
}

type SpeechDependencies = {
  request: (text: string, signal: AbortSignal) => Promise<Blob>;
  play: (blob: Blob, signal: AbortSignal) => Promise<void>;
  onPhase?: (phase: "loading" | "playing") => void;
};

export async function playCloudSpeech(text: string, signal: AbortSignal, deps: SpeechDependencies): Promise<void> {
  signal.throwIfAborted();
  const segments = splitCloudSpeech(text);
  if (!segments.length) return;
  // Settle prefetch errors immediately so an interruption never leaves an unhandled rejection.
  const request = (part: string) => deps.request(part, signal).then(
    (blob) => ({ blob, error: undefined }),
    (error: unknown) => ({ blob: undefined, error }),
  );
  deps.onPhase?.("loading");
  let pending = request(segments[0]);
  for (let index = 0; index < segments.length; index++) {
    const result = await pending;
    signal.throwIfAborted();
    if (!result.blob) throw result.error;
    const next = index + 1 < segments.length ? request(segments[index + 1]) : null;
    deps.onPhase?.("playing");
    await deps.play(result.blob, signal);
    signal.throwIfAborted();
    if (next) pending = next;
  }
}
