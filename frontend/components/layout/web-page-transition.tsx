"use client";

import { useEffect } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

import { WEB_EASE, WEB_PAGE_ENTER } from "@/lib/web-motion";

export function WebPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();

  useEffect(() => {
    if (reducedMotion) {
      controls.set({ y: 0, scale: 1 });
      return;
    }

    controls.set(WEB_PAGE_ENTER);
    const frame = window.requestAnimationFrame(() => {
      void controls.start({
        y: 0,
        scale: 1,
        transition: { duration: 0.36, ease: WEB_EASE },
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [controls, pathname, reducedMotion]);

  return (
    <motion.div
      initial={false}
      animate={controls}
      className="web-page-transition"
    >
      {children}
    </motion.div>
  );
}
