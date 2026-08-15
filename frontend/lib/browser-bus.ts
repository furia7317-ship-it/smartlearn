// 极简事件总线：任意组件调 openInBrowser(url) → AI 答疑右侧「内置浏览器」抽屉接管并打开。
// 用于把对话/资源里的链接（B站视频、拓展资料等）就地在内置浏览器里展示，而非跳外部浏览器。

type Listener = (url: string) => void;

const listeners = new Set<Listener>();

/** 内置浏览器当前页 URL 的持久化键：切模块/切面板后重挂载时据此还原，避免重置到起始页。 */
export const BROWSER_URL_KEY = "sl_browser_url_v1";

/** 在内置浏览器里打开一个网址。studio 页未挂载时无监听者，调用方应自行兜底。 */
export function openInBrowser(url: string): boolean {
  if (!url) return false;
  if (listeners.size === 0) return false;
  listeners.forEach((l) => l(url));
  return true;
}

/** 订阅打开请求，返回取消订阅函数。 */
export function onOpenBrowser(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 是否为桌面壳（Electron）。内置浏览器的 <webview> 仅桌面端可用。 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean(window.desktop?.isDesktop);
}
