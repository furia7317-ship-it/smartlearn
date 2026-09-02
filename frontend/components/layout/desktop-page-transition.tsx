"use client";

import { useEffect, useLayoutEffect, useRef, type UIEvent } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

import {
  DESKTOP_PAGE_DURATION,
  DESKTOP_PAGE_SETTLED,
  WEB_EASE,
  getDesktopPageEnter,
  normalizeRouteKey,
} from "@/lib/web-motion";
import {
  getDesktopModuleId,
  readDesktopModuleView,
  rememberDesktopModuleHref,
  saveDesktopModuleView,
} from "@/lib/desktop-module-view";

const SCROLLABLE_SELECTOR = ".thin-scroll, [data-desktop-scroll-memory]";

function scrollNodes(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR));
}

function scrollNodeKey(node: HTMLElement, index: number): string {
  const explicit = node.dataset.desktopScrollMemory?.trim();
  if (explicit) return `data:${explicit}`;
  if (node.id) return `id:${node.id}`;
  const label = node.getAttribute("aria-label")?.trim();
  return label ? `label:${label.slice(0, 120)}` : `index:${index}`;
}

/**
 * 桌面壳路由过场：与 WebPageTransition 同范式。
 * 只动 transform/opacity，绝不整页隐藏；起始态先 set 再 rAF 启动，避免首帧闪跳。
 * 不对整页使用 filter/scale：大图、SVG 和阴影在 Electron 中会触发昂贵的重栅格化。
 */
export function DesktopPageTransition({
  children,
  suppressMotion = false,
}: {
  children: React.ReactNode;
  suppressMotion?: boolean;
}) {
  const pathname = usePathname();
  const routeKey = normalizeRouteKey(pathname);
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<number | undefined>(undefined);
  const pendingScrollTopsRef = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (reducedMotion || suppressMotion) {
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
  }, [controls, reducedMotion, routeKey, suppressMotion]);

  useEffect(() => {
    const moduleId = getDesktopModuleId(routeKey);
    if (!moduleId) return;
    const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    rememberDesktopModuleHref(href);
    const moduleView = readDesktopModuleView(moduleId);
    const saved = moduleView.scrollPath === window.location.pathname
      ? moduleView.scrollTops
      : {};
    pendingScrollTopsRef.current = saved;
    const root = frameRef.current;
    if (!root || Object.keys(saved).length === 0) return;

    let completed = false;
    const restore = () => {
      if (completed) return;
      const nodes = scrollNodes(root);
      let waitingForLayout = false;
      let matched = false;
      nodes.forEach((node, index) => {
        const target = saved[scrollNodeKey(node, index)];
        if (!target) return;
        matched = true;
        node.scrollTop = target;
        if (Math.abs(node.scrollTop - target) > 1) waitingForLayout = true;
      });
      if (matched && !waitingForLayout) completed = true;
    };

    const frame = window.requestAnimationFrame(restore);
    const delayed = window.setTimeout(restore, 320);
    const finalAttempt = window.setTimeout(restore, 900);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(delayed);
      window.clearTimeout(finalAttempt);
    };
  }, [routeKey]);

  useEffect(() => () => window.clearTimeout(scrollSaveTimerRef.current), []);

  const rememberScroll = (event: UIEvent<HTMLDivElement>) => {
    const root = frameRef.current;
    const target = event.target;
    if (!root || !(target instanceof HTMLElement) || target === root) return;
    const moduleId = getDesktopModuleId(window.location.pathname);
    if (!moduleId) return;
    const nodes = scrollNodes(root);
    const index = nodes.indexOf(target);
    if (index < 0) return;
    pendingScrollTopsRef.current = {
      ...pendingScrollTopsRef.current,
      [scrollNodeKey(target, index)]: target.scrollTop,
    };
    window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(() => {
      saveDesktopModuleView(moduleId, {
        href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
        scrollPath: window.location.pathname,
        scrollTops: pendingScrollTopsRef.current,
      });
    }, 90);
  };

  return (
    <motion.div
      ref={frameRef}
      initial={false}
      animate={controls}
      data-transition="idle"
      className="desktop-page-transition"
      onScrollCapture={rememberScroll}
    >
      {children}
    </motion.div>
  );
}
