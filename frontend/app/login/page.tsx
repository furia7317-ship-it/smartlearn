"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { SiteFiling } from "@/components/site-filing";
import { AuthRequestError } from "@/lib/auth";
import { WelcomeAnnouncement } from "@/components/welcome/welcome-announcement";
import { DEMO_ACCOUNT } from "@/lib/welcome";
import styles from "./login.module.css";


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
  const [sceneReady, setSceneReady] = useState(false);

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
      const signedIn = await (mode === "login"
        ? login(normalizedAccount, password)
        : register(normalizedAccount, password));
      router.replace(signedIn.onboarding_completed ? "/desktop" : "/onboarding");
    } catch (caught) {
      setError(caught instanceof AuthRequestError ? caught.message : "账户服务暂时不可用，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.scene}>
      <header className={styles.masthead}><span className={styles.seal}>学枢</span><span>AI 个性化学习平台</span></header>
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => setSceneReady(true)}
        className={styles.frame}
        aria-labelledby="auth-title"
      >
        <div className={styles.introduction}>
          <p className={styles.kicker}>一方书房 · 一程新知</p>
          <div className={styles.brandTitle}><h1 id="auth-title">学枢</h1><span>学而有方</span></div>
          <p className={styles.statement}>把每一次好奇，<br />写成自己的学问。</p>
          <p className={styles.introNote}>从一份学习计划，到真正掌握一个知识点。<br />让智能教师陪你，把理解慢慢变成能力。</p>
          <div className={styles.inscription}><span>知有所循</span><i /><span>学有所成</span></div>
        </div>
        <div className={styles.accountPanel}>
          <div className={styles.tabs} role="tablist" aria-label="账户操作">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`auth-tab-${item}`}
                aria-controls="auth-form"
                aria-selected={mode === item}
                tabIndex={mode === item ? 0 : -1}
                disabled={submitting}
                onClick={() => switchMode(item)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const nextMode = event.key === "Home" ? "login" : event.key === "End" ? "register" : item === "login" ? "register" : "login";
                  switchMode(nextMode);
                  document.getElementById(`auth-tab-${nextMode}`)?.focus();
                }}
                className={styles.tab}
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.form
              key={mode}
              id="auth-form"
              role="tabpanel"
              aria-labelledby={`auth-tab-${mode}`}
              onSubmit={submit}
              initial={reduceMotion ? false : { opacity: 0, y: 7 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
              transition={{ duration: 0.18 }}
              className={styles.form}
            >
              <div className={styles.formHeading}>
                <h2>{mode === "login" ? "欢迎回到书房" : "开启你的学习之旅"}</h2>
                <p>{mode === "login" ? "登录账号，继续上次的学习。" : "创建独立账号，从你的目标开始。"}</p>
              </div>
              <label className={styles.field}>
                用户名或邮箱
                <span className={styles.inputWrap}>
                  <input
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    autoComplete="username"
                    disabled={submitting}
                    placeholder="输入用户名或邮箱"
                    className={styles.input}
                  />
                </span>
              </label>

              <label className={styles.field}>
                密码
                <span className={styles.inputWrap}>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    disabled={submitting}
                    placeholder={mode === "login" ? "输入登录密码" : "设置至少 8 个字符的密码"}
                    className={`${styles.input} ${styles.passwordInput}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    className={styles.passwordToggle}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>

              {mode === "register" && (
                <label className={styles.field}>
                  确认密码
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="new-password"
                    disabled={submitting}
                    placeholder="再次输入密码"
                    className={styles.input}
                  />
                </label>
              )}

              {(error || serviceError) && (
                <p role="alert" className={styles.error}>
                  {error || serviceError}
                </p>
              )}

              <Button type="submit" disabled={submitting} className={styles.submit}>
                {submitting && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                {submitting ? (mode === "login" ? "正在登录" : "正在创建账户") : (mode === "login" ? "登录" : "创建账户")}
              </Button>
            </motion.form>
          </AnimatePresence>
          <p className={styles.formFootnote}>
            {mode === "login" ? <>
              初次来到学枢？
              <button type="button" className={styles.registerLink} disabled={submitting} onClick={() => switchMode("register")}>注册账号</button>
            </> : "你的学习记录与知识画像，会随学习逐步积累。"}
          </p>
        </div>
      </motion.section>
      <footer className={styles.footer}>
        <span>学枢 · 让知识成为自己的力量</span>
        <SiteFiling />
        <WelcomeAnnouncement ready={sceneReady || Boolean(reduceMotion)} onDemo={() => { switchMode("login"); setAccount(DEMO_ACCOUNT.login); setPassword(DEMO_ACCOUNT.password); setShowPassword(false); }} />
      </footer>
    </main>
  );
}
