/**
 * 讯飞 2D 虚拟人（数字人）接入层。
 *
 * - 安全策略：后端不向渲染进程下发长期 API Key/Secret，只签发约 5 分钟
 *   有效的 WebSocket URL；过期时重新请求即可。
 * - SDK：讯飞 `avatar-sdk-web`（IAvatarPlatform），静态托管于 `/public/vendor/avatar-sdk/`，
 *   运行时用原生动态 import 加载（绕开打包器，见 loadAvatarSdk）。
 */

import { API_BASE } from "./api";

export interface AvatarConfig {
  configured: boolean;
  appId: string;
  avatarId: string;
  sceneId: string;
  vcn: string;
  signedUrl: string;
  signedAt: string;
}

/** 取数字人配置；非 live 或未配齐返回 null。 */
export async function getAvatarConfig(
  mode: "checking" | "live" | "offline"
): Promise<AvatarConfig | null> {
  if (mode !== "live") return null;
  try {
    const res = await fetch(`${API_BASE}/api/avatar/config`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as AvatarConfig;
    return j.configured ? j : null;
  } catch {
    return null;
  }
}

/** 讯飞数字人平台实例最小类型（仅声明用到的成员）。 */
export interface AvatarPlatform {
  setApiInfo(info: Record<string, unknown>): AvatarPlatform;
  setGlobalParams(cfg: Record<string, unknown>): AvatarPlatform;
  start(props?: { wrapper?: HTMLElement }): Promise<void>;
  writeText(text: string, extend?: Record<string, unknown>): Promise<string>;
  interrupt(): Promise<void>;
  stop(): void;
  destroy(): void;
  on(type: string, listener: (...args: unknown[]) => void): unknown;
}
export type AvatarPlatformCtor = new (props?: Record<string, unknown>) => AvatarPlatform;

let sdkPromise: Promise<AvatarPlatformCtor> | null = null;

/**
 * 运行时加载讯飞数字人 SDK。SDK 是预打包 ESM + 内部相对分包，用 `new Function` 包一层
 * import 绕开 Next/Turbopack 的静态解析（否则会把 /vendor 当模块去解析而构建失败），
 * 交给浏览器原生 ESM 从 `/vendor/avatar-sdk/index.js` 加载（同目录相对分包可解析）。
 * web(dev) 与桌面(app://local 静态导出) 通用。
 */
export function loadAvatarSdk(): Promise<AvatarPlatformCtor> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    const dynImport = new Function("u", "return import(u)") as (
      u: string
    ) => Promise<{ default: AvatarPlatformCtor }>;
    const mod = await dynImport("/vendor/avatar-sdk/index.js");
    if (!mod?.default) throw new Error("数字人 SDK 加载失败");
    return mod.default;
  })();
  return sdkPromise;
}
