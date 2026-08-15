"use client";

import { motion } from "framer-motion";
import { Clock3, MoveDown, MoveUp } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";

import { ChartFrame } from "@/components/chart-frame";
import { Separator } from "@/components/ui/separator";
import { useUserSettings } from "@/hooks/use-user-settings";
import type { ProfileDim } from "@/lib/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0)
    return <span className="text-[10px] text-muted-foreground/60">—</span>;
  const up = delta > 0;
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 text-[10px] font-medium tabular-nums",
        up ? "text-success" : "text-warning"
      )}
    >
      {up ? <MoveUp className="size-2.5" /> : <MoveDown className="size-2.5" />}
      {Math.abs(delta)}
    </span>
  );
}

export function ProfilePanel({
  profile,
  tags,
  updatedAt,
  sources = [],
}: {
  profile: ProfileDim[];
  tags: string[];
  updatedAt?: string;
  sources?: string[];
}) {
  const { name } = useUserSettings();
  const pathname = usePathname();
  const built = tags.length > 0;
  const data = profile.map((d) => ({ subject: d.label, value: d.value }));
  const stroke = built ? "var(--chart-1)" : "var(--muted-foreground)";
  const updatedLabel = updatedAt
    ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(updatedAt))
    : "尚无更新记录";

  return (
    <div className="thin-scroll flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3 pt-2">
      <div className="shrink-0 rounded-xl border bg-card px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium">{name ? `${name} · ` : ""}学习画像</span>
          <span className={cn("text-[11px]", built ? "text-success" : "text-muted-foreground")}>
            {built ? "已随对话更新" : "尚未构建"}
          </span>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border bg-card pb-1 pt-2">
        <ChartFrame height={216}>
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="76%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="value"
              stroke={stroke}
              fill={stroke}
              fillOpacity={built ? 0.3 : 0.1}
              strokeWidth={2}
              animationDuration={800}
            />
          </RadarChart>
        </ChartFrame>

        <Separator className="mb-2" />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 pb-2">
          {profile.map((d) => (
            <div key={d.key} className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-[11px] text-muted-foreground">
                {d.label}
              </span>
              <span className="font-mono text-[11px] font-semibold tabular-nums">
                {d.value}
              </span>
              <DeltaChip delta={built ? d.delta : 0} />
            </div>
          ))}
        </div>
      </div>

      {built && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="shrink-0 rounded-xl border bg-card p-3"
        >
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            特征标签
          </div>
          <p className="text-[12px] leading-relaxed text-foreground/85">
            {tags.join("，")}。
          </p>
        </motion.div>
      )}

      <Link href={pathname.startsWith("/desktop") ? "/desktop/profile?view=graph" : "/profile"} className="block shrink-0 rounded-xl border border-dashed bg-card/55 p-3.5 transition hover:border-primary/60 hover:bg-accent/30">
        <div className="flex items-center gap-2 text-[11px] font-medium text-foreground/80">
          <Clock3 className="size-3.5 text-primary" />
          <span>最近画像更新</span>
          <span className="ml-auto font-mono text-muted-foreground">{updatedLabel}</span>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          来源：{sources.length > 0 ? sources.join("、") : "尚无；完成摸底、练习或复盘后自动记录"}
        </p>
        <div className="mt-2 text-right text-[11px] font-medium text-primary">查看详细知识图谱 →</div>
      </Link>

    </div>
  );
}
