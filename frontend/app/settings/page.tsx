"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  BookOpenCheck,
  Check,
  Cpu,
  GraduationCap,
  Monitor,
  Moon,
  Palette,
  Plus,
  SlidersHorizontal,
  Sun,
  Target,
  UserRound,
  Workflow,
} from "lucide-react";
import { useTheme } from "next-themes";

import { AgentMemorySettings } from "@/components/agent-memory-settings";
import { CustomAgentWorkspace } from "@/components/custom-agent-workspace";
import { LearningGoalsSettings } from "@/components/learning-goals-settings";
import { LearningPreferencesSettings } from "@/components/learning-preferences-settings";
import { PageHeader } from "@/components/layout/page-header";
import { ServiceDependencyCard } from "@/components/service-dependency-card";
import { ShellLink as Link } from "@/components/shell-link";
import { useOrchestratorContext } from "@/components/orchestrator-provider";
import { WorkflowStudio } from "@/components/workflow/workflow-studio";
import {
  createStarterWorkflow,
  DEFAULT_WORKFLOW,
  loadCustomWorkflows,
  type CustomWorkflow,
} from "@/lib/custom-workflows";
import {
  DEFAULT_GRADE,
  GRADES,
  getUserSettings,
  setUserSettings,
} from "@/lib/user-settings";
import { cn } from "@/lib/utils";

type SettingsSection =
  | "profile"
  | "preferences"
  | "goals"
  | "memory"
  | "services"
  | "advanced";

type AdvancedView = "overview" | "workflow" | "agents";

const SETTINGS_SECTIONS = [
  { id: "profile", label: "学情与外观", description: "学情资料和界面主题", Icon: SlidersHorizontal },
  { id: "preferences", label: "学习与 AI", description: "教学方式和学习默认值", Icon: BookOpenCheck },
  { id: "goals", label: "目标管理", description: "长期、中期与短期目标", Icon: Target },
  { id: "memory", label: "记忆与隐私", description: "查看和管理三重记忆", Icon: BrainCircuit },
  { id: "services", label: "模型与服务", description: "AI 能力和连接状态", Icon: Cpu },
] as const;

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const [advancedView, setAdvancedView] = useState<AdvancedView>("overview");
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([DEFAULT_WORKFLOW]);
  const [activeWorkflow, setActiveWorkflow] = useState<CustomWorkflow>(DEFAULT_WORKFLOW);
  const [name, setName] = useState("");
  const [major, setMajor] = useState("");
  const [grade, setGrade] = useState(DEFAULT_GRADE);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { mode } = useOrchestratorContext();

  useEffect(() => {
    setMounted(true);
    const settings = getUserSettings();
    setName(settings.name);
    setMajor(settings.major);
    setGrade(settings.grade);
    setWorkflows(loadCustomWorkflows(window.localStorage));
    return () => window.clearTimeout(timer.current);
  }, []);

  const persist = (patch: Partial<{ name: string; major: string; grade: string }>) => {
    setUserSettings(patch);
    setSaved(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1200);
  };

  const inputClassName =
    "h-11 w-full rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

  const openWorkflow = (workflow: CustomWorkflow) => {
    setActiveWorkflow(workflow);
    setAdvancedView("workflow");
  };

  const createWorkflow = () => {
    openWorkflow(createStarterWorkflow());
  };

  if (activeSection === "advanced" && advancedView === "workflow") {
    return (
      <WorkflowStudio
        initialWorkflow={activeWorkflow}
        onBack={() => setAdvancedView("overview")}
        onSaved={(savedWorkflow) => {
          setWorkflows((current) => {
            const index = current.findIndex((item) => item.id === savedWorkflow.id);
            if (index < 0) return [savedWorkflow, ...current];
            return current.map((item) =>
              item.id === savedWorkflow.id ? savedWorkflow : item,
            );
          });
        }}
      />
    );
  }

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="web-route-frame space-y-4">
        <PageHeader title="用户设置" desc="管理学情、学习目标、记忆隐私与 AI 服务">
          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-success" role="status">
              <Check className="size-3.5" />
              已自动保存
            </span>
          )}
        </PageHeader>

        <nav className="grid gap-2 rounded-xl border bg-card p-2 md:grid-cols-3 xl:grid-cols-5" aria-label="设置分类">
          {SETTINGS_SECTIONS.map(({ id, label, description, Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  setActiveSection(id);
                }}
                className={cn(
                  "flex min-w-0 items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "border-primary/40 bg-primary/[0.08] text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-surface-2")}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-sm">{label}</strong>
                  <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">{description}</span>
                </span>
              </button>
            );
          })}
        </nav>

        {activeSection === "profile" && (
          <div className="settings-page-grid">
            <section className="space-y-4 rounded-xl border bg-card">
              <div className="flex items-start gap-2">
                <UserRound className="mt-0.5 size-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">学情资料</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">修改后即时生效，并用于荐书、讲解、测验和学习路径。</p>
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">昵称</span>
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    persist({ name: event.target.value });
                  }}
                  placeholder="如：李同学"
                  className={inputClassName}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <GraduationCap className="size-3.5" />
                  专业
                </span>
                <input
                  value={major}
                  onChange={(event) => {
                    setMajor(event.target.value);
                    persist({ major: event.target.value });
                  }}
                  placeholder="如：软件工程 / 临床医学 / 法学"
                  className={inputClassName}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">年级与学期</span>
                <select
                  value={grade}
                  onChange={(event) => {
                    setGrade(event.target.value);
                    persist({ grade: event.target.value });
                  }}
                  className="h-11 w-40 rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {GRADES.map((item) => (
                    <option key={item} value={item} className="bg-card text-foreground">
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <p className="rounded-lg bg-surface-2/55 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                这些信息只用于调整学习内容的难度和方向。你可以随时修改；新的推荐会立即使用最新设置。
              </p>
              <Link href="/kb" className="inline-flex text-xs font-medium text-primary hover:underline">
                用当前学情去知识库荐书
              </Link>
            </section>

            <section className="space-y-4 rounded-xl border bg-card">
              <div className="flex items-start gap-2">
                <Palette className="mt-0.5 size-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold">外观</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">选择适合当前环境的界面主题。</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
                {([
                  { key: "system", label: "跟随系统", Icon: Monitor },
                  { key: "light", label: "浅色", Icon: Sun },
                  { key: "dark", label: "深色", Icon: Moon },
                ] as const).map(({ key, label, Icon }) => {
                  const active = mounted && theme === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTheme(key)}
                      className={cn(
                        "flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        active
                          ? "border-primary bg-primary/[0.08] text-foreground"
                          : "bg-surface-2/45 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {activeSection === "goals" && <LearningGoalsSettings mode={mode} />}
        {activeSection === "preferences" && <LearningPreferencesSettings />}
        {activeSection === "memory" && <AgentMemorySettings mode={mode} />}
        {activeSection === "services" && <ServiceDependencyCard />}
        {activeSection === "advanced" && advancedView === "overview" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
            <section className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-start gap-3 border-b p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Workflow className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold">智能体与工作流</h2>
                  <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
                    用可视化节点编排智能体、知识库、条件判断和质量审核，让多个 AI 角色协作完成学习任务。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={createWorkflow}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  <Plus className="size-3.5" />
                  新建工作流
                </button>
              </div>

              <div className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold">我的工作流</h3>
                  <span className="text-[11px] text-muted-foreground">
                    {workflows.length} 个工作流
                  </span>
                </div>
                <div className="grid gap-2">
                  {workflows.map((workflow) => (
                    <button
                      key={workflow.id}
                      type="button"
                      onClick={() => openWorkflow(workflow)}
                      className="group flex min-h-[76px] items-center gap-3 rounded-xl border bg-background/60 px-4 py-3 text-left transition hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                        <Workflow className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">{workflow.name}</strong>
                        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                          {workflow.description}
                        </span>
                      </span>
                      <span className="rounded-full border px-2 py-1 text-[10px] text-muted-foreground">
                        {workflow.status === "published" ? "已发布" : "草稿"}
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <section className="rounded-xl border bg-card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary">
                    <Bot className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold">我的智能体</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      创建专属 AI 角色，并把它作为节点放进任意工作流。
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdvancedView("agents")}
                  className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border bg-background text-xs font-semibold transition hover:border-primary/40 hover:bg-accent"
                >
                  管理智能体
                  <ArrowRight className="size-3.5" />
                </button>
              </section>

              <section className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">运行方式</span>
                  <strong>可视化节点编排</strong>
                </div>
                <div className="my-3 h-px bg-border" />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">连接状态</span>
                  <strong className={mode === "live" ? "text-success" : "text-warning"}>
                    {mode === "live" ? "学习服务已连接" : "离线预览"}
                  </strong>
                </div>
                <p className="mt-4 rounded-lg bg-surface-2/55 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  工作流草稿保存在当前设备；自建智能体由学习服务保存并执行。
                </p>
              </section>
            </div>
          </div>
        )}

        {activeSection === "advanced" && advancedView === "agents" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setAdvancedView("overview")}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              返回高级设置
            </button>
            <section className="rounded-xl border bg-card p-5">
              <CustomAgentWorkspace />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
