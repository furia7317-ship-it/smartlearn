/**
 * Next.js 配置。
 *
 * `output: "export"` —— 静态导出到 `out/`，供 Electron 桌面壳（electron/main.js 的
 * app://local 协议）直接当静态站加载。本工程没有 API 路由 / 中间件 / 动态服务端逻辑，
 * 全部数据走客户端 fetch 到后端 :8000（lib/api.ts），因此可纯静态导出。
 *
 * - trailingSlash: 每个路由产出 `route/index.html`，与 main.js 的 serve() 对「以 / 结尾
 *   → 追加 index.html」「无扩展名 → 回退 index.html」的处理对齐（app://local/desktop/ →
 *   out/desktop/index.html）。
 * - images.unoptimized: 静态导出不支持默认图片优化（next/image 需自带 loader），改为不优化
 *   直接输出 <img>。
 *
 * 注：web 端同样以此构建（SPA，客户端取数），不影响 `npm run dev` 开发。
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
};

export default nextConfig;
