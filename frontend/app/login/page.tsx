"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { AuthRequestError } from "@/lib/auth";
import { cn } from "@/lib/utils";


type AuthMode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { login, register, serviceError } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setConfirmation("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const normalizedAccount = account.trim();
    if (normalizedAccount.length < 3) {
      setError("请输入至少 3 个字符的用户名或邮箱");
      return;
    }
    if (password.length < 8) {
      setError("密码至少需要 8 个字符");
      return;
    }
    if (mode === "register" && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await (mode === "login"
        ? login(normalizedAccount, password)
        : register(normalizedAccount, password));
      router.replace("/desktop");
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : "账户服务暂时不可用，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#f5efe3] px-4 py-10 text-[#2d261b]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[#8b5b18]" />
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[430px]"
        aria-labelledby="auth-title"
      >
        <header className="mb-6 text-center">
          <Image
            src="/brand/xueshu-app-icon-128.webp"
            alt=""
            width={48}
            height={48}
            priority
            className="mx-auto size-12 rounded-xl border border-[#5f431b]/20 shadow-sm"
          />
          <h1 id="auth-title" className="mt-3 text-2xl font-semibold tracking-normal">学枢</h1>
          <p className="mt-1 text-sm text-[#756a59]">登录后继续你的学习安排</p>
        </header>

        <div className="rounded-lg border border-[#d8cbb7] bg-[#fffdf8] p-5 shadow-[0_18px_55px_rgba(58,43,23,0.09)] sm:p-6">
          <div className="grid grid-cols-2 rounded-md bg-[#eee5d6] p-1" role="tablist" aria-label="账户操作">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => switchMode(item)}
                className={cn(
                  "h-9 rounded-[5px] text-sm font-medium transition-colors",
                  mode === item ? "bg-[#fffdf8] text-[#332512] shadow-sm" : "text-[#756a59] hover:text-[#332512]",
                )}
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.form
              key={mode}
              onSubmit={submit}
              initial={reduceMotion ? false : { opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: 0.18 }}
              className="mt-5 space-y-4"
            >
              <label className="block text-sm font-medium">
                用户名或邮箱
                <span className="relative mt-1.5 block">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a7c67]" aria-hidden />
                  <input
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    autoComplete="username"
                    autoFocus
                    placeholder="输入用户名或邮箱"
                    className="h-11 w-full rounded-md border border-[#d8cbb7] bg-white pl-10 pr-3 text-sm outline-none transition focus:border-[#8b5b18] focus:ring-2 focus:ring-[#8b5b18]/15"
                  />
                </span>
              </label>

              <label className="block text-sm font-medium">
                密码
                <span className="relative mt-1.5 block">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8a7c67]" aria-hidden />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    placeholder="至少 8 个字符"
                    className="h-11 w-full rounded-md border border-[#d8cbb7] bg-white pl-10 pr-11 text-sm outline-none transition focus:border-[#8b5b18] focus:ring-2 focus:ring-[#8b5b18]/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-[#756a59] hover:bg-[#eee5d6]"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>

              {mode === "register" && (
                <label className="block text-sm font-medium">
                  确认密码
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    placeholder="再次输入密码"
                    className="mt-1.5 h-11 w-full rounded-md border border-[#d8cbb7] bg-white px-3 text-sm outline-none transition focus:border-[#8b5b18] focus:ring-2 focus:ring-[#8b5b18]/15"
                  />
                </label>
              )}

              {(error || serviceError) && (
                <p role="alert" className="rounded-md border border-[#b94a48]/25 bg-[#b94a48]/7 px-3 py-2 text-xs leading-relaxed text-[#983f3d]">
                  {error || serviceError}
                </p>
              )}

              <Button type="submit" disabled={submitting} className="h-11 w-full bg-[#3a2b17] text-[#fffaf0] hover:bg-[#4a371d]">
                {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                {submitting ? (mode === "login" ? "正在登录" : "正在创建账户") : (mode === "login" ? "登录" : "创建账户")}
              </Button>
            </motion.form>
          </AnimatePresence>
        </div>
      </motion.section>
    </main>
  );
}
