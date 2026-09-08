"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FC, HTMLAttributes, Ref } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Globe,
  Loader2,
  NotebookPen,
  RotateCw,
  Search,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ResourceViewer } from "@/components/resource-viewer";
import { BROWSER_URL_KEY, isDesktop } from "@/lib/browser-bus";
import { saveMaterial } from "@/lib/library";
import type { ResourceItem } from "@/lib/types";
import { mapWebSummaryToResources, summarizeWebPage } from "@/lib/web-summary";
import { cn } from "@/lib/utils";

/** Electron <webview> 元素（仅桌面端），声明用到的几个方法。 */
interface WebviewEl extends HTMLElement {
  getURL(): string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
}

// 用类型转换包装 <webview>，避开各环境对该自定义元素的 JSX 声明差异
const Webview = "webview" as unknown as FC<
  HTMLAttributes<HTMLElement> & {
    src?: string;
    allowpopups?: string;
    ref?: Ref<HTMLElement>;
  }
>;

const SEARCH_URL = "https://cn.bing.com/search?q=";

const QUICK_LINKS = [
  { label: "必应搜索", url: "https://cn.bing.com" },
  { label: "哔哩哔哩", url: "https://www.bilibili.com" },
  { label: "知乎", url: "https://www.zhihu.com" },
  { label: "MDN", url: "https://developer.mozilla.org/zh-CN/" },
];

/** 把输入框内容解析成可访问的网址：URL → 原样；裸域名 → 补 https；否则当搜索词。 */
function toTarget(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (!s.includes(" ") && /^[^\s]+\.[^\s]{2,}(\/\S*)?$/.test(s)) return `https://${s}`;
  return `${SEARCH_URL}${encodeURIComponent(s)}`;
}

/**
 * 内置浏览器：桌面端用 Electron <webview> 浏览任意网页（搜索 / 直达 / B站视频等），
 * 网页版（dev）退化为 iframe（仅能内嵌允许嵌入的页面）。
 * 由 lib/browser-bus 的 openInBrowser(url) 经 studio 传入 targetUrl 驱动导航。
 */
export function BrowserPanel({
  targetUrl,
  targetNonce,
}: {
  targetUrl?: string;
  targetNonce?: number;
}) {
  const desktop = isDesktop();
  const { mode, appendResources } = useOrchestratorContext();
  const [url, setUrl] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [note, setNote] = useState<ResourceItem | null>(null);
  const [quiz, setQuiz] = useState<ResourceItem | null>(null);
  const [viewerItem, setViewerItem] = useState<ResourceItem | null>(null);
  const webviewRef = useRef<HTMLElement | null>(null);

  const navigate = useCallback((raw: string) => {
    const target = toTarget(raw);
    if (!target) return;
    setUrl(target);
    setInput(target);
    // 切页后清掉上一页的总结结果
    setNote(null);
    setQuiz(null);
    setSummaryError("");
    try {
      localStorage.setItem(BROWSER_URL_KEY, target);
    } catch {
      /* 忽略 */
    }
  }, []);

  // 首次挂载：有外部目标（刚点的链接）就去那里，否则还原上次浏览的页面（应用重启场景）
  useEffect(() => {
    if (targetUrl) {
      navigate(targetUrl);
      return;
    }
    try {
      const saved = localStorage.getItem(BROWSER_URL_KEY);
      if (saved) {
        setUrl(saved);
        setInput(saved);
      }
    } catch {
      /* 忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部（对话里的链接 / 资源）请求打开网址。跳过首次（挂载）以免用陈旧 target 覆盖上面的还原。
  const firstNonce = useRef(true);
  useEffect(() => {
    if (firstNonce.current) {
      firstNonce.current = false;
      return;
    }
    if (targetUrl) navigate(targetUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetNonce]);

  // 绑定 webview 导航事件，同步地址栏与前进/后退可用态
  useEffect(() => {
    if (!desktop) return;
    const el = webviewRef.current as WebviewEl | null;
    if (!el) return;
    const sync = () => {
      try {
        const cur = el.getURL();
        setInput(cur);
        setCanBack(el.canGoBack());
        setCanFwd(el.canGoForward());
        if (/^https?:\/\//i.test(cur)) localStorage.setItem(BROWSER_URL_KEY, cur);
      } catch {
        /* webview 尚未就绪 */
      }
    };
    const onStart = () => setLoading(true);
    const onStop = () => {
      setLoading(false);
      sync();
    };
    el.addEventListener("did-navigate", sync);
    el.addEventListener("did-navigate-in-page", sync);
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    return () => {
      el.removeEventListener("did-navigate", sync);
      el.removeEventListener("did-navigate-in-page", sync);
      el.removeEventListener("did-start-loading", onStart);
      el.removeEventListener("did-stop-loading", onStop);
    };
  }, [desktop, url]);

  const wv = () => webviewRef.current as WebviewEl | null;

  // AI 总结当前网页正文 → 学习笔记 + 测验题，存入资源中心
  const summarize = async () => {
    const el = wv();
    if (!el || summarizing) return;
    setSummarizing(true);
    setSummaryError("");
    setNote(null);
    setQuiz(null);
    try {
      const page = (await el.executeJavaScript(
        "({ title: document.title, url: location.href, text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 8000) })"
      )) as { title?: string; url?: string; text?: string };
      const payload = await summarizeWebPage(mode, {
        url: page.url || url,
        title: page.title || "",
        content: page.text || "",
      });
      const items = mapWebSummaryToResources(payload);
      await Promise.all([
        saveMaterial(mode, { ...payload.summary_resource, source: "web" }),
        saveMaterial(mode, { ...payload.quiz_resource, source: "web" }),
      ]);
      appendResources(items);
      setNote(items[0] ?? null);
      setQuiz(items[1] ?? null);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "网页总结失败");
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 浏览器工具栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b bg-surface-2/40 px-2 py-2">
        {desktop && (
          <>
            <NavButton label="后退" disabled={!canBack} onClick={() => wv()?.goBack()}>
              <ArrowLeft className="size-4" />
            </NavButton>
            <NavButton label="前进" disabled={!canFwd} onClick={() => wv()?.goForward()}>
              <ArrowRight className="size-4" />
            </NavButton>
            <NavButton
              label={loading ? "加载中" : "刷新"}
              onClick={() => (url ? wv()?.reload() : undefined)}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCw className="size-4" />
              )}
            </NavButton>
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border bg-background pl-2.5 pr-1 focus-within:ring-2 focus-within:ring-ring/30">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate(input);
            }}
            placeholder="搜索，或输入网址"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-[12px] outline-none"
          />
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="在系统浏览器打开"
              className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
        {desktop && url && (
          <button
            type="button"
            onClick={summarize}
            disabled={summarizing}
            title="AI 总结当前网页 → 学习笔记 + 测验题"
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg border bg-background px-2 text-[11px] font-medium text-primary transition-colors hover:bg-accent disabled:opacity-60"
          >
            {summarizing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <NotebookPen className="size-3.5" />
            )}
            总结
          </button>
        )}
      </div>

      {/* 总结结果条 */}
      {(note || summaryError) && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-surface-2/40 px-3 py-1.5 text-[11px]">
          {summaryError ? (
            <span className="text-danger">{summaryError}</span>
          ) : (
            <>
              <Check className="size-3.5 shrink-0 text-success" />
              <span className="truncate text-muted-foreground">已生成学习笔记和测验题</span>
              <button
                type="button"
                onClick={() => setViewerItem(note)}
                className="ml-auto shrink-0 rounded border px-2 py-0.5 font-medium text-primary hover:bg-accent"
              >
                查看笔记
              </button>
              {quiz && (
                <button
                  type="button"
                  onClick={() => setViewerItem(quiz)}
                  className="shrink-0 rounded border px-2 py-0.5 font-medium text-primary hover:bg-accent"
                >
                  去做题
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="relative min-h-0 flex-1 bg-background">
        {url ? (
          desktop ? (
            <Webview
              ref={webviewRef}
              src={url}
              allowpopups="true"
              className="h-full w-full"
              style={{ display: "flex" }}
            />
          ) : (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
                网页版仅能内嵌允许嵌入的页面；完整浏览请用桌面版。
              </div>
              <iframe
                key={url}
                src={url}
                title="内置浏览器"
                className="min-h-0 flex-1"
                referrerPolicy="no-referrer"
              />
            </div>
          )
        ) : (
          <StartScreen onPick={navigate} desktop={desktop} />
        )}
      </div>

      {/* 查看生成的笔记 / 测验 */}
      <ResourceViewer item={viewerItem} onClose={() => setViewerItem(null)} />
    </div>
  );
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function StartScreen({
  onPick,
  desktop,
}: {
  onPick: (url: string) => void;
  desktop: boolean;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-muted text-primary">
        <Globe className="size-6" />
      </span>
      <div>
        <div className="text-sm font-semibold">内置浏览器</div>
        <p className="mx-auto mt-1 max-w-[16rem] text-[12px] leading-relaxed text-muted-foreground">
          上方输入关键词直接搜索，或粘贴网址访问。答疑生成的视频/资料链接会在这里打开。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {QUICK_LINKS.map((q) => (
          <button
            key={q.url}
            type="button"
            onClick={() => onPick(q.url)}
            className={cn(
              "rounded-full border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            )}
          >
            {q.label}
          </button>
        ))}
      </div>
      {!desktop && (
        <p className="text-[11px] text-warning">网页版浏览能力受限，完整体验请用桌面版。</p>
      )}
    </div>
  );
}
