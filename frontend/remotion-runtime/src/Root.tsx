import type { CalculateMetadataFunction } from "remotion";
import { Composition } from "remotion";

import { LessonVideo, type LessonVideoProps, normalizedScenes } from "./LessonVideo";

const FPS = 24;

const defaultProps: LessonVideoProps = {
  title: "学枢白板讲解",
  scenes: [
    {
      title: "核心概念",
      narration: "从一个关键问题开始理解知识之间的关系。",
      duration: 8,
      composition: "hero",
      reveal_sequence: ["关键问题", "核心关系", "迁移应用"],
    },
  ],
  visual_system: {
    theme: "chalk-garden",
    recurring_motif: "学习路径",
  },
};

const calculateMetadata: CalculateMetadataFunction<LessonVideoProps> = ({ props }) => ({
  durationInFrames: normalizedScenes(props.scenes).reduce(
    (total, scene) => total + Math.max(1, Math.round(scene.duration * FPS)),
    0,
  ),
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="LessonVideo"
    component={LessonVideo}
    durationInFrames={Math.round(defaultProps.scenes[0]?.duration ?? 8) * FPS}
    fps={FPS}
    width={1280}
    height={720}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
