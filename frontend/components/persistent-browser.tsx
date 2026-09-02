"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { Globe, X } from "lucide-react";

import { onOpenBrowser } from "@/lib/browser-bus";

const BrowserPanel = dynamic(
  () => import("@/components/browser-panel").then((module) => module.BrowserPanel),
  { ssr: false },
);

type Rect = { x: number; y: number; w: number; h: number };
type HostApi = { show: (r: Rect) => void; hide: () => void };

const Ctx = createContext<HostApi | null>(null);

function defaultBrowserBounds(): Rect {
  const gap = 16;
  const top = 72;
  const availableWidth = Math.max(420, window.innerWidth - 240 - gap * 2);
  const width = Math.min(760, availableWidth);
  const height = Math.min(760, Math.max(420, window.innerHeight - top - gap));
  return {
    x: Math.max(gap, window.innerWidth - width - gap),
    y: top,
    w: width,
    h: height,
  };
}

export function useBrowserHost(): HostApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBrowserHost 必须在 <PersistentBrowserHost> 内使用");
  return c;
}

/**
 * 把内置浏览器（<webview>）挂在根布局这一层——它不随路由切换卸载，所以切到其他模块
 * 再回来时页面/视频原样保留，而不是重新加载。studio 只提供"占位矩形"，这里把浏览器
 * 用 fixed 定位精确盖在占位上；不可见时移到屏幕外（保持渲染、不销毁）。
 */
export function PersistentBrowserHost({ children }: { children: React.ReactNode }) {
  const [bounds, setBounds] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);
  const [activated, setActivated] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [targetNonce, setTargetNonce] = useState(0);

  const show = useCallback((r: Rect) => {
    setBounds(r);
    setVisible(true);
    setActivated(true);
    setStandalone(false);
  }, []);
  const hide = useCallback(() => setVisible(false), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  // 对话/资源里的链接 → 记录目标 URL，BrowserPanel 据此导航
  useEffect(() => {
    return onOpenBrowser((url) => {
      setTargetUrl(url);
      setTargetNonce((n) => n + 1);
      setActivated(true);
      setStandalone(true);
      setBounds(defaultBrowserBounds());
      setVisible(true);
    });
  }, []);

  useEffect(() => {
    if (!visible || !standalone) return;
    const keepInViewport = () => setBounds(defaultBrowserBounds());
    window.addEventListener("resize", keepInViewport);
    return () => window.removeEventListener("resize", keepInViewport);
  }, [standalone, visible]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {activated && (
        <div
          role={standalone ? "dialog" : undefined}
          aria-label={standalone ? "内置浏览器" : undefined}
          aria-hidden={!visible}
          className={standalone ? "overflow-hidden rounded-2xl border border-[#cdbb9f] bg-[#fffaf1] shadow-[0_24px_70px_rgba(50,35,18,0.3)]" : undefined}
          style={{
            position: "fixed",
            top: bounds?.y ?? 0,
            left: visible && bounds ? bounds.x : -100000,
            width: bounds?.w ?? 0,
            height: bounds?.h ?? 0,
            zIndex: standalone ? 70 : 10,
            pointerEvents: visible ? "auto" : "none",
          }}
        >
          {standalone && (
            <header className="flex h-11 items-center gap-2 border-b border-[#dfd0ba] bg-[#fbf6ed] px-3 text-[#443521]">
              <Globe className="size-4 text-[#966126]" aria-hidden />
              <strong className="text-xs">内置浏览器</strong>
              <button type="button" onClick={hide} className="ml-auto grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]" aria-label="关闭内置浏览器">
                <X className="size-4" />
              </button>
            </header>
          )}
          <div className={standalone ? "h-[calc(100%-44px)]" : "h-full"}>
            <BrowserPanel targetUrl={targetUrl} targetNonce={targetNonce} />
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
