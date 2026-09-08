"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpenText, CheckCircle2, PencilLine, Quote, Save } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { ShellLink as Link, shellHref, useShellBase } from "@/components/shell-link";
import { saveNote } from "@/lib/library";
import { clearNoteSourceDraft, readNoteSourceDraft, type NoteSourceDraft } from "@/lib/note-draft";

export function NoteWorkspace() {
  const session = useOrchestratorContext();
  const router = useRouter();
  const shellBase = useShellBase();
  const resourcesHref = shellHref(shellBase, "/resources?type=reading");
  const [draft, setDraft] = useState<NoteSourceDraft | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [knowledgePoints, setKnowledgePoints] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const source = readNoteSourceDraft();
    setDraft(source);
    if (source) setTitle(`${source.resourceTitle} · 段落笔记`);
  }, []);

  const submit = async () => {
    if (!draft || saving || saved) return;
    if (!title.trim() || content.trim().length < 2) {
      setError("请填写笔记标题和正文后再保存。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const material = await saveNote(session.mode, {
        resourceId: draft.resourceId,
        resourceTitle: draft.resourceTitle,
        title: title.trim(),
        selectedText: draft.selectedText,
        noteContent: content.trim(),
        knowledgePoints: knowledgePoints.trim(),
      });
      session.appendResources([material]);
      clearNoteSourceDraft();
      setSaved(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "笔记保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  if (draft === undefined) {
    return <div className="grid h-full place-items-center bg-[#f4efe5] text-sm text-[#796b58]">正在打开笔记页…</div>;
  }

  if (!draft) {
    return (
      <div className="grid h-full place-items-center bg-[#f4efe5] px-6">
        <section className="max-w-lg rounded-2xl border border-[#d8c7ad] bg-[#fffaf1] p-8 text-center shadow-[0_18px_60px_rgba(74,55,31,0.12)]">
          <BookOpenText className="mx-auto size-9 text-[#97642c]" />
          <h1 className="mt-4 text-xl font-semibold text-[#342719]">还没有选中的资料段落</h1>
          <p className="mt-2 text-sm leading-6 text-[#766550]">打开任意学习资料，选中一段正文，再点击“写笔记”。</p>
          <Link href={resourcesHref} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#43301c] px-4 py-2.5 text-sm text-[#fffaf1]">
            <ArrowLeft className="size-4" />返回资源中心
          </Link>
        </section>
      </div>
    );
  }

  if (saved) {
    return (
      <div className="grid h-full place-items-center bg-[#f4efe5] px-6">
        <section className="max-w-lg rounded-2xl border border-[#d6c2a4] bg-[#fffaf1] p-9 text-center shadow-[0_18px_60px_rgba(74,55,31,0.13)]">
          <CheckCircle2 className="mx-auto size-11 text-[#657d45]" />
          <h1 className="mt-4 text-2xl font-semibold text-[#342719]">笔记已放入资源中心</h1>
          <p className="mt-2 text-sm leading-6 text-[#766550]">它会作为“阅读”资料保存，并保留原始摘录与来源资料。</p>
          <button type="button" onClick={() => router.push(resourcesHref)} className="mt-6 rounded-lg bg-[#43301c] px-5 py-2.5 text-sm text-[#fffaf1]">打开资源中心</button>
        </section>
      </div>
    );
  }

  return (
    <main className="thin-scroll h-full overflow-y-auto bg-[#f4efe5] px-4 py-5 sm:px-8 sm:py-7">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d7c7ae] pb-5">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-[#986326]"><PencilLine className="size-4" />段落笔记</span>
            <h1 className="mt-2 text-3xl font-semibold text-[#2f2418]">把阅读时的想法留下来</h1>
          </div>
          <Link href={resourcesHref} className="inline-flex items-center gap-2 rounded-lg border border-[#cdbb9f] bg-[#fffaf1] px-3.5 py-2 text-sm text-[#5f4a32]"><ArrowLeft className="size-4" />返回资源中心</Link>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
          <aside className="self-start rounded-2xl border border-[#d5c2a5] bg-[#fff9ee] p-5 shadow-[0_12px_36px_rgba(78,57,30,0.08)] lg:sticky lg:top-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#594127]"><Quote className="size-4 text-[#a06b31]" />来源摘录</div>
            <p className="mt-3 text-xs text-[#8a7660]">《{draft.resourceTitle}》</p>
            <blockquote className="mt-4 border-l-2 border-[#b98a53] pl-4 text-sm leading-7 text-[#4e402f]">{draft.selectedText}</blockquote>
            <p className="mt-5 rounded-lg bg-[#f0e4d2] px-3 py-2 text-xs leading-5 text-[#755c3f]">摘录会和笔记一起保存，之后回看时仍能知道这段想法来自哪里。</p>
          </aside>

          <section className="rounded-2xl border border-[#d5c2a5] bg-[#fffdf7] p-5 shadow-[0_12px_36px_rgba(78,57,30,0.08)] sm:p-7">
            <label className="block text-xs font-semibold tracking-wide text-[#735637]">
              笔记标题
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-base font-medium text-[#352719] outline-none focus:border-[#a87539]" />
            </label>
            <label className="mt-5 block text-xs font-semibold tracking-wide text-[#735637]">
              我的笔记
              <textarea autoFocus value={content} onChange={(event) => setContent(event.target.value)} placeholder="写下你的理解、疑问、例子，或它与已有知识的联系…" className="mt-2 min-h-[330px] w-full resize-y rounded-lg border border-[#d5c2a5] bg-white px-4 py-3 text-[15px] leading-7 text-[#352719] outline-none focus:border-[#a87539]" />
            </label>
            <label className="mt-5 block text-xs font-semibold tracking-wide text-[#735637]">
              知识点（可选）
              <input value={knowledgePoints} onChange={(event) => setKnowledgePoints(event.target.value)} maxLength={1000} placeholder="例如：链表、时间复杂度" className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-2.5 text-sm text-[#352719] outline-none focus:border-[#a87539]" />
            </label>
            {error && <p role="alert" className="mt-4 rounded-lg border border-[#d7a28c] bg-[#fff1e9] px-3 py-2 text-sm text-[#8a3f28]">{error}</p>}
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-[#e4d8c6] pt-5">
              <span className="text-xs text-[#8a7660]">保存后会出现在资源中心的“阅读”分类中</span>
              <button type="button" onClick={() => void submit()} disabled={saving || session.mode === "checking"} className="inline-flex items-center gap-2 rounded-lg bg-[#43301c] px-5 py-2.5 text-sm font-medium text-[#fffaf1] disabled:cursor-not-allowed disabled:opacity-50"><Save className="size-4" />{saving ? "正在保存…" : "保存到资源中心"}</button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
