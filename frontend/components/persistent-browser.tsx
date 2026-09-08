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

import { onOpenBrowser } from "@/lib/browser-bus";

const BrowserPanel = dynamic(
  () => import("@/components/browser-panel").then((module) => module.BrowserPanel),
  { ssr: false },
);

type Rect = { x: number; y: number; w: number; h: number };
type HostApi = { show: (r: Rect) => void; hide: () => void };

const Ctx = createContext<HostApi | null>(null);

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
  const [targetUrl, setTargetUrl] = useState("");
  const [targetNonce, setTargetNonce] = useState(0);

  const show = useCallback((r: Rect) => {
    setBounds(r);
    setVisible(true);
    setActivated(true);
  }, []);
  const hide = useCallback(() => setVisible(false), []);
  const api = useMemo(() => ({ show, hide }), [show, hide]);

  // 对话/资源里的链接 → 记录目标 URL，BrowserPanel 据此导航
  useEffect(() => {
    return onOpenBrowser((url) => {
      setTargetUrl(url);
      setTargetNonce((n) => n + 1);
      setActivated(true);
    });
  }, []);

  return (
    <Ctx.Provider value={api}>
      {children}
      {activated && (
        <div
          aria-hidden={!visible}
          style={{
            position: "fixed",
            top: bounds?.y ?? 0,
            left: visible && bounds ? bounds.x : -100000,
            width: bounds?.w ?? 0,
            height: bounds?.h ?? 0,
            zIndex: 10,
            pointerEvents: visible ? "auto" : "none",
          }}
        >
          <BrowserPanel targetUrl={targetUrl} targetNonce={targetNonce} />
        </div>
      )}
    </Ctx.Provider>
  );
}
