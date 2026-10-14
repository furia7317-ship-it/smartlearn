"use client";

import { useEffect, useRef } from "react";
import { PageFlip } from "page-flip";

const RESOURCE_BOOK_FLIP_TOTAL_MS = 800;

type ResourceBookFlipProps = {
  direction: "opening" | "closing";
  onReady: () => void;
  onStart: () => void;
  onComplete: () => void;
};

function cloneVisualPage(source: HTMLElement | null, target: HTMLElement | null) {
  if (!target) return () => {};
  target.replaceChildren();

  if (!source) return () => {};
  const clone = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  const scrollOffsets = originals.flatMap((element, index) =>
    element.scrollTop || element.scrollLeft
      ? [{ element: copies[index], top: element.scrollTop, left: element.scrollLeft }]
      : []
  );
  clone.classList.add("desktop-resource-flip-snapshot");
  clone.removeAttribute("aria-label");
  clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll<HTMLElement>("a, button, input, select, textarea, details, video").forEach((element) => {
    element.setAttribute("tabindex", "-1");
    element.setAttribute("aria-hidden", "true");
    element.style.pointerEvents = "none";
  });
  clone.querySelectorAll<HTMLVideoElement>("video").forEach((video) => {
    video.autoplay = false;
    video.muted = true;
    video.pause();
  });
  target.appendChild(clone);
  // Hidden pages cannot retain scroll offsets until PageFlip has laid them out.
  return () => scrollOffsets.forEach(({ element, top, left }) => {
    element.scrollTop = top;
    element.scrollLeft = left;
  });
}

export function ResourceBookFlip({ direction, onReady, onStart, onComplete }: ResourceBookFlipProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onReady, onStart, onComplete });

  useEffect(() => {
    callbacksRef.current = { onReady, onStart, onComplete };
  }, [onReady, onStart, onComplete]);

  useEffect(() => {
    const host = hostRef.current;
    const shell = host?.closest<HTMLElement>(".desktop-resource-book-shell");
    if (!host || !shell) return;

    const coverPage = document.createElement("div");
    coverPage.className = "desktop-resource-flip-page is-cover";
    coverPage.dataset.density = "hard";
    const coverImage = document.createElement("img");
    coverImage.src = "/brand/resources/resource-book-cover-v3.webp";
    coverImage.alt = "";
    const coverLabel = document.createElement("span");
    const coverTitle = document.createElement("strong");
    coverTitle.textContent = "资源典藏";
    const coverSubtitle = document.createElement("small");
    coverSubtitle.textContent = "点击展开书页";
    coverLabel.append(coverTitle, coverSubtitle);
    coverPage.append(coverImage, coverLabel);

    const leftPage = document.createElement("div");
    leftPage.className = "desktop-resource-flip-page is-left-page";
    const rightPage = document.createElement("div");
    rightPage.className = "desktop-resource-flip-page is-right-page";
    host.append(coverPage, leftPage, rightPage);

    const restoreLeftScroll = cloneVisualPage(shell.querySelector<HTMLElement>(".desktop-resource-left-page"), leftPage);
    const restoreRightScroll = cloneVisualPage(shell.querySelector<HTMLElement>(".desktop-resource-preview"), rightPage);

    const bounds = shell.getBoundingClientRect();
    const usePortrait = window.matchMedia("(max-width: 960px)").matches;
    const pageWidth = Math.max(1, usePortrait ? bounds.width : bounds.width / 2);
    const pageHeight = Math.max(1, bounds.height);
    // Keep the reference's depth proportional to our much wider resource pages.
    host.style.setProperty("--resource-flip-perspective", `${Math.max(2000, pageWidth * 5)}px`);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flipDuration = reduceMotion ? 1 : RESOURCE_BOOK_FLIP_TOTAL_MS;
    let started = false;
    let completed = false;
    let disposed = false;
    let fallbackTimer: number | null = null;
    let initialized = false;
    let loaded = false;
    let firstFrame = 0;
    let secondFrame = 0;

    const finish = () => {
      if (disposed || completed) return;
      completed = true;
      callbacksRef.current.onComplete();
    };

    const pageFlip = new PageFlip(host, {
      width: pageWidth,
      height: pageHeight,
      size: "fixed",
      showCover: true,
      drawShadow: true,
      maxShadowOpacity: 0.28,
      flippingTime: flipDuration,
      mobileScrollSupport: false,
      clickEventForward: false,
      useMouseEvents: false,
      usePortrait,
      autoSize: false,
      startPage: direction === "opening" ? 0 : 1,
    });

    pageFlip.on<{ page: number; mode: string }>("init", () => {
      if (disposed) return;
      restoreLeftScroll();
      restoreRightScroll();
      host.classList.add("is-ready");
      callbacksRef.current.onReady();
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (disposed) return;
          started = true;
          callbacksRef.current.onStart();
          if (direction === "opening") pageFlip.flipNext("top");
          else pageFlip.flipPrev("top");
          fallbackTimer = window.setTimeout(finish, flipDuration + 180);
        });
      });
    });

    pageFlip.on<string>("changeState", (event) => {
      if (disposed || !started || event.data !== "read") return;
      // The library has cleared its folded page and shadow; reveal the live spread now.
      finish();
    });

    // Decode the cover before hiding the actual book so the first frame cannot flash blank.
    const initialize = () => {
      if (disposed || initialized) return;
      initialized = true;
      try {
        pageFlip.loadFromHTML([coverPage, leftPage, rightPage]);
        loaded = true;
      }
      catch { finish(); }
    };
    const decodeTimeout = window.setTimeout(initialize, 500);
    void coverImage.decode().catch(() => {}).then(initialize);
    return () => {
      disposed = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      window.clearTimeout(decodeTimeout);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      const parent = host.parentNode;
      const nextSibling = host.nextSibling;
      if (loaded) pageFlip.destroy();
      if (parent && host.parentNode !== parent) parent.insertBefore(host, nextSibling);
      host.replaceChildren();
      host.removeAttribute("style");
      host.className = "desktop-resource-page-flip";
    };
  }, [direction]);

  return <div ref={hostRef} className="desktop-resource-page-flip" aria-hidden="true" />;
}
