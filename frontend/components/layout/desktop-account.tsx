"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { UserAvatar } from "@/components/user-avatar";
import { DesktopSoundToggle } from "./desktop-sound-feedback";
import { REPLAY_GUIDE_EVENT } from "@/lib/welcome";
import { cn } from "@/lib/utils";
import accountStyles from "./desktop-account.module.css";

export function DesktopAccount({ name: displayName, profileHref = "/desktop/profile", settingsHref = "/desktop/settings", settingsLabel = "目标与设置", showGuide = true }: {
  name: string; profileHref?: string; settingsHref?: string; settingsLabel?: string; showGuide?: boolean;
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const accountActive = pathname.startsWith(profileHref) || pathname.startsWith(settingsHref);
  return (
        <div className={cn("desktop-rail-account", accountStyles.account)}>
          <Link
            href={profileHref}
            className={cn("desktop-rail-profile", accountStyles.profile, accountActive && "is-active")}
            aria-label="打开个人主页"
            data-guide="profile"
          >
            <UserAvatar userId={user?.id} name={displayName} size={34} fallback="mascot" />
            <span className="desktop-rail-account__copy">
              <strong>{displayName}</strong>
              <small>个人主页</small>
            </span>
          </Link>
          <details key={pathname} className={accountStyles.controls}>
            <summary className={accountStyles.toggle} aria-label="打开账号菜单" title="账号设置与音效">
              <ChevronDown aria-hidden className="size-4" />
            </summary>
          <div className="desktop-rail-account__menu">
            <Link href={settingsHref}>
              <Settings aria-hidden className="size-4" />
              {settingsLabel}
            </Link>
            <DesktopSoundToggle />
            {showGuide && <button type="button" onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              window.dispatchEvent(new Event(REPLAY_GUIDE_EVENT));
            }}>使用手册与新手引导</button>}
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              <LogOut aria-hidden className="size-4" />
              退出登录
            </button>
          </div>
          </details>
        </div>
  );
}
