import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { createDesktopSoundPlayer, DESKTOP_SOUND_ASSETS, getDesktopSoundEnabled, parseDesktopSoundPreference, parseDesktopSoundVolume, setDesktopSoundEnabled } from "../lib/desktop-sounds.ts";

function fixture({ resumeFails = false, volume = 70, loadBuffer } = {}) {
  let enabled = true;
  let clock = 0;
  let created = 0;
  const voices = [];
  const gains = [];
  const context = {
    state: "suspended", currentTime: 0, destination: {},
    async resume() {
      if (resumeFails) throw new Error("Audio unavailable");
      this.state = "running";
    },
    createGain() {
      return { gain: { setValueAtTime(value) { gains.push(value); } }, connect() {}, disconnect() {} };
    },
    createBufferSource() {
      const source = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() {},
        stop(at) { if (at === undefined) this.stoppedImmediately = true; } };
      voices.push(source);
      return source;
    },
  };
  const player = createDesktopSoundPlayer({
    createContext() { created += 1; return context; },
    isEnabled: () => enabled,
    now: () => clock,
    volume: () => volume,
    loadBuffer: loadBuffer ?? (async (_, url) => ({ duration: .25, url })),
  });
  return { player, voices, gains, context, created: () => created,
    mute: () => { enabled = false; }, advance: (ms) => { clock += ms; } };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("stored mute is respected and missing preferences keep sounds enabled", () => {
  assert.equal(parseDesktopSoundPreference("off"), false);
  assert.equal(parseDesktopSoundPreference("on"), true);
  assert.equal(parseDesktopSoundPreference(null), true);
});

test("mute still works when quota blocks preference writes", (t) => {
  const original = globalThis.window;
  globalThis.window = {
    localStorage: { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } },
    dispatchEvent() {},
  };
  t.after(() => {
    setDesktopSoundEnabled(true);
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  });
  setDesktopSoundEnabled(false);
  assert.equal(getDesktopSoundEnabled(), false);
});

test("audio remains locked until a gesture; muted gestures do not create it", async () => {
  const run = fixture();
  await run.player.play("success");
  assert.equal(run.created(), 0);
  run.mute();
  await run.player.play("press", true);
  assert.equal(run.created(), 0);
});

test("rapid clicks are throttled; real results replace clicks and stay protected", async () => {
  const run = fixture();
  await run.player.play("navigate", true);
  await run.player.play("press", true);
  await run.player.play("success");
  assert.equal(run.voices.length, 2);
  assert.ok(run.voices[0].stoppedImmediately);
  assert.match(run.voices[1].buffer.url, /success-guitar/);
  run.advance(150);
  await run.player.play("success");
  await run.player.play("press", true);
  assert.equal(run.voices.length, 2);
  run.player.stop();
  assert.ok(run.voices.every((voice) => voice.stoppedImmediately));
});

test("book audio unlocks silently on click and plays when the cover starts moving", async () => {
  const run = fixture();
  await run.player.prepare("page-open");
  assert.equal(run.created(), 1);
  assert.equal(run.context.state, "running");
  assert.equal(run.voices.length, 0);
  run.advance(180);
  await run.player.play("page-open");
  assert.equal(run.voices.length, 1);
  assert.match(run.voices[0].buffer.url, /paper-open/);
});

test("book preparation respects mute and unavailable audio", async () => {
  const run = fixture();
  run.mute();
  await run.player.prepare("page-close");
  assert.equal(run.created(), 0);
  const unavailable = fixture({ resumeFails: true });
  await assert.doesNotReject(unavailable.player.prepare("page-open"));
  assert.equal(unavailable.voices.length, 0);
});

test("async feedback cannot resume a browser-suspended context", async () => {
  const run = fixture();
  await run.player.play("press", true);
  run.advance(300);
  run.context.state = "suspended";
  await run.player.play("success");
  assert.equal(run.context.state, "suspended");
  assert.equal(run.voices.length, 1);
});

test("volume preferences clamp invalid storage and scale samples", async () => {
  assert.equal(parseDesktopSoundVolume(null), 70);
  assert.equal(parseDesktopSoundVolume("invalid"), 70);
  assert.equal(parseDesktopSoundVolume("140"), 100);
  assert.equal(parseDesktopSoundVolume("-5"), 0);
  const quiet = fixture({ volume: 25 });
  const full = fixture({ volume: 100 });
  await quiet.player.play("select", true);
  await full.player.play("select", true);
  assert.equal(full.gains[0], quiet.gains[0] * 4);
  const silent = fixture({ volume: 0 });
  await silent.player.play("navigate", true);
  assert.equal(silent.created(), 0);
});

test("new deliberate actions replace previous samples without stacking", async () => {
  const run = fixture();
  await run.player.play("expand", true);
  run.advance(120);
  await run.player.play("collapse", true);
  assert.ok(run.voices[0].stoppedImmediately);
  assert.equal(run.voices.length, 2);
});

test("unavailable audio and missing assets never reject UI actions", async () => {
  const run = fixture({ resumeFails: true });
  await assert.doesNotReject(run.player.play("navigate", true));
  assert.equal(run.voices.length, 0);
  const missing = fixture({ loadBuffer: async () => { throw new Error("404"); } });
  await assert.doesNotReject(missing.player.play("press", true));
  assert.equal(missing.voices.length, 0);
});

test("muting or stopping while a sample loads cancels its eventual playback", async () => {
  for (const cancel of [(run) => run.mute(), (run) => run.player.stop()]) {
    const pending = deferred();
    const run = fixture({ loadBuffer: () => pending.promise });
    const playback = run.player.play("press", true);
    await Promise.resolve();
    cancel(run);
    pending.resolve({ duration: .2 });
    await playback;
    assert.equal(run.voices.length, 0);
  }
});

test("a stale load cannot overtake a more recent action", async () => {
  const first = deferred();
  const run = fixture({ loadBuffer: (_, url) => url.includes("paper-slide") ? first.promise : Promise.resolve({ duration: .2, url }) });
  const old = run.player.play("navigate", true);
  await Promise.resolve();
  run.advance(150);
  await run.player.play("select", true);
  first.resolve({ duration: .2 });
  await old;
  assert.equal(run.voices.length, 1);
  assert.match(run.voices[0].buffer.url, /muted-tap/);
});

test("slow loads do not play delayed navigation clicks", async () => {
  const pending = deferred();
  const run = fixture({ loadBuffer: () => pending.promise });
  const playback = run.player.play("navigate", true);
  await Promise.resolve();
  run.advance(700);
  pending.resolve({ duration: .2 });
  await playback;
  assert.equal(run.voices.length, 0);
});

test("an outcome load cannot indefinitely block later interaction feedback", async () => {
  const pending = deferred();
  const run = fixture({ loadBuffer: (_, url) => url.includes("success-guitar") ? pending.promise : Promise.resolve({ duration: .1, url }) });
  await run.player.play("press", true);
  const result = run.player.play("success");
  await Promise.resolve();
  run.advance(600);
  await run.player.play("navigate", true);
  pending.resolve({ duration: .2 });
  await result;
  assert.equal(run.voices.length, 2);
  assert.match(run.voices[1].buffer.url, /paper-slide/);
});

test("all mapped sounds are local, distinct where needed, valid and bounded PCM assets", async () => {
  const base = new URL("../public/audio/desk-v2/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", base), "utf8"));
  let total = 0;
  for (const [kind, cue] of Object.entries(DESKTOP_SOUND_ASSETS)) {
    const entry = manifest.find((item) => item.file === cue.file);
    assert.ok(entry, kind);
    const bytes = await readFile(new URL(cue.file, base));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
    assert.equal(bytes.readUInt32LE(24), 32000);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    assert.ok(entry.durationMs / (cue.rate ?? 1) <= 750);
    assert.ok(entry.peak * cue.gain <= .13, "bounded peak even at full user volume");
    total += bytes.length;
  }
  assert.ok(total < 160000);
  assert.notEqual(DESKTOP_SOUND_ASSETS["page-open"].file, DESKTOP_SOUND_ASSETS["page-close"].file);
  assert.notEqual(DESKTOP_SOUND_ASSETS.success.file, DESKTOP_SOUND_ASSETS.error.file);
});
