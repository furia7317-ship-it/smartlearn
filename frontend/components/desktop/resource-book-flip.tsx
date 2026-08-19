"use client";

import { useEffect, useRef } from "react";
import { PageFlip } from "page-flip";

type ResourceBookFlipProps = {
  direction: "opening" | "closing";
  onReady: () => void;
  onComplete: () => void;
};

function cloneVisualPage(source: HTMLElement | null, target: HTMLElement | null) {
  if (!target) return;
  target.replaceChildren();

  if (!source) return;
  const clone = source.cloneNode(true) as HTMLElement;
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
}

export function ResourceBookFlip({ direction, onReady, onComplete }: ResourceBookFlipProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onReady, onComplete });

  useEffect(() => {
    callbacksRef.current = { onReady, onComplete };
  }, [onReady, onComplete]);

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
    coverSubtitle.textContent = "学枢馆藏";
    coverLabel.append(coverTitle, coverSubtitle);
    coverPage.append(coverImage, coverLabel);

    const leftPage = document.createElement("div");
    leftPage.className = "desktop-resource-flip-page is-left-page";
    const rightPage = document.createElement("div");
    rightPage.className = "desktop-resource-flip-page is-right-page";
    host.append(coverPage, leftPage, rightPage);

    cloneVisualPage(shell.querySelector<HTMLElement>(".desktop-resource-left-page"), leftPage);
    cloneVisualPage(shell.querySelector<HTMLElement>(".desktop-resource-preview"), rightPage);

    const bounds = shell.getBoundingClientRect();
    const usePortrait = bounds.width <= 960;
    const pageWidth = Math.max(320, Math.round(usePortrait ? bounds.width : bounds.width / 2));
    const pageHeight = Math.max(560, Math.round(bounds.height));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flipDuration = reduceMotion ? 1 : 800;
    let started = false;
    let completed = false;
    let disposed = false;
    let startedAt = 0;
    let fallbackTimer: number | null = null;
    let completionTimer: number | null = null;
    let firstFrame = 0;
    let secondFrame = 0;

    const finish = () => {
      if (disposed || completed) return;
      const remaining = flipDuration - (performance.now() - startedAt);
      if (started && remaining > 16) {
        if (completionTimer !== null) window.clearTimeout(completionTimer);
        completionTimer = window.setTimeout(finish, remaining);
        return;
      }
      completed = true;
      callbacksRef.current.onComplete();
    };

    const pageFlip = new PageFlip(host, {
      width: pageWidth,
      height: pageHeight,
      size: "fixed",
      showCover: true,
      drawShadow: true,
      maxShadowOpacity: 0.5,
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
      host.classList.add("is-ready");
      callbacksRef.current.onReady();
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (disposed) return;
          started = true;
          startedAt = performance.now();
          if (direction === "opening") pageFlip.flipNext("top");
          else pageFlip.flipPrev("top");
          fallbackTimer = window.setTimeout(finish, flipDuration + 450);
        });
      });
    });

    pageFlip.on<number>("flip", (event) => {
      if (disposed || !started) return;
      if ((direction === "opening" && event.data === 1) || (direction === "closing" && event.data === 0)) {
        finish();
      }
    });

    pageFlip.loadFromHTML([coverPage, leftPage, rightPage]);

    return () => {
      disposed = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      if (completionTimer !== null) window.clearTimeout(completionTimer);
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      const parent = host.parentNode;
      const nextSibling = host.nextSibling;
      pageFlip.destroy();
      if (parent && host.parentNode !== parent) parent.insertBefore(host, nextSibling);
      host.removeAttribute("style");
      host.className = "desktop-resource-page-flip";
    };
  }, [direction]);

  return <div ref={hostRef} className="desktop-resource-page-flip" aria-hidden="true" />;
}
