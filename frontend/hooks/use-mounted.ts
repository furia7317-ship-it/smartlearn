"use client";

import { useEffect, useState } from "react";

/**
 * 客户端挂载后才为 true。
 * 用于门控仅在浏览器才有意义的组件（如 recharts 图表）——
 * 静态导出 / SSR 阶段容器尚无布局尺寸，直接渲染 ResponsiveContainer 会刷
 * "width(-1) height(-1)" 告警并产生 hydration 抖动；挂载后再渲染可彻底规避。
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
