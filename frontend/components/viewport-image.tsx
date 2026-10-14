"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";
import { observeNearViewport } from "@/lib/near-viewport";

// Keeps the exact image box/CSS without a wrapper or an early network request.
const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
type ViewportImageProps = Omit<ImageProps, "priority" | "preload" | "loading" | "placeholder" | "blurDataURL">;

export function ViewportImage({ src, alt, ...props }: ViewportImageProps) {
  const image = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!image.current) return;
    return observeNearViewport(image.current, () => setVisible(true));
  }, []);

  return (
    <Image
      {...props}
      ref={image}
      alt={alt}
      src={visible ? src : EMPTY_IMAGE}
      loading="eager"
      fetchPriority="low"
      decoding="async"
      data-viewport-image={visible ? "visible" : "deferred"}
    />
  );
}
