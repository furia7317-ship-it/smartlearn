"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { MicVAD } from "@ricky0123/vad-web";

import { API_BASE, resolveAgentResourceAction } from "@/lib/api";
import {
  fallbackResourceAction,
  isResourceOpenIntent,
  readyResourceCandidates,
} from "@/lib/agent-action";
import type { ChatMessage, ResourceItem } from "@/lib/types";
import { parseVoiceCommand, voiceDestinationPath } from "@/lib/voice-command";
import { adaptiveEndpointDelayMs, extractSpeakableChunks } from "@/lib/voice-turn";

export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "finalizing"
  | "thinking"
  | "teacher_speaking"
  | "error";

interface VoiceOptions {
  messages: ChatMessage[];
  running: boolean;
  enabled: boolean;
  onSend: (text: string) => void;
  onStop?: () => void | Promise<void>;
  onClose?: () => void;
  onNewConversation?: () => void;
  resources?: ResourceItem[];
  onOpenResource?: (resourceId: string) => void | Promise<void>;
}

interface VoiceStatusResponse {
  asr_ready: boolean;
  asr_provider?: string | null;
  tts_ready: boolean;
  tts_provider: string | null;
}

interface PreparedSpeech {
  generation: number;
  text: string;
  audio: Promise<Blob | null>;
}

interface VoiceActionResponse {
  action: "open_resource" | "none";
  resource_id?: string;
  label?: string;
  reply?: string;
}

const FRAME_RING_SIZE = 12;

function pcm16Buffer(frame: Float32Array): ArrayBuffer {
  const output = new Int16Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, frame[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function voiceSocketUrl(): string {
  return `${API_BASE.replace(/^http/i, "ws")}/api/voice/asr`;
}

function largestScrollableElement(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-voice-scroll], .thin-scroll, main, section, div"));
  return candidates
    .filter((node) => {
      if (node.scrollHeight - node.clientHeight < 80 || node.clientHeight < 120) return false;
      const overflow = getComputedStyle(node).overflowY;
      return overflow === "auto" || overflow === "scroll";
    })
    .sort((left, right) => right.clientHeight * right.clientWidth - left.clientHeight * left.clientWidth)[0] ?? null;
}

function splitForSpeech(text: string): string[] {
  if (text.length <= 180) return [text];
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > 180) {
    const window = remaining.slice(0, 180);
    const breakAt = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(" "));
    const size = breakAt >= 60 ? breakAt + 1 : 180;
    pieces.push(remaining.slice(0, size).trim());
    remaining = remaining.slice(size).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!check() && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export function useRealtimeVoice({
  messages,
  running,
  enabled,
  onSend,
  onStop,
  onClose,
  onNewConversation,
  resources = [],
  onOpenResource,
}: VoiceOptions) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [ttsProvider, setTtsProvider] = useState<string | null>(null);

  const activeRef = useRef(false);
  const runningRef = useRef(running);
  const vadRef = useRef<MicVAD | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const utteranceRef = useRef(false);
  const pendingFramesRef = useRef<ArrayBuffer[]>([]);
  const ringFramesRef = useRef<ArrayBuffer[]>([]);
  const transcriptRef = useRef("");
  const commitInFlightRef = useRef(false);
  const pendingCommitRef = useRef(false);
  const deferredSpeechRef = useRef(false);
  const deferredAudioRef = useRef<ArrayBuffer | null>(null);
  const commitTimerRef = useRef<number | undefined>(undefined);
  const heartbeatTimerRef = useRef<number | undefined>(undefined);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const vadHealthTimerRef = useRef<number | undefined>(undefined);
  const vadRearmingRef = useRef(false);
  const lastVadFrameAtRef = useRef(0);
  const connectSocketRef = useRef<(() => Promise<WebSocket>) | null>(null);
  const speechSecondsRef = useRef(0);
  const speechGenerationRef = useRef(0);
  const speechQueueRef = useRef<PreparedSpeech[]>([]);
  const speechDrainingRef = useRef(false);
  const speechRequestTailRef = useRef<Promise<void>>(Promise.resolve());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioControllersRef = useRef<Set<AbortController>>(new Set());
  const spokenMessageRef = useRef({ id: "", offset: 0 });
  const callbacksRef = useRef({ onSend, onStop, onClose, onNewConversation, resources, onOpenResource });

  useEffect(() => {
    runningRef.current = running;
    callbacksRef.current = { onSend, onStop, onClose, onNewConversation, resources, onOpenResource };
  }, [onClose, onNewConversation, onOpenResource, onSend, onStop, resources, running]);

  const interruptTeacher = useCallback(() => {
    speechGenerationRef.current += 1;
    speechQueueRef.current = [];
    for (const controller of audioControllersRef.current) controller.abort();
    audioControllersRef.current.clear();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    speechDrainingRef.current = false;
  }, []);

  const rearmVad = useCallback(async () => {
    const vad = vadRef.current;
    if (
      !vad
      || !activeRef.current
      || vadRearmingRef.current
      || utteranceRef.current
      || commitInFlightRef.current
      || pendingCommitRef.current
      || deferredSpeechRef.current
      || speechDrainingRef.current
    ) return;

    vadRearmingRef.current = true;
    try {
      // MicVAD can remain logically started while its AudioWorklet stops
      // delivering frames after output-device playback. Reacquiring the input
      // stream after every completed turn makes the displayed listening state
      // match the real microphone state.
      await vad.pause();
      if (!activeRef.current || vadRef.current !== vad) return;
      await withTimeout(
        vad.start(),
        8_000,
        "麦克风恢复超时，请检查音频输入设备后重试",
      );
      lastVadFrameAtRef.current = Date.now();
    } catch (caught) {
      if (!activeRef.current) return;
      setError(caught instanceof Error ? caught.message : "麦克风恢复失败，请重新开始语音通话");
      setPhase("error");
    } finally {
      vadRearmingRef.current = false;
    }
  }, []);

  const playBrowserSpeech = useCallback((text: string, generation: number) => new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window) || generation !== speechGenerationRef.current) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1.05;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  }), []);

  const requestSpeech = useCallback((text: string, generation: number): Promise<Blob | null> => {
    const request = speechRequestTailRef.current.then(async () => {
      if (generation !== speechGenerationRef.current) return null;
      const controller = new AbortController();
      audioControllersRef.current.add(controller);
      try {
        const response = await fetch(`${API_BASE}/api/voice/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        if (!response.ok || generation !== speechGenerationRef.current) return null;
        return await response.blob();
      } catch {
        return null;
      } finally {
        audioControllersRef.current.delete(controller);
      }
    });
    speechRequestTailRef.current = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }, []);

  const drainSpeechQueue = useCallback(async () => {
    if (speechDrainingRef.current) return;
    speechDrainingRef.current = true;
    try {
      while (activeRef.current && speechQueueRef.current.length > 0) {
        const item = speechQueueRef.current.shift();
        if (!item || item.generation !== speechGenerationRef.current) continue;
        setPhase("teacher_speaking");
        const blob = await item.audio;
        if (item.generation !== speechGenerationRef.current || !activeRef.current) continue;
        if (!blob) {
          await playBrowserSpeech(item.text, item.generation);
          continue;
        }
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
        audioRef.current = null;
      }
    } finally {
      speechDrainingRef.current = false;
      if (activeRef.current && !utteranceRef.current) {
        setPhase(runningRef.current ? "thinking" : "listening");
        void rearmVad();
      }
    }
  }, [playBrowserSpeech, rearmVad]);

  const queueSpeech = useCallback((text: string) => {
    const generation = speechGenerationRef.current;
    for (const segment of splitForSpeech(text)) {
      speechQueueRef.current.push({
        generation,
        text: segment,
        audio: requestSpeech(segment, generation),
      });
    }
    void drainSpeechQueue();
  }, [drainSpeechQueue, requestSpeech]);

  const executeCommand = useCallback(async (text: string): Promise<boolean> => {
    const command = parseVoiceCommand(text);
    if (!command) return false;
    setFeedback(command.label);
    if (command.type === "navigate") {
      router.push(voiceDestinationPath(command.destination, pathname));
    } else if (command.type === "back") {
      router.back();
    } else if (command.type === "scroll") {
      const node = largestScrollableElement();
      if (node) {
        const top = command.direction === "top"
          ? 0
          : command.direction === "bottom"
            ? node.scrollHeight
            : node.scrollTop + (command.direction === "up" ? -0.78 : 0.78) * node.clientHeight;
        node.scrollTo({ top, behavior: "smooth" });
      }
    } else if (command.type === "close") {
      if (!callbacksRef.current.onClose) return false;
      callbacksRef.current.onClose?.();
    } else if (command.type === "new_conversation") {
      if (!callbacksRef.current.onNewConversation) return false;
      callbacksRef.current.onNewConversation?.();
    } else if (command.type === "stop") {
      await callbacksRef.current.onStop?.();
    }
    return true;
  }, [pathname, router]);

  const executeAgentAction = useCallback(async (text: string): Promise<boolean> => {
    if (!isResourceOpenIntent(text)) return false;
    const { onOpenResource: openResource, resources } = callbacksRef.current;
    const candidates = readyResourceCandidates(resources);
    if (!openResource || candidates.length === 0) {
      const reply = "当前没有已审核的资料可以打开，我没有替你生成新资料。";
      setFeedback(reply);
      queueSpeech(reply);
      return true;
    }
    try {
      let action: VoiceActionResponse;
      try {
        const planned = await resolveAgentResourceAction(text, candidates);
        action = planned.action === "open_resource"
          ? planned
          : fallbackResourceAction(text, candidates);
      } catch {
        action = fallbackResourceAction(text, candidates);
      }
      if (action.action !== "open_resource" || !action.resource_id) {
        const reply = "没有找到匹配且已通过审核的资料，我没有生成新资料。";
        setFeedback(reply);
        queueSpeech(reply);
        return true;
      }
      await openResource(action.resource_id);
      setFeedback(action.label || "已打开学习资料");
      if (action.reply?.trim()) queueSpeech(action.reply.trim());
      return true;
    } catch {
      const reply = "资料暂时无法打开，请稍后再试。我没有生成新资料。";
      setFeedback(reply);
      queueSpeech(reply);
      return true;
    }
  }, [queueSpeech]);

  const handleFinalTranscript = useCallback(async (rawText: string) => {
    if (!activeRef.current) return;
    const text = rawText.trim();
    utteranceRef.current = false;
    sessionReadyRef.current = false;
    pendingFramesRef.current = [];
    transcriptRef.current = "";
    setPartialTranscript(text);
    if (!text) {
      if (!deferredSpeechRef.current) setPhase("listening");
      return;
    }
    if (await executeCommand(text)) {
      if (!utteranceRef.current && !deferredSpeechRef.current) setPhase("listening");
      return;
    }
    if (await executeAgentAction(text)) {
      if (!speechDrainingRef.current && !utteranceRef.current && !deferredSpeechRef.current) setPhase("listening");
      return;
    }
    if (runningRef.current) {
      await callbacksRef.current.onStop?.();
      await waitFor(() => !runningRef.current, 2_500);
    }
    callbacksRef.current.onSend(text);
    if (!utteranceRef.current && !deferredSpeechRef.current) setPhase("thinking");
  }, [executeAgentAction, executeCommand]);

  const submitCompleteUtterance = useCallback((audio: ArrayBuffer) => {
    const socket = socketRef.current;
    if (!activeRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    utteranceRef.current = true;
    sessionReadyRef.current = false;
    pendingFramesRef.current = [audio];
    pendingCommitRef.current = true;
    transcriptRef.current = "";
    setPartialTranscript("");
    setPhase("finalizing");
    socket.send(JSON.stringify({ type: "start", language: "zh_cn" }));
  }, []);

  const connectSocket = useCallback(async (): Promise<WebSocket> => {
    const socket = new WebSocket(voiceSocketUrl());
    socket.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("语音连接超时")), 5_000);
      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("语音连接失败"));
      };
    });
    socketRef.current = socket;
    socket.onmessage = (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (data.type === "ready") {
        sessionReadyRef.current = true;
        for (const frame of pendingFramesRef.current.splice(0)) socket.send(frame);
        if (pendingCommitRef.current) {
          pendingCommitRef.current = false;
          commitInFlightRef.current = true;
          socket.send(JSON.stringify({ type: "commit" }));
        }
      } else if (data.type === "transcript") {
        const text = String(data.text ?? "");
        transcriptRef.current = text;
        setPartialTranscript(text);
      } else if (data.type === "final") {
        commitInFlightRef.current = false;
        const deferredAudio = deferredAudioRef.current;
        deferredAudioRef.current = null;
        void handleFinalTranscript(String(data.text ?? transcriptRef.current)).then(() => {
          if (deferredAudio && activeRef.current) submitCompleteUtterance(deferredAudio);
        });
      } else if (data.type === "error") {
        commitInFlightRef.current = false;
        pendingCommitRef.current = false;
        deferredSpeechRef.current = false;
        deferredAudioRef.current = null;
        setError(String(data.message ?? "语音识别失败"));
        setPhase("error");
      }
    };
    socket.onclose = () => {
      window.clearInterval(heartbeatTimerRef.current);
      if (socketRef.current === socket) socketRef.current = null;
      sessionReadyRef.current = false;
      utteranceRef.current = false;
      pendingFramesRef.current = [];
      transcriptRef.current = "";
      if (!activeRef.current) return;
      setPhase("connecting");
      const reconnect = async () => {
        if (!activeRef.current) return;
        try {
          await connectSocketRef.current?.();
          if (activeRef.current && !utteranceRef.current) setPhase("listening");
        } catch {
          reconnectTimerRef.current = window.setTimeout(reconnect, 1_500);
        }
      };
      reconnectTimerRef.current = window.setTimeout(reconnect, 500);
    };
    window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 10_000);
    return socket;
  }, [handleFinalTranscript, submitCompleteUtterance]);

  useEffect(() => {
    connectSocketRef.current = connectSocket;
  }, [connectSocket]);

  const openUtterance = useCallback(() => {
    window.clearTimeout(commitTimerRef.current);
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (commitInFlightRef.current) {
      deferredSpeechRef.current = true;
      setPartialTranscript("");
      setPhase("user_speaking");
      return;
    }
    if (utteranceRef.current) {
      setPhase("user_speaking");
      return;
    }
    utteranceRef.current = true;
    sessionReadyRef.current = false;
    transcriptRef.current = "";
    speechSecondsRef.current = 0;
    pendingFramesRef.current = [...ringFramesRef.current];
    ringFramesRef.current = [];
    setPartialTranscript("");
    setFeedback("");
    setPhase("user_speaking");
    socket.send(JSON.stringify({ type: "start", language: "zh_cn" }));
  }, []);

  const handleFrame = useCallback((_probabilities: unknown, frame: Float32Array) => {
    if (!activeRef.current) return;
    lastVadFrameAtRef.current = Date.now();
    // MiMo finalizes one buffered turn at a time. A complete copy of speech
    // that starts during finalization is taken from onSpeechEnd below, so do
    // not leak its live frames into the recognizer that owns the prior turn.
    if (deferredSpeechRef.current) return;
    const pcm = pcm16Buffer(frame);
    if (!utteranceRef.current) {
      ringFramesRef.current.push(pcm);
      if (ringFramesRef.current.length > FRAME_RING_SIZE) ringFramesRef.current.shift();
      return;
    }
    speechSecondsRef.current += frame.length / 16_000;
    const socket = socketRef.current;
    if (sessionReadyRef.current && socket?.readyState === WebSocket.OPEN) socket.send(pcm);
    else pendingFramesRef.current.push(pcm);
  }, []);

  const handleRealSpeechStart = useCallback(() => {
    interruptTeacher();
    if (runningRef.current) void callbacksRef.current.onStop?.();
    setPhase("user_speaking");
  }, [interruptTeacher]);

  const handleSpeechEnd = useCallback((audio: Float32Array) => {
    if (deferredSpeechRef.current) {
      deferredSpeechRef.current = false;
      const bufferedAudio = pcm16Buffer(audio);
      if (commitInFlightRef.current) {
        deferredAudioRef.current = bufferedAudio;
        setPhase("finalizing");
      } else {
        submitCompleteUtterance(bufferedAudio);
      }
      return;
    }
    if (!utteranceRef.current) return;
    setPhase("finalizing");
    const delay = adaptiveEndpointDelayMs(transcriptRef.current, speechSecondsRef.current);
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      if (!utteranceRef.current) return;
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        commitInFlightRef.current = true;
        socket.send(JSON.stringify({ type: "commit" }));
      }
    }, delay);
  }, [submitCompleteUtterance]);

  const cancelMisfire = useCallback(() => {
    window.clearTimeout(commitTimerRef.current);
    const socket = socketRef.current;
    if (utteranceRef.current && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel" }));
    }
    utteranceRef.current = false;
    sessionReadyRef.current = false;
    pendingFramesRef.current = [];
    pendingCommitRef.current = false;
    deferredSpeechRef.current = false;
    deferredAudioRef.current = null;
    if (activeRef.current) setPhase("listening");
  }, []);

  const stop = useCallback(async () => {
    activeRef.current = false;
    utteranceRef.current = false;
    sessionReadyRef.current = false;
    pendingFramesRef.current = [];
    commitInFlightRef.current = false;
    pendingCommitRef.current = false;
    deferredSpeechRef.current = false;
    deferredAudioRef.current = null;
    setActive(false);
    window.clearTimeout(commitTimerRef.current);
    window.clearTimeout(reconnectTimerRef.current);
    window.clearInterval(heartbeatTimerRef.current);
    window.clearInterval(vadHealthTimerRef.current);
    vadRearmingRef.current = false;
    lastVadFrameAtRef.current = 0;
    interruptTeacher();
    const socket = socketRef.current;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "cancel" }));
    socket?.close(1000, "voice call ended");
    socketRef.current = null;
    const vad = vadRef.current;
    vadRef.current = null;
    if (vad) await vad.destroy().catch(() => undefined);
    setPartialTranscript("");
    setFeedback("");
    setPhase("idle");
  }, [interruptTeacher]);

  const start = useCallback(async () => {
    if (!enabled || activeRef.current) return;
    setPhase("connecting");
    setError("");
    setFeedback("");
    try {
      const statusResponse = await fetch(`${API_BASE}/api/voice/status`, { cache: "no-store" });
      if (!statusResponse.ok) throw new Error("无法读取语音服务状态");
      const status = await statusResponse.json() as VoiceStatusResponse;
      if (!status.asr_ready) throw new Error("语音识别尚未配置，请先在后端配置 MiMo ASR");
      setTtsProvider(status.tts_provider);

      activeRef.current = true;
      setActive(true);
      await connectSocket();

      const { MicVAD } = await import("@ricky0123/vad-web");
      const vad = await MicVAD.new({
        model: "v5",
        startOnLoad: false,
        processorType: "AudioWorklet",
        baseAssetPath: "/voice-assets/",
        onnxWASMBasePath: "/voice-assets/",
        positiveSpeechThreshold: 0.68,
        negativeSpeechThreshold: 0.38,
        redemptionMs: 560,
        preSpeechPadMs: 320,
        minSpeechMs: 180,
        submitUserSpeechOnPause: false,
        onFrameProcessed: handleFrame,
        onSpeechStart: openUtterance,
        onSpeechRealStart: handleRealSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        onVADMisfire: cancelMisfire,
      });
      vadRef.current = vad;
      const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
      spokenMessageRef.current = {
        id: lastAssistant?.id ?? "",
        offset: lastAssistant?.content.length ?? 0,
      };
      await withTimeout(
        vad.start(),
        12_000,
        "麦克风启动超时，请检查系统麦克风权限或音频输入设备后重试",
      );
      lastVadFrameAtRef.current = Date.now();
      window.clearInterval(vadHealthTimerRef.current);
      vadHealthTimerRef.current = window.setInterval(() => {
        if (
          !activeRef.current
          || utteranceRef.current
          || commitInFlightRef.current
          || pendingCommitRef.current
          || deferredSpeechRef.current
          || speechDrainingRef.current
        ) return;
        if (Date.now() - lastVadFrameAtRef.current > 2_500) void rearmVad();
      }, 1_000);
      setPhase("listening");
    } catch (caught) {
      await stop();
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase("error");
    }
  }, [cancelMisfire, connectSocket, enabled, handleFrame, handleRealSpeechStart, handleSpeechEnd, messages, openUtterance, rearmVad, stop]);

  const toggle = useCallback(() => {
    if (activeRef.current) void stop();
    else void start();
  }, [start, stop]);

  useEffect(() => {
    if (!activeRef.current) return;
    const message = [...messages].reverse().find((item) => item.role === "assistant" && item.kind === "text");
    if (!message || !message.content.trim()) return;
    if (spokenMessageRef.current.id !== message.id) spokenMessageRef.current = { id: message.id, offset: 0 };
    const chunks = extractSpeakableChunks(message.content, spokenMessageRef.current.offset, !message.streaming);
    for (const chunk of chunks) {
      spokenMessageRef.current.offset = chunk.endOffset;
      queueSpeech(chunk.text);
    }
  }, [messages, queueSpeech]);

  useEffect(() => () => {
    void stop();
  }, [stop]);

  return {
    active,
    phase,
    partialTranscript,
    feedback,
    error,
    ttsProvider,
    toggle,
    stop,
  };
}
