"use client";

import Image from "next/image";
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CheckCircle2,
  Circle,
  Clapperboard,
  Code2,
  GraduationCap,
  FileQuestion,
  Library,
  Loader2,
  MinusCircle,
  MousePointerClick,
  PencilLine,
  Presentation,
  RotateCcw,
  Route,
  ShieldCheck,
  ListTree,
  UserRoundSearch,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { AGENT_MAP } from "@/lib/agents";
import {
  DEFAULT_TEACHER,
  TEACHER_PERSONAS,
  type TeacherPersona,
} from "@/lib/teacher-persona";
import type { AgentId, AgentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const AGENT_ICONS: Record<AgentId, LucideIcon> = {
  profiler: UserRoundSearch,
  outliner: ListTree,
  supervisor: Workflow,
  explainer: BookOpen,
  mindmap: Waypoints,
  quiz: PencilLine,
  solution: FileQuestion,
  reading: Library,
  code: Code2,
  video: Clapperboard,
  courseware: Presentation,
  interactive: MousePointerClick,
  reviewer: ShieldCheck,
  integrator: Boxes,
  planner: Route,
  tutor: GraduationCap,
};

/** 智能体彩色图标块 */
export function AgentIconTile({
  id,
  className,
  iconClassName,
  dimmed,
}: {
  id: AgentId;
  className?: string;
  iconClassName?: string;
  dimmed?: boolean;
}) {
  const meta = AGENT_MAP[id];
  const Icon = AGENT_ICONS[id];
  return (
    <div
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg",
        className
      )}
      style={{
        backgroundColor: dimmed ? undefined : `${meta.color}1f`,
        color: dimmed ? "var(--muted-foreground)" : meta.color,
      }}
    >
      <Icon className={cn("size-4", iconClassName)} />
    </div>
  );
}

/** 状态小图标 */
export function StatusIcon({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  switch (status) {
    case "working":
      return (
        <Loader2
          className={cn("size-3.5 animate-spin text-primary", className)}
        />
      );
    case "rework":
      return (
        <RotateCcw
          className={cn("size-3.5 animate-spin text-warning", className)}
        />
      );
    case "done":
      return (
        <CheckCircle2 className={cn("size-3.5 text-success", className)} />
      );
    case "blocked":
      return <AlertTriangle className={cn("size-3.5 text-danger", className)} />;
    case "skipped":
      return (
        <MinusCircle
          className={cn("size-3.5 text-muted-foreground/50", className)}
        />
      );
    default:
      return (
        <Circle className={cn("size-3.5 text-muted-foreground/40", className)} />
      );
  }
}

export const STATUS_TEXT: Record<AgentStatus, string> = {
  idle: "待命",
  working: "工作中",
  done: "已完成",
  rework: "重做中",
  blocked: "需要操作",
  skipped: "未选用",
};

/** 智能教师头像：复用 web 端吉祥物，并随当前教师切换。 */
export function AssistantAvatar({
  className,
  teacher = DEFAULT_TEACHER,
}: {
  className?: string;
  teacher?: TeacherPersona;
}) {
  const persona = TEACHER_PERSONAS[teacher];
  return (
    <Image
      src={persona.avatar}
      alt={`${persona.name}头像`}
      width={64}
      height={64}
      className={cn(
        "size-8 shrink-0 select-none rounded-lg border border-[#d7c7ad] bg-[#f8f1e6] object-cover object-[50%_22%] shadow-sm",
        className
      )}
    />
  );
}
