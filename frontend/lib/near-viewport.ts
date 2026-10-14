/** Observe once, including clipped/nested scroll containers; never poll scroll. */
export function observeNearViewport(
  element: Element,
  reveal: () => void,
  Observer: typeof IntersectionObserver | undefined = globalThis.IntersectionObserver,
): () => void {
  if (!Observer) {
    reveal();
    return () => {};
  }
  let active = true;
  const observer = new Observer((entries) => {
    if (!active || !entries.some((entry) => entry.isIntersecting)) return;
    active = false;
    observer.disconnect();
    reveal();
  }, { rootMargin: "120px 0px", threshold: 0 });
  observer.observe(element);
  return () => {
    active = false;
    observer.disconnect();
  };
}
