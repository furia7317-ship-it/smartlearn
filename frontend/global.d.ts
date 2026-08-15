export {};

declare global {
  interface Window {
    /** 由 electron/preload.js 注入，仅桌面壳里存在。 */
    desktop?: {
      isDesktop?: boolean;
      electron?: string;
      chrome?: string;
      studentId?: string;
      apiBase?: string;
    };
  }
}
