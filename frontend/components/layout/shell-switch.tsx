"use client";

import { useEffect, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { TeacherWindowProvider } from "@/components/desktop/teacher-window-provider";
import { AppShell } from "@/components/layout/app-shell";
import { DesktopShell } from "@/components/layout/desktop-shell";
import { OrchestratorProvider } from "@/components/orchestrator-provider";
import { PersistentBrowserHost } from "@/components/persistent-browser";
import { LearningReminderBridge } from "@/components/learning-reminder-bridge";
import { MaterialGeneratorProvider } from "@/hooks/use-material-generator";

function AuthLoadingScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background" aria-label="正在恢复登录状态">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        正在进入学枢
      </div>
    </main>
  );
}

function ApplicationProviders({ children }: { children: ReactNode }) {
  return (
    <OrchestratorProvider>
      <MaterialGeneratorProvider>
        <PersistentBrowserHost>{children}</PersistentBrowserHost>
        <LearningReminderBridge />
      </MaterialGeneratorProvider>
    </OrchestratorProvider>
  );
}

/**
 * 同一工程内拆 web / 桌面两套 UI：按路由前缀选外壳。
 * `/desktop/*` → 桌面壳（Electron 加载这套）；其余 → web 壳（浏览器）。
 * 二者共用 lib/hooks/后端，只是外壳与页面布局不同。
 */
export function ShellSwitch({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isMarketing = pathname === "/" || pathname === "";
  const isLogin = pathname === "/login" || pathname === "/login/";
  const isOnboarding = pathname === "/onboarding" || pathname === "/onboarding/";

  useEffect(() => {
    if (loading) return;
    if (isMarketing) return;
    if (isLogin) {
      if (user) {
        router.replace(
          user.onboarding_completed ? "/desktop" : "/onboarding?next=%2Fdesktop",
        );
      }
      return;
    }
    if (isOnboarding) {
      if (!user) router.replace("/login?next=%2Fdesktop");
      else if (user.onboarding_completed) router.replace("/desktop");
      return;
    }
    if (!user) {
      router.replace("/login?next=%2Fdesktop");
    }
    else if (!user.onboarding_completed) {
      router.replace("/onboarding?next=%2Fdesktop");
    }
  }, [isLogin, isMarketing, isOnboarding, loading, router, user]);

  if (isMarketing) return children;
  if (loading) return <AuthLoadingScreen />;
  if (isLogin) return user ? <AuthLoadingScreen /> : children;
  if (isOnboarding) {
    return user && !user.onboarding_completed ? children : <AuthLoadingScreen />;
  }
  if (!user || !user.onboarding_completed) return <AuthLoadingScreen />;

  if (pathname?.startsWith("/desktop")) {
    return (
      <ApplicationProviders key={user.id}>
        <TeacherWindowProvider>
          <DesktopShell>{children}</DesktopShell>
        </TeacherWindowProvider>
      </ApplicationProviders>
    );
  }
  return <ApplicationProviders key={user.id}><AppShell>{children}</AppShell></ApplicationProviders>;
}
