import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type LessonScene = {
  title?: string;
  narration?: string;
  text?: string;
  duration?: number;
  purpose?: string;
  composition?: string;
  chapter_title?: string;
  visual_anchor?: string;
  carry_over?: string;
  reveal_sequence?: Array<string | { label?: string; text?: string }>;
  focus_terms?: string[];
  visual_params?: {
    items?: string[];
    steps?: string[];
    rows?: string[][];
  };
};

export type LessonVideoProps = {
  title: string;
  scenes: LessonScene[];
  visual_system?: {
    theme?: string;
    recurring_motif?: string;
  };
};

type NormalizedScene = Required<Pick<LessonScene, "title" | "narration" | "duration">> & LessonScene & {
  labels: string[];
};

const PALETTE = {
  paper: "#f7f0df",
  paperDeep: "#efe3cb",
  ink: "#292b2b",
  muted: "#6b655b",
  green: "#406b58",
  greenSoft: "#dce8da",
  ochre: "#b67a2d",
  red: "#aa4d42",
  blue: "#3e6683",
  white: "#fffdf7",
};

const labelText = (value: unknown, fallback = "重点") => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 16);
};

export function normalizedScenes(input: LessonScene[] | undefined): NormalizedScene[] {
  const scenes = Array.isArray(input) ? input.filter(Boolean) : [];
  return (scenes.length ? scenes : [{ title: "核心概念", duration: 8 }]).map((scene, index) => {
    const rawLabels = [
      ...(scene.reveal_sequence ?? []).map((item) =>
        typeof item === "string" ? item : item?.label || item?.text || "",
      ),
      ...(scene.focus_terms ?? []),
      ...(scene.visual_params?.steps ?? []),
      ...(scene.visual_params?.items ?? []),
      ...(scene.visual_params?.rows ?? []).map((row) => row?.[0] ?? ""),
    ];
    const labels = Array.from(new Set(rawLabels.map((item) => labelText(item, "")).filter(Boolean))).slice(0, 4);
    return {
      ...scene,
      title: labelText(scene.title, `章节内容 ${index + 1}`),
      narration: String(scene.narration || scene.text || "").trim(),
      duration: Math.max(2, Number(scene.duration) || 8),
      labels: labels.length ? labels : [labelText(scene.visual_anchor || scene.title, "核心关系")],
    };
  });
}

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

const PaperTexture: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame % 48;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: PALETTE.paper,
        backgroundImage: [
          `linear-gradient(rgba(73,92,74,.075) 1px, transparent 1px)`,
          `linear-gradient(90deg, rgba(73,92,74,.075) 1px, transparent 1px)`,
          `radial-gradient(circle at 12% 18%, rgba(182,122,45,.10), transparent 26%)`,
          `radial-gradient(circle at 88% 80%, rgba(64,107,88,.10), transparent 30%)`,
        ].join(","),
        backgroundSize: "32px 32px, 32px 32px, 100% 100%, 100% 100%",
        backgroundPosition: `${drift * 0.08}px ${drift * 0.05}px`,
      }}
    />
  );
};

const HandDrawnLine: React.FC<{
  path: string;
  color?: string;
  startFrame?: number;
  durationFrames?: number;
  width?: number;
}> = ({ path, color = PALETTE.green, startFrame = 0, durationFrames = 18, width = 5 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + durationFrames], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={1400}
      strokeDashoffset={1400 * (1 - progress)}
    />
  );
};

const DrawingHand: React.FC<{ startFrame?: number }> = ({ startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + 20], [0, 1], clamp);
  const opacity = interpolate(progress, [0, 0.08, 0.85, 1], [0, 1, 1, 0], clamp);
  const x = 210 + progress * 570;
  const y = 442 - Math.sin(progress * Math.PI) * 22;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 74,
        height: 74,
        opacity,
        transform: "rotate(-18deg)",
      }}
    >
      <svg viewBox="0 0 90 90" width="100%" height="100%">
        <path d="M17 58c4-14 12-27 23-37 5-4 10 0 7 6l-10 17 24-20c6-5 12 1 7 7L47 52l20-13c7-4 11 4 5 9L47 70c-8 7-20 8-30 2z" fill="#efc7a1" stroke="#352f2a" strokeWidth="3" />
        <path d="M58 19l22-12 4 7-21 14z" fill={PALETTE.ochre} stroke="#352f2a" strokeWidth="3" />
      </svg>
    </div>
  );
};

const SketchCard: React.FC<{
  label: string;
  index: number;
  active: boolean;
  x: number;
  y: number;
  width?: number;
}> = ({ label, index, active, x, y, width = 230 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    frame: frame - index * Math.round(0.24 * fps),
    fps,
    durationInFrames: Math.round(0.55 * fps),
    config: { damping: 18, stiffness: 150 },
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        minHeight: 96,
        padding: "22px 22px 18px",
        border: `3px solid ${active ? PALETTE.green : "#746e62"}`,
        borderRadius: index % 2 ? "18px 11px 17px 9px" : "11px 18px 10px 16px",
        background: active ? PALETTE.greenSoft : "rgba(255,253,247,.78)",
        color: PALETTE.ink,
        fontFamily: "Microsoft YaHei, sans-serif",
        fontSize: 25,
        fontWeight: 750,
        lineHeight: 1.25,
        opacity: entrance,
        transform: `translateY(${(1 - entrance) * 30}px) rotate(${(index % 2 ? 1 : -1) * (1 - entrance) * 2}deg)`,
        boxShadow: active ? "8px 9px 0 rgba(64,107,88,.13)" : "5px 6px 0 rgba(41,43,43,.08)",
      }}
    >
      <span style={{ position: "absolute", left: 14, top: 9, color: PALETTE.red, fontSize: 15 }}>
        {String(index + 1).padStart(2, "0")}
      </span>
      {label}
    </div>
  );
};

const SceneVisual: React.FC<{
  scene: NormalizedScene;
  sceneIndex: number;
  total: number;
  sceneDurationInFrames: number;
}> = ({
  scene,
  sceneIndex,
  total,
  sceneDurationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, durationInFrames: Math.round(0.65 * fps), config: { damping: 200 } });
  const leave = interpolate(
    frame,
    [Math.max(0, sceneDurationInFrames - 10), sceneDurationInFrames],
    [1, 0],
    clamp,
  );
  const visibleCount = Math.min(
    scene.labels.length,
    Math.max(1, Math.floor(frame / Math.max(1, Math.round(1.15 * fps))) + 1),
  );
  const composition = String(scene.composition || "process").toLowerCase();
  const twoColumn = composition === "split" || composition === "comparison";
  const cardWidth = twoColumn ? 330 : scene.labels.length <= 2 ? 300 : 235;
  const startX = twoColumn ? 245 : Math.max(115, 640 - (scene.labels.length * (cardWidth + 30) - 30) / 2);

  return (
    <AbsoluteFill style={{ opacity: enter * leave, transform: `scale(${0.985 + enter * 0.015})` }}>
      <div style={{ position: "absolute", left: 68, top: 48, color: PALETTE.green, font: "700 18px Microsoft YaHei" }}>
        {labelText(scene.chapter_title, `知识白板 · ${sceneIndex + 1}/${total}`)}
      </div>
      <div style={{ position: "absolute", left: 68, top: 88, maxWidth: 860, color: PALETTE.ink, font: "800 50px Microsoft YaHei", letterSpacing: -1 }}>
        {scene.title}
      </div>
      <div style={{ position: "absolute", right: 68, top: 56, color: PALETTE.muted, font: "600 16px Microsoft YaHei" }}>
        REMOTION · WHITEBOARD
      </div>

      <svg viewBox="0 0 1280 720" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <HandDrawnLine path="M70 158 C250 151 410 163 620 155" color={PALETTE.ochre} startFrame={2} durationFrames={18} width={6} />
        {scene.labels.slice(0, visibleCount).map((_, index) => {
          if (index === 0) return null;
          const x1 = startX + (index - 1) * (cardWidth + 30) + cardWidth;
          const x2 = startX + index * (cardWidth + 30);
          return (
            <HandDrawnLine
              key={index}
              path={`M${x1} 372 C${x1 + 16} ${350 + index * 4}, ${x2 - 18} ${389 - index * 4}, ${x2} 372`}
              startFrame={Math.round((0.7 + index * 0.9) * fps)}
              durationFrames={14}
              width={4}
            />
          );
        })}
        <HandDrawnLine path="M220 512 C390 493 575 527 780 506" color={PALETTE.red} startFrame={Math.round(1.7 * fps)} durationFrames={22} width={5} />
      </svg>

      {scene.labels.slice(0, visibleCount).map((label, index) => {
        const x = twoColumn
          ? index % 2 === 0 ? 230 : 720
          : startX + index * (cardWidth + 30);
        const y = twoColumn ? 255 + Math.floor(index / 2) * 145 : 300 + (index % 2) * 22;
        return (
          <SketchCard
            key={`${label}-${index}`}
            label={label}
            index={index}
            active={index === visibleCount - 1}
            x={x}
            y={y}
            width={cardWidth}
          />
        );
      })}

      {scene.carry_over && (
        <div style={{ position: "absolute", left: 76, bottom: 74, maxWidth: 280, color: PALETTE.blue, font: "650 18px Microsoft YaHei" }}>
          承接：{labelText(scene.carry_over)}
        </div>
      )}
      <div style={{ position: "absolute", right: 76, bottom: 70, color: PALETTE.muted, font: "650 17px Microsoft YaHei" }}>
        {labelText(scene.visual_anchor || scene.labels[0], "知识锚点")}
      </div>
      <DrawingHand startFrame={Math.round(0.35 * fps)} />
    </AbsoluteFill>
  );
};

export const LessonVideo: React.FC<LessonVideoProps> = (props) => {
  const { fps } = useVideoConfig();
  const scenes = normalizedScenes(props.scenes);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <PaperTexture />
      {scenes.map((scene, index) => {
        const durationInFrames = Math.max(1, Math.round(scene.duration * fps));
        const from = scenes
          .slice(0, index)
          .reduce(
            (total, previous) => total + Math.max(1, Math.round(previous.duration * fps)),
            0,
          );
        return (
          <Sequence
            key={`${scene.title}-${index}`}
            from={from}
            durationInFrames={durationInFrames}
            premountFor={fps}
          >
            <SceneVisual
              scene={scene}
              sceneIndex={index}
              total={scenes.length}
              sceneDurationInFrames={durationInFrames}
            />
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 9, background: PALETTE.paperDeep }} />
    </AbsoluteFill>
  );
};
