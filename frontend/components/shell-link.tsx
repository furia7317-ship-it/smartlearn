"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/** 桌面壳路由前缀；web 壳为空串。 */
export const DESKTOP_BASE = "/desktop";

/** 当前外壳的路由前缀：`/desktop/*` → "/desktop"，其余（web）→ ""。 */
export function useShellBase(): string {
  const pathname = usePathname();
  if (pathname?.startsWith(DESKTOP_BASE)) return DESKTOP_BASE;
  return "";
}

/**
 * 把应用内绝对路径改写到指定外壳下。
 * 外链 / 锚点 / 相对路径原样返回；首页 "/" → 壳根。
 */
export function shellHref(base: string, href: string): string {
  if (!base || !href.startsWith("/")) return href;
  return href === "/" ? base : base + href;
}

type ShellLinkProps = Omit<ComponentProps<typeof NextLink>, "href"> & {
  href: string;
};

/**
 * next/link 的「外壳感知」替身：内部链接自动跟随当前外壳（web / 桌面），
 * 同一个共享页在两套外壳下点击都不会跳错壳。
 * 用法：`import { ShellLink as Link } from "@/components/shell-link"`，JSX 照旧。
 */
export function ShellLink({ href, ...props }: ShellLinkProps) {
  const base = useShellBase();
  return <NextLink href={shellHref(base, href)} {...props} />;
}
