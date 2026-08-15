"use client";

import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

import { useMounted } from "@/hooks/use-mounted";

/**
 * recharts 图表的客户端门控容器。
 * 静态导出 / SSR 阶段容器尚无布局尺寸，直接渲染 ResponsiveContainer 会刷
 * "width(-1) height(-1)" 告警并引发 hydration 抖动；此处挂载后才渲染，
 * 外层固定高度占位避免布局跳动。
 */
export function ChartFrame({
  height,
  className,
  children,
}: {
  height: number;
  className?: string;
  children: ReactElement;
}) {
  const mounted = useMounted();
  return (
    <div className={className} style={{ height }}>
      {mounted && (
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 360, height }}
        >
          {children}
        </ResponsiveContainer>
      )}
    </div>
  );
}
