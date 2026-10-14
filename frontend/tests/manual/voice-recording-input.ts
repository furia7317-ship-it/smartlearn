/** Local recording fixture: real audio enters MicVAD/ASR; no transcripts or replies are stubbed. */
export function createRecordingInput() {
  if (process.env.NEXT_PUBLIC_VOICE_RECORDING_INPUT !== "1"
    || !["localhost", "127.0.0.1"].includes(window.location.hostname)
    || new URLSearchParams(window.location.search).get("voiceRecording") !== "1") return null;
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const channel = new BroadcastChannel("voice-recording-input");
  const sources = new Set<AudioBufferSourceNode>();
  channel.onmessage = async (event: MessageEvent<{ clip?: string }>) => {
    const clip = event.data?.clip;
    if (!clip || !/^q[123]$/.test(clip)) return;
    try {
      await context.resume();
      const response = await fetch(`/__voice-recording/${clip}.mp3`);
      if (!response.ok) throw new Error("Recording input unavailable");
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.connect(context.destination);
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); };
      source.start();
      channel.postMessage({ playing: clip, duration: buffer.duration });
    } catch (error) {
      channel.postMessage({ error: String(error) });
    }
  };
  return {
    options: {
      getStream: async () => { await context.resume(); return destination.stream; },
      pauseStream: async () => {},
      resumeStream: async () => { await context.resume(); return destination.stream; },
    },
    dispose: () => {
      channel.close();
      for (const source of sources) { source.stop(); source.disconnect(); }
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}
