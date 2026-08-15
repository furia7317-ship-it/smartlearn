"use client";

import { Check, FolderTree } from "lucide-react";

import { AGENT_ICONS } from "@/components/agent-bits";
import { AGENT_MAP } from "@/lib/agents";
import type { PathStep, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

function typeName(t: ResourceType): string {
  return AGENT_MAP[t]?.name.replace(/官|师|教练|导演/g, "") ?? t;
}

/**
 * 路径学习资料树状图：根（目标/路径）→ 阶段 → 资料/试题叶子。
 * 每个叶子右侧有对号按钮，完成后该资料变绿显示「已完成」。
 */
export function PathTree({
  path,
  completed,
  onToggle,
  title = "学习路径",
}: {
  path: PathStep[];
  completed: string[];
  onToggle: (key: string) => void;
  title?: string;
}) {
  const done = new Set(completed);
  const total = path.reduce((n, s) => n + s.types.length, 0);
  const doneCount = path.reduce(
    (n, s, i) => n + s.types.filter((t) => done.has(`${i}:${t}`)).length,
    0
  );

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5">
        <FolderTree className="size-3.5 text-muted-foreground" />
        <h2 className="text-sm font-semibold">学习资料树</h2>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {doneCount}/{total} 完成
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        当前路径所需的资料与试题。完成后点右侧对号，对应节点变绿。
      </p>

      <div className="mt-3">
        {/* 根节点 */}
        <div className="inline-flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-[12px] font-semibold text-white">
          <span className="font-display">{title}</span>
        </div>

        <ul className="mt-2 space-y-2.5 border-l border-border pl-3.5">
          {path.map((stage, i) => {
            const stageDone = stage.types.every((t) => done.has(`${i}:${t}`));
            return (
              <li key={`${stage.day}-${i}`} className="relative">
                {/* 阶段节点 */}
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                      stageDone ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {stage.day}
                  </span>
                  <span className="truncate text-[12px] font-medium">{stage.title}</span>
                </div>

                {/* 资料叶子 */}
                <ul className="ml-1 mt-1.5 space-y-1 border-l border-border/70 pl-3">
                  {stage.types.map((t, ti) => {
                    const key = `${i}:${t}`;
                    const isDone = done.has(key);
                    const Icon = AGENT_ICONS[t];
                    return (
                      <li key={`${t}-${ti}`} className="flex items-center gap-2">
                        <Icon
                          className={cn("size-3 shrink-0", isDone && "text-success")}
                          style={isDone ? undefined : { color: AGENT_MAP[t]?.color }}
                        />
                        <span
                          className={cn(
                            "flex-1 truncate text-[12px]",
                            isDone ? "font-medium text-success" : "text-foreground/80"
                          )}
                        >
                          {typeName(t)}
                          {isDone && <span className="ml-1 text-[10px]">· 已完成</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggle(key)}
                          aria-label={isDone ? "标记为未完成" : "标记为已完成"}
                          title={isDone ? "标记为未完成" : "标记为已完成"}
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                            isDone
                              ? "border-success bg-success text-white"
                              : "border-muted-foreground/40 text-transparent hover:border-success hover:text-success/40"
                          )}
                        >
                          <Check className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
