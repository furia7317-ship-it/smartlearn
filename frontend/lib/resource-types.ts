import type { ResourceType } from "@/lib/types";

/** 资源类型 → 中文名（标签用，非样例数据） */
export const TYPE_NAMES: Record<ResourceType, string> = {
  explainer: "讲义",
  mindmap: "导图",
  quiz: "题库",
  solution: "题目解析",
  reading: "阅读",
  code: "代码",
  video: "视频",
  courseware: "课件",
  interactive: "交互演示",
};
