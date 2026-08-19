import type { NextConfig } from "next";

/**
 * 静态导出（output: "export"）→ out/ 纯静态站，供两种交付：
 *   1. Electron 桌面壳（app:// 协议加载 out/，离线双击即用）
 *   2. nginx / 对象存储 / 内网静态托管
 * 前端为纯 client 组件、无服务端特性，可安全静态化。
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  allowedDevOrigins: ["127.0.0.1", "172.24.20.109"],
  devIndicators: false,
};

export default nextConfig;
