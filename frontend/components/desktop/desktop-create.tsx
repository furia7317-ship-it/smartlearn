"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import { ShellLink as Link } from "@/components/shell-link";
import { ArrowRight, BookOpen, BookOpenCheck, Check, CheckCircle2, ChevronDown, CircleHelp, Download, Feather, FileText, Layers, Library, Loader2, Settings2, Sparkles, Waves } from "lucide-react";
import { ResourceCenterBackButton } from "@/components/desktop/resource-center-back-button";
import { AgentRunInspector } from "@/components/agent-run-inspector";
import { ResourceViewer } from "@/components/resource-viewer";
import { ResourceConfigPopover, type ConfigAnchor } from "@/components/resource-config-popover";
import { useMaterialGenerator } from "@/hooks/use-material-generator";
import { downloadText, materialsToMarkdown } from "@/lib/export-materials";
import { FORM_MATERIAL_TYPES, MATERIAL_TYPE_LABEL } from "@/lib/material-types";
import { visibleGenerationResources } from "@/lib/resource-generation-state";
import { COLLABORATION_OPTIONS, DEFAULT_COLLABORATION, readCollaboration, writeCollaboration, type CollaborationOptions } from "@/lib/collaboration";
import type { ResourceItem } from "@/lib/types";
import s from "./desktop-create.module.css";

function subscribeToMode(listener: () => void) {
  window.addEventListener("sl-collaboration-change", listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener("sl-collaboration-change", listener); window.removeEventListener("storage", listener); };
}
const modeSnapshot = () => JSON.stringify(readCollaboration());
const initialModeSnapshot = () => JSON.stringify(DEFAULT_COLLABORATION);

function GenerationMode({ disabled, children }: { disabled: boolean; children?: ReactNode }) {
  const value = JSON.parse(useSyncExternalStore(subscribeToMode, modeSnapshot, initialModeSnapshot)) as CollaborationOptions;
  const [error, setError] = useState("");
  const update = (patch: Partial<CollaborationOptions>) => {
    try { writeCollaboration({ ...readCollaboration(), ...patch }); setError(""); }
    catch { setError("生成设置暂时无法保存，请稍后重试。"); }
  };
  return <fieldset className={`${s.formCard} ${s.modeCard}`} disabled={disabled}>
    <h2><Layers size={21} />生成模式</h2>
    <div className={s.modeTabs} role="group" aria-label="生成模式">{COLLABORATION_OPTIONS.filter(option => ["fast", "standard", "deep"].includes(option.value)).map(option => <button type="button" key={option.value} aria-pressed={value.effort === option.value} onClick={() => update({ effort: option.value })}>{option.label}</button>)}</div>
    <p className={s.modeDescription}>根据你的需求生成学习内容，支持多种资料类型</p>
    <div className={s.modeBenefits}><span><CheckCircle2 />内容贴合</span><span><CheckCircle2 />结构清晰</span><span><CheckCircle2 />多种形式</span></div>
    <details className={s.advanced}>
      <summary>更多生成设置{!["fast", "standard", "deep"].includes(value.effort) && ` · 当前${COLLABORATION_OPTIONS.find(option => option.value === value.effort)?.label}`}<ChevronDown size={14} /></summary>
      <label>完整模式<select aria-label="完整生成模式" value={value.effort} onChange={event => update({ effort: event.target.value as CollaborationOptions["effort"] })}>{COLLABORATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <div className={s.sourceOptions}>{([["course", "课程知识库"], ["personal", "我的资料"], ["web", "联网补充"]] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={value.sources[key]} onChange={event => update({ sources: { ...readCollaboration().sources, [key]: event.target.checked } })} />{label}</label>)}</div>
      <label>任务安排<select aria-label="任务安排" value={value.preference} onChange={event => update({ preference: event.target.value as CollaborationOptions["preference"] })}><option value="auto">自动安排</option><option value="parallel">优先并行</option><option value="staged">优先分阶段</option></select></label>
      {children}
    </details>
    {error && <p className={s.error} role="alert">{error}</p>}
  </fieldset>;
}

export default function DesktopCreate({ embedded = false, onTeacherRequested }: { embedded?: boolean; onTeacherRequested?: () => void }) {
  const g = useMaterialGenerator();
  const [floatingResource, setFloatingResource] = useState<ResourceItem | null>(null);
  const openItem = embedded ? floatingResource : g.openItem;
  const setOpenItem = embedded ? setFloatingResource : g.setOpenItem;
  const [cfg, setCfg] = useState<ConfigAnchor | null>(null);
  const fieldId = useId();
  const hasQuiz = g.selected.has("quiz") || g.selected.has("solution");
  const readyResources = g.resources.filter(resource => resource.status === "ready");
  const visibleResources = visibleGenerationResources(g.resources);
  const hasActivity = g.running || g.done || Boolean(g.activeAgentRun) || g.resources.length > 0;
  const streams = Object.entries(g.outputStreams).filter(([, value]) => Boolean(value));
  const onExport = () => downloadText(`${g.topic.trim() || "资源生成"}.md`, materialsToMarkdown(readyResources));

  return <div className={`${s.page} ${embedded ? s.floating : ""} thin-scroll`} data-desktop-scroll-memory={embedded ? undefined : "create"}><div className={s.frame}>
    {!embedded && <header className={s.pageHeader}>
      <ResourceCenterBackButton /><h1>资源生成</h1>
      <details className={s.help}><summary><CircleHelp size={17} />使用指南</summary><div><h2>准备一份适合你的学习资源</h2><ol><li>填写主题、知识点和学习要求。</li><li>选择生成模式，可同时选择多种资料。</li><li>点击“开始生成”，在右侧查看实时进度。</li><li>完成后打开资源阅读，也可以导出或回到资源中心。</li></ol></div></details>
    </header>}
    <div className={s.workspace}>
      <aside className={s.formColumn} aria-label="资源生成设置">
        <GenerationMode disabled={g.running}>{g.assessments.length > 0 && <label>参考已有学情<select aria-label="参考已有学情" disabled={g.running} value={g.assessmentId} onChange={event => g.setAssessmentId(event.target.value)}><option value="">不导入</option>{g.assessments.map(record => <option key={record.id} value={record.id}>{record.subject} · {record.self_level}</option>)}</select></label>}</GenerationMode>
        <section className={s.formCard}><label className={s.fieldLabel} htmlFor={`${fieldId}-topic`}><BookOpen size={22} />主题 / 科目<span>*</span></label><input id={`${fieldId}-topic`} value={g.topic} onChange={event => g.setTopic(event.target.value)} disabled={g.running} placeholder="如：数据结构、动态规划、计算机组成原理…" /></section>
        <section className={s.formCard}><label className={s.fieldLabel} htmlFor={`${fieldId}-knowledge`}><FileText size={21} />知识点与要求<span>*</span></label><textarea id={`${fieldId}-knowledge`} value={g.knowledge} onChange={event => g.setKnowledge(event.target.value)} disabled={g.running} rows={5} placeholder={"描述知识点与具体要求，例如：\n- 重点、难点与讲解方式\n- 适用的学习对象（如大一新生）\n- 希望包含的案例或其他要求"} /><p className={s.characterCount}>{g.knowledge.length} 字</p></section>
        <section className={s.formCard}>
          <h2><Layers size={22} />资料类型（可多选）</h2>
          <div className={s.materialTypes}>{FORM_MATERIAL_TYPES.map(type => {
            const active = g.selected.has(type.id);
            return <div key={type.id} className={s.typeControl} onContextMenu={event => { event.preventDefault(); if (!g.running) setCfg({ x: event.clientX, y: event.clientY, type: type.id }); }}>
              <button type="button" disabled={g.running} aria-pressed={active} title={type.desc} onClick={() => g.toggle(type.id)}><span className={s.checkbox}>{active && <Check size={13} />}</span>{type.label}</button>
              <button type="button" disabled={g.running} className={s.typeSettings} aria-label={`配置${type.label}生成参数`} title="配置生成参数" onClick={event => setCfg({ x: event.clientX, y: event.clientY, type: type.id })}><Settings2 size={14} /></button>
            </div>;
          })}</div>
          {hasQuiz && <button type="button" className={s.quizConfig} disabled={g.running} onClick={event => setCfg({ x: event.clientX, y: event.clientY, type: "quiz" })}><Settings2 size={15} />{g.quizTotal < 1 ? "请至少配置 1 道题" : `选择 ${g.quizConfig.choice} · 判断 ${g.quizConfig.judge} · 简答 ${g.quizConfig.short}`}<span>调整</span></button>}
        </section>
        <div className={s.submitArea}><button type="button" onClick={() => void g.run()} disabled={!g.canRun}>{g.running ? <><Loader2 className="animate-spin" size={22} />正在生成…</> : <>开始生成<ArrowRight size={25} /></>}</button>{g.mode === "offline" && <p role="status">学习服务暂未连接，连接恢复后即可生成。</p>}</div>
      </aside>
      <section className={s.output} aria-label="生成内容" data-active={hasActivity}>
        {!hasActivity && <Image src="/brand/resources/generator-study-scene-v1.webp" alt="" fill priority className={s.scene} sizes="(max-width: 900px) 100vw, 70vw" />}
        <header className={s.outputHeader}><div><h2><Sparkles size={21} />生成内容</h2><p>{hasActivity ? g.status || "生成过程和完成的资料都会显示在这里" : "根据左侧填写的内容，AI 将在此生成相应的学习资源"}</p></div>{readyResources.length > 0 && <button type="button" onClick={onExport}><Download size={16} />导出</button>}</header>
        {!hasActivity ? <>
          <p className={s.verse}>学而时习之<br />不亦说乎</p>
          <div className={s.welcome}><h2>在这里，生成属于你的学习资源</h2><p>填写左侧的主题、知识点与要求，<br />选择资料类型，点击「开始生成」，<br />AI 将为你准备适合的学习内容。</p><div className={s.features}>{[{ Icon: BookOpen, title: "内容贴合", detail: "围绕知识体系" }, { Icon: Waves, title: "结构清晰", detail: "循序理解掌握" }, { Icon: Feather, title: "多种形式", detail: "满足不同场景" }, { Icon: BookOpenCheck, title: "随学随用", detail: "积累学习成果" }].map(({ Icon, title, detail }) => <div key={title}><Icon size={27} /><strong>{title}</strong><small>{detail}</small></div>)}</div></div>
          <footer className={s.sceneFooter}>「博学而笃志，切问而近思。」<span>——《论语》</span></footer>
        </> : <div className={s.outputBody}>
          <section className={s.progress} aria-label="生成进度"><header><h3>{g.running && <Loader2 size={16} className="animate-spin" />}生成进度</h3><span>{readyResources.length} / {g.resources.length || g.selected.size} 项已完成</span></header>{g.activeAgentRun ? <div className={s.inspector}><AgentRunInspector run={g.activeAgentRun} /></div> : <p className={s.status} role="status">{g.status || "正在准备本次生成…"}</p>}</section>
          {streams.length > 0 && <details className={s.stream} open={g.running}><summary>生成中的内容<ChevronDown size={16} /></summary>{streams.map(([type, value]) => <section key={type}><h3>{MATERIAL_TYPE_LABEL[type] || type}</h3><pre className="thin-scroll">{value}</pre></section>)}</details>}
          {visibleResources.length > 0 && <section className={s.resultSection} aria-label="生成结果"><h3>本次生成的资源</h3><div className={s.resultGrid}>{visibleResources.map(resource => <article key={resource.id} className={s.resultCard}><header><FileText size={20} /><span>{MATERIAL_TYPE_LABEL[resource.type] || resource.type}</span>{resource.status === "ready" ? <CheckCircle2 size={17} /> : <Loader2 size={17} className="animate-spin" />}</header><h4>{resource.title}</h4><p>{resource.subtitle}</p><div className={s.resultMeta}>{resource.meta.map((meta, index) => <span key={index}>{meta}</span>)}</div><button type="button" disabled={resource.status !== "ready"} onClick={() => setOpenItem(resource)}>{resource.status === "ready" ? "打开资源" : "正在生成"}<ArrowRight size={16} /></button></article>)}</div></section>}
          {g.done && readyResources.length > 0 && <div className={s.success}><CheckCircle2 size={20} /><p>已生成 {readyResources.length} 项资源，随时回到资源中心继续学习。</p>{!embedded && <><Link href="/resources"><Library size={15} />资源中心</Link>{hasQuiz && <Link href="/practice">练习题库<ArrowRight size={15} /></Link>}</>}</div>}
          {g.done && readyResources.length === 0 && <p className={s.error} role="alert">{g.status || "本次未生成可用资源，请调整要求后重试。"}</p>}
        </div>}
      </section>
    </div>
  </div><ResourceViewer item={openItem} onClose={() => setOpenItem(null)} inTeacherTool={embedded} onTeacherRequested={onTeacherRequested} /><ResourceConfigPopover anchor={cfg} onClose={() => setCfg(null)} quizConfig={g.quizConfig} setQuizCount={g.setQuizCount} /></div>;
}
