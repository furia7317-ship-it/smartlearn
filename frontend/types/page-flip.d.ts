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
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
    startPage?: number;
  };

  export class PageFlip {
    constructor(container: HTMLElement, options: PageFlipOptions);
    loadFromHTML(pages: NodeListOf<HTMLElement> | HTMLElement[]): void;
    flipNext(corner?: PageFlipCorner): void;
    flipPrev(corner?: PageFlipCorner): void;
    flip(page: number, corner?: PageFlipCorner): void;
    turnToPage(page: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    getCurrentPageIndex(): number;
    getState(): "read" | "fold_corner" | "user_fold" | "flipping";
    off(event: string): void;
    on<T = number | string | { page: number; mode: string }>(
      event: string,
      callback: (event: PageFlipEvent<T>) => void,
    ): PageFlip;
    destroy(): void;
  }
}
