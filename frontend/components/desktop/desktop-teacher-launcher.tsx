"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import {
  ArrowUp,
  Loader2,
  MessageCircle,
  Minimize2,
  X,
} from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { cn } from "@/lib/utils";

const VoiceCallControl = dynamic(
  () => import("@/components/voice-call-control").then((module) => module.VoiceCallControl),
  { ssr: false },
);

export function DesktopTeacherLauncher() {
  const session = useOrchestratorContext();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, session.messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || session.running || session.mode !== "live") return;
    setDraft("");
    session.send(text);
  };

  return (
    <div className="fixed bottom-1 right-5 z-50">
      {open ? (
        <section
          role="dialog"
          aria-label="询问智能教师"
          className="relative flex h-[min(560px,calc(100dvh-96px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[#cdbb9f] bg-[#fffaf1] shadow-[0_24px_70px_rgba(50,35,18,0.28)]"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#dfd0ba] px-4">
            <span className="grid size-8 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1]">
              <MessageCircle className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-[#332719]">智能教师</h2>
              <p className="truncate text-[10px] text-[#786650]">
                {session.running ? "正在回答…" : "随时询问当前学习内容"}
              </p>
            </div>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]"
              onClick={() => setOpen(false)}
              aria-label="收起智能教师"
              title="收起为悬浮按钮"
            >
              <Minimize2 className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-[#786650] hover:bg-[#eee4d5]"
              onClick={() => setOpen(false)}
              aria-label="关闭智能教师"
            >
              <X className="size-4" aria-hidden />
            </button>
          </header>

          <div
            ref={scrollRef}
            className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            aria-live="polite"
          >
            {session.messages.length === 0 && (
              <div className="grid min-h-56 content-center text-center">
                <MessageCircle className="mx-auto size-7 text-[#9b6b2d]" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-[#332719]">现在想弄懂什么？</p>
              </div>
            )}
            {session.messages.slice(-8).map((message) => (
              <article
                key={message.id}
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap text-xs leading-5",
                  message.role === "user"
                    ? "ml-auto rounded-xl bg-[#4f351a] px-3 py-2.5 text-[#fffaf1]"
                    : "border-l-2 border-[#c99b60] pl-3 text-[#443521]",
                )}
              >
                {message.content || (message.role === "assistant" && session.running ? "正在思考…" : "")}
              </article>
            ))}
            {session.running && (
              <p className="flex items-center gap-2 text-[11px] text-[#786650]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                智能教师正在组织回答
              </p>
            )}
          </div>

          <div className="shrink-0 border-t border-[#dfd0ba] bg-white/55 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-[#d5c3a8] bg-white px-2.5 py-2 focus-within:ring-2 focus-within:ring-[#c59a62]/30">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder={session.mode === "live" ? "询问智能教师…" : "学习服务暂不可用"}
                disabled={session.mode !== "live"}
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-[#332719] outline-none placeholder:text-[#9a8a75] disabled:cursor-not-allowed"
              />
              <VoiceCallControl
                compact
                surfaceMode="inline"
                messages={session.messages}
                running={session.conversationRunning}
                enabled={session.mode === "live"}
                onSend={session.send}
                onStop={session.stop}
                onNewConversation={() => {
                  session.newConversation();
                }}
                resources={session.resources}
              />
              <button
                type="button"
                onClick={submit}
                disabled={!draft.trim() || session.conversationRunning || session.mode !== "live"}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[#3a2a18] text-[#fffaf1] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="发送问题"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group inline-flex h-28 min-w-[330px] items-center gap-3.5 rounded-2xl border border-[#d7c5a9] bg-[#fffaf1]/95 px-4 text-[#332719] shadow-[0_14px_36px_rgba(50,35,18,0.22)] backdrop-blur transition hover:-translate-y-0.5 hover:border-[#b68a52] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c59a62] focus-visible:ring-offset-2"
          aria-label="询问智能教师"
          title="询问智能教师"
        >
          <Image
            src="/brand/xueshu-app-icon.png"
            alt=""
            width={68}
            height={68}
            loading="eager"
            className="size-16 rounded-full border border-[#d7c5a9] object-cover"
          />
          <span className="min-w-0 flex-1 text-left leading-tight">
            <strong className="block text-sm">智能教师</strong>
            <small className="mt-2 block rounded-lg border border-[#ddcfbc] bg-white/60 px-3 py-2 text-xs text-[#786650]">问一道题</small>
          </span>
          <MessageCircle className="size-5 text-[#8c5b25]" aria-hidden />
        </button>
      )}
    </div>
  );
}
