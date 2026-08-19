declare module "page-flip" {
  export type PageFlipCorner = "top" | "bottom";

  export type PageFlipEvent<T = number | string | { page: number; mode: string }> = {
    data: T;
    object: PageFlip;
  };

  export type PageFlipOptions = {
    width: number;
    height: number;
    size?: "fixed" | "stretch";
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    startPage?: number;
  };

  export class PageFlip {
    constructor(container: HTMLElement, options: PageFlipOptions);
    loadFromHTML(pages: NodeListOf<HTMLElement> | HTMLElement[]): void;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    on<T = number | string | { page: number; mode: string }>(
      event: string,
      callback: (event: PageFlipEvent<T>) => void,
    ): PageFlip;
    destroy(): void;
  }
}
