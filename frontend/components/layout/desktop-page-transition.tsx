"use client";

import { Suspense, useEffect, useRef, type UIEvent } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { usePathname, useSearchParams } from "next/navigation";

import {
  DESKTOP_PAGE_DURATION,
  DESKTOP_PAGE_SETTLED,
  WEB_EASE,
  getDesktopPageEnter,
  getPageNavigationKey,
  normalizeRouteKey,
} from "@/lib/web-motion";
import {
  getDesktopModuleId,
  readDesktopModuleView,
  rememberDesktopModuleHref,
  saveDesktopModuleView,
} from "@/lib/desktop-module-view";
import styles from "./desktop-page-transition.module.css";

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

function RouteMotion({ routeKey, controls, frameRef, reducedMotion, suppressMotion }: {
  routeKey: string;
  controls: ReturnType<typeof useAnimationControls>;
  frameRef: React.RefObject<HTMLDivElement | null>;
  reducedMotion: boolean | null;
  suppressMotion: boolean;
}) {
  const searchParams = useSearchParams();
  const navigationKey = getPageNavigationKey(routeKey, searchParams.toString());
  // The controls belong to the parent frame and mount after this child's layout effects.
  useEffect(() => {
    const node = frameRef.current;
    controls.stop();
    if (reducedMotion || suppressMotion) {
      controls.set(DESKTOP_PAGE_SETTLED);
      node?.setAttribute("data-transition", "idle");
      return;
    }
    let cancelled = false;
    node?.setAttribute("data-transition", "running");
    controls.set(getDesktopPageEnter(routeKey));
    const frame = window.requestAnimationFrame(() => {
      void controls.start({ ...DESKTOP_PAGE_SETTLED,
        transition: { duration: DESKTOP_PAGE_DURATION, ease: WEB_EASE },
      }).then(() => { if (!cancelled) node?.setAttribute("data-transition", "idle"); });
    });
    return () => { cancelled = true; window.cancelAnimationFrame(frame); controls.stop(); };
  }, [controls, frameRef, navigationKey, reducedMotion, routeKey, suppressMotion]);
  return null;
}

/**
 * 直接在稳定的包装层播放入场，不等待退出，也不重新挂载页面。
 * 路由及内容 ID 变化触发过场：同页筛选、输入和图谱视图保持原位。
 * 图谱和浏览器所在路由只改变透明度，不影响坐标测量或 fixed 元素的包含块。
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
  const motionKind = getDesktopPageEnter(routeKey).y === 0 ? "still" : "move";
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollSaveTimerRef = useRef<number | undefined>(undefined);
  const pendingScrollTopsRef = useRef<Record<string, number>>({});

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
      data-motion={motionKind}
      className={`desktop-page-transition ${styles.frame}`}
      onScrollCapture={rememberScroll}
    >
      <Suspense fallback={null}><RouteMotion routeKey={routeKey} controls={controls} frameRef={frameRef} reducedMotion={reducedMotion} suppressMotion={suppressMotion} /></Suspense>
      {children}
    </motion.div>
  );
}
