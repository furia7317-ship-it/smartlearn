export type DesktopSound = "press" | "navigate" | "select" | "expand" | "collapse" | "page-open" | "page-close" | "search" | "run" | "complete" | "success" | "error";

const PREFERENCE_KEY = "sl_desktop_sound_v1";
const PREFERENCE_EVENT = "sl:desktop-sound-preference";
const VOLUME_KEY = "sl_desktop_sound_volume_v1";
let memoryEnabled = true;
let memoryOverride: boolean | null = null;
let memoryVolume = 70;
let volumeOverride: number | null = null;

export function parseDesktopSoundVolume(value: string | null): number {
  if (value === null || value.trim() === "") return 70;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 70;
}

export function getDesktopSoundVolume(): number {
  if (typeof window === "undefined") return 70;
  if (volumeOverride !== null) return volumeOverride;
  try { memoryVolume = parseDesktopSoundVolume(window.localStorage.getItem(VOLUME_KEY)); } catch { /* keep session volume */ }
  return memoryVolume;
}

export function setDesktopSoundVolume(volume: number): void {
  memoryVolume = parseDesktopSoundVolume(String(volume));
  volumeOverride = memoryVolume;
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(VOLUME_KEY, String(memoryVolume)); volumeOverride = null; } catch { /* keep session volume */ }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function parseDesktopSoundPreference(value: string | null): boolean {
  return value !== "off";
}

export function getDesktopSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  if (memoryOverride !== null) return memoryOverride;
  try {
    memoryEnabled = parseDesktopSoundPreference(window.localStorage.getItem(PREFERENCE_KEY));
  } catch {
    // A blocked storage area must still allow an in-memory mute preference.
  }
  return memoryEnabled;
}

export function subscribeDesktopSoundPreference(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFERENCE_KEY || event.key === VOLUME_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PREFERENCE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PREFERENCE_EVENT, listener);
  };
}

type SoundAsset = { file: string; gain: number; rate?: number };

// Short sampled cues: tactile UI actions, paper movement, and quiet outcome feedback.
// Source revisions and asset processing are documented in public/audio/desk-v2/.
export const DESKTOP_SOUND_ASSETS: Record<DesktopSound, SoundAsset> = {
  press: { file: "wood-tap.wav", gain: .18 },
  navigate: { file: "paper-slide.wav", gain: .14 },
  select: { file: "muted-tap.wav", gain: .4 },
  expand: { file: "warm-tap.wav", gain: .28 },
  collapse: { file: "mellow-tap.wav", gain: .14 },
  "page-open": { file: "paper-open.wav", gain: .16 },
  "page-close": { file: "paper-close.wav", gain: .18 },
  search: { file: "warm-tap.wav", gain: .24 },
  run: { file: "start-timber.wav", gain: .18 },
  complete: { file: "done-piano.wav", gain: .22 },
  success: { file: "success-guitar.wav", gain: .26 },
  error: { file: "soft-error.wav", gain: .24, rate: .9 },
};

export function isDesktopSound(value: string | undefined): value is DesktopSound {
  return Boolean(value && Object.hasOwn(DESKTOP_SOUND_ASSETS, value));
}

const assetPath = (file: string) => `/audio/desk-v2/${file}`;
const downloads = new Map<string, Promise<ArrayBuffer>>();
const decoded = new WeakMap<AudioContext, Map<string, Promise<AudioBuffer>>>();

function fetchAsset(url: string): Promise<ArrayBuffer> {
  let pending = downloads.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Sound asset unavailable: ${response.status}`);
      return response.arrayBuffer();
    }).catch((error) => { downloads.delete(url); throw error; });
    downloads.set(url, pending);
  }
  return pending;
}

/** Cache local files silently; only a deliberate interaction may create an audio context. */
export function preloadDesktopSounds(): void {
  if (!getDesktopSoundEnabled()) return;
  for (const { file } of Object.values(DESKTOP_SOUND_ASSETS)) void fetchAsset(assetPath(file)).catch(() => {});
}

function loadSample(context: AudioContext, url: string): Promise<AudioBuffer> {
  let cache = decoded.get(context);
  if (!cache) { cache = new Map(); decoded.set(context, cache); }
  let pending = cache.get(url);
  if (!pending) {
    pending = fetchAsset(url).then((bytes) => context.decodeAudioData(bytes.slice(0)))
      .catch((error) => { cache.delete(url); throw error; });
    cache.set(url, pending);
  }
  return pending;
}

type SoundPlayerOptions = {
  createContext: () => AudioContext | null;
  isEnabled: () => boolean;
  now: () => number;
  volume?: () => number;
  loadBuffer?: (context: AudioContext, url: string) => Promise<AudioBuffer>;
};

/** Loading, muting and rapid navigation cannot leave stale sounds queued up. */
export function createDesktopSoundPlayer(options: SoundPlayerOptions) {
  let context: AudioContext | null = null;
  let busyUntil = -Infinity;
  let activeSound: DesktopSound | null = null;
  let pendingOutcome = false;
  let pendingUntil = -Infinity;
  let lastGesture = -Infinity;
  let generation = 0;
  const voices = new Set<AudioBufferSourceNode>();
  const stopVoices = () => {
    for (const voice of voices) {
      try { voice.stop(); } catch { /* Already ended. */ }
    }
    voices.clear();
    activeSound = null;
    busyUntil = -Infinity;
  };
  const stop = () => { generation += 1; pendingOutcome = false; stopVoices(); };
  const isOutcome = (sound: DesktopSound | null) => sound === "success" || sound === "error" || sound === "complete";

  const prepare = async (sound: DesktopSound): Promise<void> => {
    if (!options.isEnabled() || (options.volume?.() ?? 70) <= 0) return;
    try {
      context ??= options.createContext();
      if (!context || context.state === "closed") return;
      if (context.state !== "running") await context.resume();
      if (options.isEnabled() && context.state === "running") {
        await (options.loadBuffer ?? loadSample)(context, assetPath(DESKTOP_SOUND_ASSETS[sound].file));
      }
    } catch { /* Preparation must not delay the visual interaction. */ }
  };

  const play = async (sound: DesktopSound, fromUserGesture = false): Promise<void> => {
    const requestedAt = options.now();
    if (!options.isEnabled() || (options.volume?.() ?? 70) <= 0) return;
    if (fromUserGesture && requestedAt - lastGesture < 100) return;
    if ((pendingOutcome && requestedAt < pendingUntil) || (requestedAt < busyUntil && isOutcome(activeSound))) return;
    if (!context && !fromUserGesture) return;
    if (context && context.state !== "running" && !fromUserGesture) return;
    if (fromUserGesture) lastGesture = requestedAt;
    const ticket = ++generation;
    const outcome = isOutcome(sound);
    pendingOutcome = outcome;
    pendingUntil = requestedAt + 450;
    try {
      context ??= options.createContext();
      if (!context || context.state === "closed") return;
      if (context.state !== "running") await context.resume();
      if (ticket !== generation || !options.isEnabled() || context.state !== "running") return;
      const cue = DESKTOP_SOUND_ASSETS[sound];
      const buffer = await (options.loadBuffer ?? loadSample)(context, assetPath(cue.file));
      if (ticket !== generation || !options.isEnabled() || context.state !== "running") return;
      // Never play a click long after its visual action has already finished.
      if (options.now() - requestedAt > (outcome ? 1500 : 300)) return;
      const volume = Math.min(1, Math.max(0, (options.volume?.() ?? 70) / 100));
      if (!volume) return;
      stopVoices();
      const source = context.createBufferSource();
      const envelope = context.createGain();
      const rate = cue.rate ?? 1;
      const duration = buffer.duration / rate;
      source.buffer = buffer;
      source.playbackRate.value = rate;
      envelope.gain.setValueAtTime(cue.gain * volume, context.currentTime);
      source.connect(envelope);
      envelope.connect(context.destination);
      voices.add(source);
      activeSound = sound;
      busyUntil = options.now() + Math.max(duration * 1000, outcome ? 450 : 100);
      source.onended = () => { voices.delete(source); source.disconnect(); envelope.disconnect(); };
      source.start();
      source.stop(context.currentTime + duration + .01);
    } catch {
      // Missing audio devices or files never block navigation; no synthetic fallback.
      if (ticket === generation) stopVoices();
    } finally {
      if (ticket === generation) pendingOutcome = false;
    }
  };
  return { play, stop, prepare };
}

const player = createDesktopSoundPlayer({
  createContext: () => {
    if (typeof window === "undefined") return null;
    const Audio = window.AudioContext ?? (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    return Audio ? new Audio() : null;
  },
  isEnabled: () => getDesktopSoundEnabled()
    && (typeof document === "undefined" || document.visibilityState !== "hidden"),
  now: () => performance.now(),
  volume: getDesktopSoundVolume,
});

export function setDesktopSoundEnabled(enabled: boolean): void {
  memoryEnabled = enabled;
  memoryOverride = enabled;
  if (!enabled) player.stop();
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off");
    memoryOverride = null;
  } catch {
    // The preference remains usable until this browser session ends.
  }
  window.dispatchEvent(new Event(PREFERENCE_EVENT));
}

export function playDesktopInteraction(sound: DesktopSound): void {
  void player.play(sound, true);
}

/** Unlock in the click handler, then play the prepared cue at the animation's actual start. */
export function prepareDesktopPageTurn(direction: "opening" | "closing"): void {
  void player.prepare(direction === "opening" ? "page-open" : "page-close");
}

export function playDesktopPageTurn(direction: "opening" | "closing"): void {
  void player.play(direction === "opening" ? "page-open" : "page-close");
}

/** Call only after a real operation succeeds, never on submit or request start. */
export function playDesktopSuccess(): void {
  void player.play("success");
}

export function playDesktopResult(sound: "complete" | "success" | "error"): void {
  void player.play(sound);
}

export function stopDesktopSounds(): void {
  player.stop();
}
