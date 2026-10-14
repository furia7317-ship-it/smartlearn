"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { DESKTOP_PAGE_DURATION, WEB_EASE } from "@/lib/web-motion";

/** Stable content container: switching views never remounts drafts or live tools. */
export function ViewTransition({ viewKey, children, ...props }: ComponentProps<"div"> & { viewKey: string }) {
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  const previous = useRef(viewKey);
  useLayoutEffect(() => {
    controls.stop();
    const changed = previous.current !== viewKey;
    previous.current = viewKey;
    if (reduced || !changed) { controls.set({ opacity: 1 }); return; }
    controls.set({ opacity: .64 });
    void controls.start({ opacity: 1, transition: { duration: DESKTOP_PAGE_DURATION, ease: WEB_EASE } });
    return () => controls.stop();
  }, [controls, reduced, viewKey]);
  return <div {...props} data-view-transition={viewKey}><motion.div initial={false} animate={controls}>{children}</motion.div></div>;
}
