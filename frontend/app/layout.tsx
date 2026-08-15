import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";

import { AuthProvider } from "@/components/auth-provider";
import { ShellSwitch } from "@/components/layout/shell-switch";

import "./globals.css";
import "./desk-study.css";
// KaTeX 官方样式（node_modules 第三方表）。Next 16 的 App Router 允许在 app/ 内任意
// 位置 import 外部包的 CSS（docs/01-app/01-getting-started/11-css.md → External
// stylesheets），字体经打包器改写成 /_next/static/media/*，output:"export" 下会被
// 一并产出到 out/，Electron 的 app:// 协议也能直读。放在 globals.css 之后，保证
// KaTeX 自身规则不被 Tailwind preflight 重置；globals.css 里的 .dark/.katex 覆盖块
// 靠更高特异性仍然生效。
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "学枢 — AI 个性化学习平台",
  description:
    "由 AI 智能教师统筹学习路径、资料与练习的个性化学习平台",
  icons: { icon: "/brand/xueshu-app-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <AuthProvider>
            <ShellSwitch>{children}</ShellSwitch>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
