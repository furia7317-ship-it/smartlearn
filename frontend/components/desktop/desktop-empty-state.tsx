"use client";

import { ShellLink as Link } from "@/components/shell-link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 桌面专属空状态——独立于 web 的 EmptyState（后者已带 web-empty-state/吉祥物品牌样式）。
 * 这里走简洁图标版，桌面尺度更大；改它不影响 web。
 */
export function DesktopEmptyState({
  icon: Icon,
  title,
  desc,
  cta,
  className,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  cta?: { href?: string; label: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/40 px-8 py-20 text-center",
        className
      )}
    >
      <div className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-8" />
      </div>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-[40em] text-sm leading-relaxed text-muted-foreground">{desc}</p>
      {cta?.href && (
        <Link
          href={cta.href}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {cta.label}
          <ArrowRight className="size-4" />
        </Link>
      )}
      {cta?.onClick && !cta.href && (
        <button
          type="button"
          onClick={cta.onClick}
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {cta.label}
          <ArrowRight className="size-4" />
        </button>
      )}
    </div>
  );
}
