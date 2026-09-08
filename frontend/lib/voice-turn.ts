export interface SpeakableChunk {
  text: string;
  endOffset: number;
}

const INCOMPLETE_ENDINGS = [
  "因为",
  "所以",
  "如果",
  "但是",
  "然后",
  "而且",
  "还有",
  "就是",
  "比如",
  "我想",
  "我觉得",
  "首先",
  "其次",
  "最后",
  "那个",
  "嗯",
  "呃",
];

export function adaptiveEndpointDelayMs(transcript: string, speechSeconds: number): number {
  const text = transcript.trim();
  if (!text) return speechSeconds < 0.8 ? 700 : 420;
  if (INCOMPLETE_ENDINGS.some((ending) => text.endsWith(ending))) return 1_100;
  if (/[，、：:]$/.test(text)) return 850;
  if (/[。！？!?]$/.test(text)) return 120;
  if (text.length <= 3) return 620;
  return speechSeconds > 8 ? 180 : 320;
}

export function cleanSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " 代码示例 ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)、]\s+/gm, "")
    .replace(/[>*_~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractSpeakableChunks(
  text: string,
  startOffset: number,
  final: boolean,
): SpeakableChunk[] {
  const chunks: SpeakableChunk[] = [];
  const boundary = /[。！？!?；;\n]/g;
  boundary.lastIndex = Math.max(0, startOffset);
  let cursor = Math.max(0, startOffset);
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const endOffset = match.index + match[0].length;
    const spoken = cleanSpeechText(text.slice(cursor, endOffset));
    if (spoken) chunks.push({ text: spoken, endOffset });
    cursor = endOffset;
  }
  if (final && cursor < text.length) {
    const spoken = cleanSpeechText(text.slice(cursor));
    if (spoken) chunks.push({ text: spoken, endOffset: text.length });
  }
  return chunks;
}
