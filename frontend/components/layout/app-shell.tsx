"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Bot,
  ClipboardCheck,
  Code2,
  Library,
  LoaderCircle,
  LogOut,
  Moon,
  PencilRuler,
  Route,
  Settings,
  Sparkles,
  Sun,
  Video,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useAuth } from "@/components/auth-provider";
import { BrandLockup } from "@/components/layout/brand-lockup";
import { WebPageTransition } from "@/components/layout/web-page-transition";
import { Button } from "@/components/ui/button";
import { getUserSettings, onUserSettingsChange } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/app", label: "学习总览", icon: BookMarked },
  { href: "/studio", label: "智能教师", icon: Bot },
  { href: "/create", label: "资源生成", icon: Wand2 },
  { href: "/agents", label: "我的智能体", icon: Sparkles },
  { href: "/path", label: "总学习路径", icon: Route },
  { href: "/resources", label: "资源中心", icon: Library },
  { href: "/practice", label: "练习错题", icon: PencilRuler },
  { href: "/kb", label: "知识库", icon: ClipboardCheck },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="切换主题"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="web-utility-button"
    >
      {mounted && resolvedTheme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}

function UserLink() {
  const [settings, setSettings] = useState({ name: "", major: "", grade: "" });

  useEffect(() => {
    const sync = () => setSettings(getUserSettings());
    sync();
    return onUserSettingsChange(sync);
  }, []);

  const name = settings.name || "李同学";

  return (
    <Link href="/profile" className="web-user-link" aria-label="查看学习画像">
      <span>{name.slice(0, 1)}</span>
      <strong>{name}</strong>
    </Link>
  );
}

function LogoutButton() {
  const { logout } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  return (
    <button
      type="button"
      className="web-utility-button"
      aria-label="退出 Web 登录"
      title="退出登录"
      disabled={submitting}
      onClick={async () => {
        if (submitting) return;
        setSubmitting(true);
        await logout();
        window.location.assign("/");
      }}
    >
      {submitting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
    </button>
  );
}

function NavLink({
  item,
  active,
}: {
  item: (typeof NAV)[number];
  active: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("web-nav-link", active && "is-active")}
    >
      <Icon className="size-3.5" aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname.startsWith(href);

  return (
    <div className="web-scope">
      <header className="web-topbar">
        <BrandLockup />
        <nav className="web-topnav" aria-label="主导航">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(item.href)} />
          ))}
        </nav>
        <div className="web-topbar__tools">
          <span className="web-live-dot" title="学习服务在线" aria-label="学习服务在线" />
          <Link
            href="/code-lab"
            className={cn("web-utility-button", isActive("/code-lab") && "is-active")}
            aria-label="代码挑战"
            title="代码挑战"
          >
            <Code2 className="size-4" />
          </Link>
          <Link
            href="/video-learning"
            className={cn("web-utility-button", isActive("/video-learning") && "is-active")}
            aria-label="视频学习"
            title="视频学习"
          >
            <Video className="size-4" />
          </Link>
          <ThemeToggle />
          <Link
            href="/settings"
            className={cn("web-utility-button", isActive("/settings") && "is-active")}
            aria-label="设置"
          >
            <Settings className="size-4" />
          </Link>
          <UserLink />
          <LogoutButton />
        </div>
      </header>

      <main className="web-main">
        <WebPageTransition>{children}</WebPageTransition>
      </main>
    </div>
  );
}
