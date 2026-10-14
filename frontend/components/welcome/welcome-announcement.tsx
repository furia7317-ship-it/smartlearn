"use client";

import { useEffect, useRef } from "react";
import { DEMO_ACCOUNT, WELCOME_NOTICE_VERSION } from "@/lib/welcome";
import styles from "./welcome.module.css";

const noticeKey = `sl_welcome_notice_${WELCOME_NOTICE_VERSION}`;

export function WelcomeAnnouncement({ onDemo, ready = true }: { onDemo: () => void; ready?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ready) return;
    let seen = false;
    try { seen = sessionStorage.getItem(noticeKey) === "read"; } catch { /* The notice remains dismissible. */ }
    if (!seen) dialogRef.current?.showModal();
  }, [ready]);
  const acknowledge = () => {
    try { sessionStorage.setItem(noticeKey, "read"); } catch { /* No storage is needed to sign in. */ }
  };
  const dismiss = () => { acknowledge(); dialogRef.current?.close(); };
  return <>
    <button type="button" className={styles.noticeLink} onClick={() => dialogRef.current?.showModal()}>公告与演示账号</button>
    <dialog ref={dialogRef} className={styles.notice} aria-labelledby="welcome-notice-title" onClose={acknowledge} onCancel={acknowledge}>
      <div className={styles.noticeArt}><span>学枢 · 评审演示说明</span><button type="button" aria-label="关闭公告" onClick={dismiss}>关闭</button></div>
      <div className={styles.noticeBody}>
        <h2 id="welcome-notice-title">欢迎各位评委老师使用学枢！</h2>
        <p className={styles.description}>本项目中的学习总结、学习画像分析、知识点掌握度与成长趋势等功能，需要学习记录作为判断依据。为方便各位评委老师完整体验项目，建议使用以下已积累学习数据的演示账号。</p>
        <section className={styles.demoCard} aria-labelledby="demo-account-title">
          <div><h3 id="demo-account-title">学生演示账号</h3><span>学习流程 · 知识图谱 · 代码可视化</span></div>
          <dl><div><dt>账号</dt><dd>{DEMO_ACCOUNT.login}</dd></div><div><dt>密码</dt><dd>{DEMO_ACCOUNT.password}</dd></div></dl>
          <p>保留了阶段学习记录，可查看学习画像与知识图谱，并打开插入排序资料观察逐行执行与数组变化。</p>
        </section>
        <p className={styles.noticeFootnote}>点击下方按钮即可填入演示账号。新账号的画像与分析会随学习、答题和实训逐步形成。</p>
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={dismiss}>自行输入账号</button>
          <button type="button" className={styles.primary} onClick={() => { onDemo(); dismiss(); }}>填入学生账号</button>
        </div>
      </div>
    </dialog>
  </>;
}
