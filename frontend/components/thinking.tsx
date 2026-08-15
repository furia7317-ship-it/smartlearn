import { cn } from "@/lib/utils";

/**
 * AI 等待首个响应（生成/答疑的首 token / 首事件）时的「思考中…」指示器。
 * 三个圆点依次跳动。
 */
export function Thinking({ label = "思考中", className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[13px] text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <span>{label}</span>
      <span className="flex items-end gap-0.5 pb-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1 animate-bounce rounded-full bg-current"
            style={{ animationDelay: `${i * 160}ms`, animationDuration: "1s" }}
          />
        ))}
      </span>
    </span>
  );
}
