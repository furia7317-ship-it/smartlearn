"use client";

import { useEffect, useRef } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

import {
  DESKTOP_PAGE_DURATION,
  DESKTOP_PAGE_SETTLED,
  WEB_EASE,
  getDesktopPageEnter,
  normalizeRouteKey,
} from "@/lib/web-motion";

/**
 * 桌面壳路由过场：与 WebPageTransition 同范式。
 * 只动 transform，绝不整页隐藏；起始态先 set 再 rAF 启动，避免首帧闪跳。
 */
export function DesktopPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const routeKey = normalizeRouteKey(pathname);
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = frameRef.current;
    if (reducedMotion) {
      controls.set(DESKTOP_PAGE_SETTLED);
      node?.setAttribute("data-transition", "idle");
      return;
    }

    let cancelled = false;
    // will-change 只在播放期间打开：常驻会为页面内的 position:fixed 弹窗制造包含块。
    node?.setAttribute("data-transition", "running");
    controls.set(getDesktopPageEnter(routeKey));
    const frame = window.requestAnimationFrame(() => {
      void controls
        .start({
          ...DESKTOP_PAGE_SETTLED,
          transition: { duration: DESKTOP_PAGE_DURATION, ease: WEB_EASE },
        })
        .then(() => {
          if (!cancelled) node?.setAttribute("data-transition", "idle");
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [controls, reducedMotion, routeKey]);

  return (
    <motion.div
      ref={frameRef}
      initial={false}
      animate={controls}
      data-transition="idle"
      className="desktop-page-transition"
    >
      {children}
    </motion.div>
  );
}
