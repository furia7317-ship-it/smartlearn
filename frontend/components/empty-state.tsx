import { ShellLink as Link } from "@/components/shell-link";
import Image from "next/image";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 干净的空状态：用于尚未产生真实数据的页面（清空预置样例后）。
 * 给一个明确的下一步入口，而不是堆假数据。
 */
export function EmptyState({
  icon: Icon,
  title,
  desc,
  cta,
  className,
  mascot,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  cta?: { href: string; label: string };
  className?: string;
  mascot?: "red-panda" | "alligator";
}) {
  return (
    <div
      className={cn(
        "web-empty-state flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 py-14 text-center",
        className
      )}
    >
      {mascot ? (
        <Image
          src={
            mascot === "alligator"
              ? "/brand/animals/chinese-alligator-review.webp"
              : "/brand/animals/red-panda-plan.webp"
          }
          alt=""
          width={112}
          height={138}
          className="web-empty-state__mascot"
        />
      ) : (
        <div className="web-empty-state__icon grid size-12 place-items-center text-muted-foreground">
          <Icon className="size-6" />
        </div>
      )}
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-[34em] text-[13px] leading-relaxed text-muted-foreground">
        {desc}
      </p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {cta.label}
          <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
