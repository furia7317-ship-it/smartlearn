import assert from "node:assert/strict";
import test from "node:test";
import { playCloudSpeech, splitCloudSpeech, requestMiniMaxSpeech, playSpeechBlob } from "../lib/cloud-speech.ts";

test("answer splitting preserves all text and respects the API limit", () => {
  const text = "先用栈记录顺序。".repeat(90);
  const parts = splitCloudSpeech(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 180));
  assert.throws(() => splitCloudSpeech(text, 0));
});

test("interrupting synthesis discards a late audio response", async () => {
  const controller = new AbortController();
  let deliver;
  let played = 0;
  const run = playCloudSpeech("栈遵循后进先出。", controller.signal, {
    request: () => new Promise((resolve) => { deliver = resolve; }),
    play: async () => { played++; },
  });
  controller.abort();
  deliver(new Blob(["audio"]));
  await assert.rejects(run, { name: "AbortError" });
  assert.equal(played, 0);
});

test("synthesis failure is surfaced without any substitute playback", async () => {
  let played = 0;
  await assert.rejects(playCloudSpeech("提示", new AbortController().signal, {
    request: async () => { throw new Error("invalid api key"); },
    play: async () => { played++; },
  }), /invalid api key/);
  assert.equal(played, 0);
});

test("speech requests pin MiniMax and preserve the provider error", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ detail: "invalid api key" }), { status: 502 });
  });
  await assert.rejects(requestMiniMaxSpeech("http://localhost:8000", "栈", new AbortController().signal), /MiniMax.*invalid api key/);
  assert.deepEqual(body, { text: "栈", provider: "minimax" });
});

test("interrupting playback pauses audio and releases its URL", async (t) => {
  const original = globalThis.Audio;
  let paused = 0;
  let revoked = 0;
  globalThis.Audio = class {
    play() { return Promise.resolve(); }
    pause() { paused++; }
    removeAttribute() {}
  };
  t.after(() => { globalThis.Audio = original; });
  t.mock.method(URL, "createObjectURL", () => "blob:test");
  t.mock.method(URL, "revokeObjectURL", () => { revoked++; });
  const controller = new AbortController();
  const playback = playSpeechBlob(new Blob(["audio"]), controller.signal);
  controller.abort();
  await assert.rejects(playback, { name: "AbortError" });
  assert.equal(paused, 1);
  assert.equal(revoked, 1);
});
