"use client";

import { useEffect, useRef } from "react";
import { APP_NAVIGATION_EVENT, appDestination, appFeatureSelection } from "@/lib/app-navigation";

/** Restore a deep-linked feature after the page's remembered tab is restored. */
export function useAppFeatureNavigation<T extends string>(
  pathname: string, parameter: string, allowed: readonly T[], onSelect: (value: T) => void,
) {
  const current = useRef({ allowed, onSelect });
  current.current = { allowed, onSelect };
  useEffect(() => {
    const select = (href: string) => {
      const value = appFeatureSelection(href, pathname, parameter, current.current.allowed);
      if (value) current.current.onSelect(value);
    };
    const frame = requestAnimationFrame(() => select(window.location.href));
    const onPopState = () => select(window.location.href);
    const onNavigate = (event: Event) => {
      const target = appDestination((event as CustomEvent).detail);
      if (target) select(target.href);
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener(APP_NAVIGATION_EVENT, onNavigate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener(APP_NAVIGATION_EVENT, onNavigate);
    };
  }, [pathname, parameter]);
}
