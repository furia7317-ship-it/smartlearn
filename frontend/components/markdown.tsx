"use client";

import type { ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { openInBrowser } from "@/lib/browser-bus";
import { cn } from "@/lib/utils";

/* ── 全站统一 Markdown 渲染 ──────────────────────────────
   过去 chat / resource-viewer / path-study 各写了一份 <ReactMarkdown>，
   插件集合互相漂移；数学公式（DeepSeek 对高数、复杂度分析天然输出 $...$、
   \frac）在任何一处都渲染不出来。这里收敛成唯一入口：
     remark-gfm  → 表格、删除线、任务列表
     remark-math → 解析 $行内$ 与 $$块级$$
     rehype-katex→ 把公式节点编译成 KaTeX HTML（样式见 app/layout.tsx
                   引入的 katex/dist/katex.min.css + globals.css 的覆盖块）
   插件数组提到模块级常量：react-markdown 每次 render 都会按引用比较，
   内联字面量会让整棵 mdast 每帧重建（流式输出时尤其明显）。 */

const REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [rehypeKatex];

/** 链接就地在「内置浏览器」抽屉打开，不跳外部浏览器（原 chat.tsx 的定制行为）。 */
const IN_APP_LINK_COMPONENTS: Components = {
  a: ({ href, children, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (href && /^https?:/i.test(href)) {
          e.preventDefault();
          if (!openInBrowser(href)) window.open(href, "_blank", "noopener");
        }
      }}
    >
      {children}
    </a>
  ),
};

/**
 * 行内变体：容器与段落都用 <span> 承载，方便塞进 <button>/<p> 这类只接受
 * phrasing content 的宿主（试卷选项按钮、参考答案行），避免 div-in-button /
 * div-in-p 的非法嵌套。单段落保持纯行内；多段落时由 globals.css 里
 * `.md-inline-p + .md-inline-p::before` 的零高块级伪元素负责换行。
 */
const INLINE_COMPONENTS: Components = {
  p: ({ children }) => <span className="md-inline-p">{children}</span>,
};

export interface MarkdownProps {
  content: string;
  /**
   * 追加在默认 `chat-prose max-w-none` 之后的类名。默认容器样式被 globals.css
   * 与既有测试依赖，因此只做追加、不做替换；紧凑排版（试卷题干/选项/解析）
   * 传 `md-tight` 即可压掉段落间距与 72ch 限宽。
   */
  className?: string;
  /** 流式输出时在末尾追加光标块。 */
  streaming?: boolean;
  /** 是否拦截 http(s) 链接走内置浏览器抽屉。默认关闭，由对话区显式开启。 */
  interceptLinks?: boolean;
  /** 行内渲染（容器与段落用 <span>），供 <button>/<p> 内部使用。 */
  inline?: boolean;
  /** 调用方的额外节点覆盖，优先级高于内置链接拦截。 */
  components?: Components;
  /** 内容为空时的兜底节点（试卷解析里用来显示「暂无解析」）。 */
  fallback?: ReactNode;
}

export function Markdown({
  content,
  className,
  streaming = false,
  interceptLinks = false,
  inline = false,
  components,
  fallback,
}: MarkdownProps) {
  const text = typeof content === "string" ? content : "";
  const merged: Components | undefined =
    interceptLinks || inline || components
      ? {
          ...(interceptLinks ? IN_APP_LINK_COMPONENTS : null),
          ...(inline ? INLINE_COMPONENTS : null),
          ...components,
        }
      : undefined;
  const Wrapper = inline ? "span" : "div";

  return (
    <Wrapper className={cn("chat-prose max-w-none", inline && "md-inline", className)}>
      {text.trim() ? (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={merged}>
          {text}
        </ReactMarkdown>
      ) : (
        fallback
      )}
      {streaming && <span className="ml-0.5 inline-block animate-pulse text-primary">▍</span>}
    </Wrapper>
  );
}

export default Markdown;
