"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookCopy, Bot, Check, GitBranch, PackageOpen, Send, X } from "lucide-react";

import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { listCustomAgents, type CustomAgent } from "@/lib/custom-agents";
import { publishToMarket, subjectToMarketSnapshot, type MarketListing } from "@/lib/learning-market";
import { MATERIAL_TYPE_LABEL } from "@/lib/material-types";
import type { ResourceItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY_RESOURCE_IDS: string[] = [];

type PublishTarget = "resources" | "path" | "agent";

export function MarketPublishDialog({
  open,
  resources,
  initialResourceIds = EMPTY_RESOURCE_IDS,
  onClose,
  onPublished,
}: {
  open: boolean;
  resources: ResourceItem[];
  initialResourceIds?: string[];
  onClose: () => void;
  onPublished?: (listing: MarketListing) => void;
}) {
  const session = useOrchestratorContext();
  const [target, setTarget] = useState<PublishTarget>("resources");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPathId, setSelectedPathId] = useState("");
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const initializedOpenRef = useRef(false);
  const agentsRequestRef = useRef(0);

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    const validInitial = initialResourceIds.filter((id) => resources.some((item) => item.id === id));
    setTarget(validInitial.length ? "resources" : session.subjectPaths.length ? "path" : "resources");
    setSelectedIds(validInitial);
    setSelectedPathId(session.subjectPaths[0]?.id ?? "");
    setTitle(validInitial.length === 1
      ? resources.find((item) => item.id === validInitial[0])?.title ?? ""
      : validInitial.length > 1 ? `${validInitial.length} 份精选学习资料` : "");
    setDescription("");
    setTags("");
    setError("");
    // 智能体清单是异步的，但它的初始选中必须留在这个「每次打开只跑一次」的
    // 初始化里：写到独立 effect 会被 resources / subjectPaths 的依赖变化反复重置。
    setAgents([]);
    setSelectedAgentId("");
    const requestId = agentsRequestRef.current + 1;
    agentsRequestRef.current = requestId;
    // listCustomAgents 自己吞掉网络错误并在非 live 下返回 []，这里只需要防「弹窗已重开」的乱序回填。
    void listCustomAgents(session.mode).then((items) => {
      if (agentsRequestRef.current !== requestId) return;
      const publishable = items.filter((item) => item.status === "active");
      setAgents(publishable);
      setSelectedAgentId(publishable[0]?.id ?? "");
    });
  }, [initialResourceIds, open, resources, session.mode, session.subjectPaths]);

  const selectedResources = useMemo(
    () => selectedIds.map((id) => resources.find((item) => item.id === id)).filter((item): item is ResourceItem => Boolean(item)),
    [resources, selectedIds],
  );
  const selectedAgent = useMemo(
    () => agents.find((item) => item.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  if (!open) return null;

  const toggleResource = (id: string) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const publish = async () => {
    if (publishing) return;
    const path = session.subjectPaths.find((item) => item.id === selectedPathId);
    const agent = agents.find((item) => item.id === selectedAgentId);
    if (!title.trim()) {
      setError("请填写发布标题。");
      return;
    }
    if (target === "resources" && selectedResources.length === 0) {
      setError("请至少选择一份资料。");
      return;
    }
    if (target === "path" && !path) {
      setError("请选择一条学习路径。");
      return;
    }
    if (target === "agent" && !agent) {
      setError("请选择一个要分享的智能体。");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      const listing = await publishToMarket(session.mode, {
        kind: target === "agent"
          ? "agent"
          : target === "path" ? "learning_path" : selectedResources.length === 1 ? "material" : "bundle",
        title: title.trim(),
        description: description.trim(),
        tags: tags.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
        materialIds: target === "resources" ? selectedResources.map((item) => item.id) : [],
        pathSnapshot: target === "path" && path ? subjectToMarketSnapshot(path) : undefined,
        agentId: target === "agent" ? agent?.id : undefined,
      });
      onPublished?.(listing);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "发布失败，请稍后重试。");
    } finally {
      setPublishing(false);
    }
  };

  const chooseTarget = (next: PublishTarget) => {
    setTarget(next);
    if (next === "path") {
      const path = session.subjectPaths.find((item) => item.id === selectedPathId) ?? session.subjectPaths[0];
      if (path) setTitle(path.title);
    } else if (next === "agent") {
      const agent = agents.find((item) => item.id === selectedAgentId) ?? agents[0];
      if (agent) setTitle(agent.name);
    } else if (selectedResources.length === 1) {
      setTitle(selectedResources[0].title);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#2f271d]/45 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-label="发布到学习市场" className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#d5c1a2] bg-[#fffaf1] shadow-[0_28px_90px_rgba(43,31,18,0.34)]">
        <header className="flex items-start justify-between border-b border-[#ddcfbb] px-6 py-5">
          <div><span className="text-xs font-semibold tracking-[0.16em] text-[#986326]">社区共享</span><h2 className="mt-1 text-xl font-semibold text-[#342719]">发布到学习市场</h2><p className="mt-1 text-xs text-[#806d57]">只会上传你明确选中的已审核资料、路径快照或智能体定义。</p></div>
          <button type="button" onClick={onClose} aria-label="关闭" className="grid size-8 place-items-center rounded-lg text-[#766550] hover:bg-[#eee2d1]"><X className="size-4" /></button>
        </header>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-3">
            <button type="button" onClick={() => chooseTarget("resources")} className={cn("flex items-center gap-3 rounded-xl border p-4 text-left", target === "resources" ? "border-[#9d6a31] bg-[#f4e7d3]" : "border-[#ddcfbb] bg-white") }><PackageOpen className="size-5 text-[#986326]" /><span><strong className="block text-sm text-[#3c2c1b]">单份资料 / 资源包</strong><small className="text-xs text-[#806d57]">选择一份或多份一起发布</small></span></button>
            <button type="button" onClick={() => chooseTarget("path")} className={cn("flex items-center gap-3 rounded-xl border p-4 text-left", target === "path" ? "border-[#9d6a31] bg-[#f4e7d3]" : "border-[#ddcfbb] bg-white") }><GitBranch className="size-5 text-[#986326]" /><span><strong className="block text-sm text-[#3c2c1b]">学习路径</strong><small className="text-xs text-[#806d57]">以独立快照分享，不影响原路径</small></span></button>
            <button type="button" onClick={() => chooseTarget("agent")} className={cn("flex items-center gap-3 rounded-xl border p-4 text-left", target === "agent" ? "border-[#9d6a31] bg-[#f4e7d3]" : "border-[#ddcfbb] bg-white") }><Bot className="size-5 text-[#986326]" /><span><strong className="block text-sm text-[#3c2c1b]">自建智能体</strong><small className="text-xs text-[#806d57]">分享一份执行者定义，别人可直接指派</small></span></button>
          </div>

          {target === "agent" ? (
            <div className="mt-5">
              <label className="text-xs font-semibold text-[#735637]">选择智能体<select value={selectedAgentId} onChange={(event) => { setSelectedAgentId(event.target.value); const agent = agents.find((item) => item.id === event.target.value); if (agent) setTitle(agent.name); }} className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-sm text-[#352719]">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · 输出{MATERIAL_TYPE_LABEL[agent.output_type] ?? agent.output_type}</option>)}</select></label>
              {agents.length === 0 && <p className="mt-2 rounded-lg border border-dashed border-[#d7c7ae] p-4 text-sm text-[#806d57]">{session.mode === "live" ? "还没有可分享的自建智能体，先去「我的智能体」创建一个。" : "学习服务未连接，暂时读不到你的自建智能体。"}</p>}
              {selectedAgent && <p className="mt-3 rounded-lg border border-[#e0d2bd] bg-[#fdf7ec] px-3.5 py-3 text-xs leading-6 text-[#6f5c45]">职责：{selectedAgent.duty.trim() || "（未填写职责）"}<br />上架的是智能体定义快照，不包含你的资料与对话记录。</p>}
            </div>
          ) : target === "resources" ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-xs text-[#806d57]"><span>选择资料</span><span>已选 {selectedResources.length} 项</span></div>
              <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {resources.map((resource) => {
                  const selected = selectedIds.includes(resource.id);
                  return <button key={resource.id} type="button" onClick={() => toggleResource(resource.id)} className={cn("flex items-center gap-3 rounded-lg border px-3 py-3 text-left", selected ? "border-[#a87539] bg-[#f5e8d4]" : "border-[#dfd2bf] bg-white")}><span className={cn("grid size-5 shrink-0 place-items-center rounded border", selected ? "border-[#8d5b25] bg-[#8d5b25] text-white" : "border-[#cbb99f]")}>{selected && <Check className="size-3.5" />}</span><span className="min-w-0"><strong className="block truncate text-sm text-[#3c2c1b]">{resource.title}</strong><small className="text-xs text-[#8a7660]">{resource.type}</small></span></button>;
                })}
                {resources.length === 0 && <p className="col-span-2 rounded-lg border border-dashed border-[#d7c7ae] p-5 text-center text-sm text-[#806d57]">资源中心还没有可发布的已审核资料。</p>}
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <label className="text-xs font-semibold text-[#735637]">选择学习路径<select value={selectedPathId} onChange={(event) => { setSelectedPathId(event.target.value); const path = session.subjectPaths.find((item) => item.id === event.target.value); if (path) setTitle(path.title); }} className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-sm text-[#352719]">{session.subjectPaths.map((path) => <option key={path.id} value={path.id}>{path.title} · {path.path.length} 个阶段</option>)}</select></label>
              {session.subjectPaths.length === 0 && <p className="mt-2 rounded-lg border border-dashed border-[#d7c7ae] p-4 text-sm text-[#806d57]">目前没有可发布的学习路径。</p>}
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-semibold text-[#735637]">发布标题<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-sm text-[#352719] outline-none focus:border-[#a87539]" /></label>
            <label className="text-xs font-semibold text-[#735637]">标签（逗号分隔）<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="例如：期末复习，数据结构" className="mt-2 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-sm text-[#352719] outline-none focus:border-[#a87539]" /></label>
          </div>
          <label className="mt-4 block text-xs font-semibold text-[#735637]">分享说明<textarea value={description} maxLength={1200} onChange={(event) => setDescription(event.target.value)} placeholder="介绍它适合谁、解决什么学习问题…" className="mt-2 min-h-24 w-full rounded-lg border border-[#d5c2a5] bg-white px-3.5 py-3 text-sm leading-6 text-[#352719] outline-none focus:border-[#a87539]" /></label>
          {error && <p role="alert" className="mt-4 rounded-lg border border-[#d7a28c] bg-[#fff1e9] px-3 py-2 text-sm text-[#8a3f28]">{error}</p>}
        </div>
        <footer className="flex items-center justify-between gap-4 border-t border-[#ddcfbb] px-6 py-4"><span className="inline-flex items-center gap-2 text-xs text-[#806d57]"><BookCopy className="size-4" />发布的是副本，不会修改资源中心原内容</span><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-lg border border-[#cdbb9f] px-4 py-2 text-sm text-[#5f4a32]">取消</button><button type="button" onClick={() => void publish()} disabled={publishing || session.mode !== "live"} className="inline-flex items-center gap-2 rounded-lg bg-[#43301c] px-4 py-2 text-sm text-[#fffaf1] disabled:opacity-50"><Send className="size-4" />{publishing ? "发布中…" : "确认发布"}</button></div></footer>
      </section>
    </div>
  );
}
