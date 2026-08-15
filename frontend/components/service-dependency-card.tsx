"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Cpu,
  LoaderCircle,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Trash2,
  X,
} from "lucide-react";

import { API_BASE, checkBackend } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DependencyInfo {
  id: string;
  display_name: string;
  capability: string;
  model: string;
  configured: boolean;
  available: boolean;
  config_hint: string;
}

interface LlmProviderInfo {
  id: string;
  name: string;
  base_url: string;
  model: string;
  configured: boolean;
  api_key_hint: string;
}

interface LlmConfig {
  current: string;
  providers: LlmProviderInfo[];
  dependencies: DependencyInfo[];
}

interface ProviderFormState {
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  clear_api_key: boolean;
}

type ServiceState = "checking" | "online" | "offline" | "degraded";
const HIDDEN_DEPENDENCY_IDS = new Set(["spark_avatar"]);

const emptyProviderForm: ProviderFormState = {
  name: "",
  base_url: "",
  model: "",
  api_key: "",
  clear_api_key: false,
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export function ServiceDependencyCard() {
  const [expanded, setExpanded] = useState(false);
  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [config, setConfig] = useState<LlmConfig | null>(null);
  const [message, setMessage] = useState("正在检查本地学习服务…");
  const [testing, setTesting] = useState("");
  const [switchingProvider, setSwitchingProvider] = useState("");
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [selectionMessage, setSelectionMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm);
  const [savingProvider, setSavingProvider] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const refresh = useCallback(async () => {
    setServiceState("checking");
    setMessage("正在检查本地学习服务…");
    const online = await checkBackend(3000);
    if (!online) {
      setServiceState("offline");
      setMessage("学习服务未连接，请启动本地后端服务后重试。");
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/config/llm`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as LlmConfig;
      setConfig(payload);
      const configuredProviders = payload.providers.filter((provider) => provider.configured).length;
      const unavailableServices = payload.dependencies.filter(
        (dependency) => !HIDDEN_DEPENDENCY_IDS.has(dependency.id) && !dependency.available,
      ).length;
      if (configuredProviders === 0) {
        setServiceState("degraded");
        setMessage("学习服务已连接，请先配置至少一个 OpenAI 兼容模型供应商。");
      } else if (unavailableServices > 0) {
        setServiceState("degraded");
        setMessage(`模型服务已就绪，另有 ${unavailableServices} 项独立 AI 能力尚未配置。`);
      } else {
        setServiceState("online");
        setMessage("AI 服务运行正常，已配置的能力均可使用。");
      }
    } catch (error) {
      setServiceState("degraded");
      setMessage(`学习服务已连接，但模型配置读取失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreateForm = () => {
    setEditingProvider(null);
    setProviderForm(emptyProviderForm);
    setFormOpen(true);
    setSelectionMessage("");
  };

  const openEditForm = (provider: LlmProviderInfo) => {
    setEditingProvider(provider.id);
    setProviderForm({
      name: provider.name,
      base_url: provider.base_url,
      model: provider.model,
      api_key: "",
      clear_api_key: false,
    });
    setFormOpen(true);
    setSelectionMessage("");
  };

  const closeProviderForm = () => {
    if (savingProvider) return;
    setFormOpen(false);
    setEditingProvider(null);
    setProviderForm(emptyProviderForm);
  };

  const saveProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingProvider) return;
    setSavingProvider(true);
    setSelectionMessage("正在保存供应商配置…");
    try {
      const isEditing = Boolean(editingProvider);
      const response = await fetch(
        isEditing
          ? `${API_BASE}/api/config/llm/providers/${encodeURIComponent(editingProvider || "")}`
          : `${API_BASE}/api/config/llm/providers`,
        {
          method: isEditing ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isEditing
            ? {
                ...providerForm,
                api_key: providerForm.api_key || null,
              }
            : {
                name: providerForm.name,
                base_url: providerForm.base_url,
                model: providerForm.model,
                api_key: providerForm.api_key,
              }),
        },
      );
      const payload = await response.json() as LlmConfig & { detail?: unknown };
      if (!response.ok) throw new Error(errorMessage(payload, `HTTP ${response.status}`));
      setConfig(payload);
      setFormOpen(false);
      setEditingProvider(null);
      setProviderForm(emptyProviderForm);
      setSelectionMessage(isEditing ? "供应商配置已更新，后续模型调用立即使用新配置。" : "供应商已添加，可以先测试连接再启用。");
    } catch (error) {
      setSelectionMessage(`保存失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSavingProvider(false);
    }
  };

  const testProvider = async (provider: LlmProviderInfo) => {
    if (!provider.configured || serviceState === "offline" || testing) return;
    setTesting(provider.id);
    setTestResults((previous) => ({ ...previous, [provider.id]: "正在发起真实连通测试…" }));
    try {
      const response = await fetch(
        `${API_BASE}/api/config/llm/test?provider=${encodeURIComponent(provider.id)}`,
        { method: "POST", credentials: "include" },
      );
      const payload = await response.json() as { status?: string; error?: string; reply?: string; detail?: unknown };
      if (!response.ok) throw new Error(errorMessage(payload, `HTTP ${response.status}`));
      setTestResults((previous) => ({
        ...previous,
        [provider.id]: payload.status === "ok"
          ? `连通成功${payload.reply ? `：${payload.reply}` : ""}`
          : `连通失败：${payload.error || "服务未返回原因"}`,
      }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [provider.id]: `连通失败：${error instanceof Error ? error.message : "未知错误"}`,
      }));
    } finally {
      setTesting("");
    }
  };

  const selectProvider = async (provider: LlmProviderInfo) => {
    if (!provider.configured || provider.id === config?.current || switchingProvider) return;
    setSwitchingProvider(provider.id);
    setSelectionMessage(`正在切换到${provider.name}…`);
    try {
      const response = await fetch(`${API_BASE}/api/config/llm/active`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      const payload = await response.json() as LlmConfig & { detail?: unknown };
      if (!response.ok) throw new Error(errorMessage(payload, `HTTP ${response.status}`));
      setConfig(payload);
      setSelectionMessage(`已启用${provider.name}；智能教师、学习路径和资料生成将统一使用该模型。`);
    } catch (error) {
      setSelectionMessage(`切换失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setSwitchingProvider("");
    }
  };

  const deleteProvider = async (provider: LlmProviderInfo) => {
    if (deletingProvider || provider.id === config?.current) return;
    if (deleteConfirm !== provider.id) {
      setDeleteConfirm(provider.id);
      return;
    }
    setDeletingProvider(provider.id);
    setSelectionMessage(`正在删除${provider.name}…`);
    try {
      const response = await fetch(
        `${API_BASE}/api/config/llm/providers/${encodeURIComponent(provider.id)}`,
        { method: "DELETE", credentials: "include" },
      );
      const payload = await response.json() as LlmConfig & { detail?: unknown };
      if (!response.ok) throw new Error(errorMessage(payload, `HTTP ${response.status}`));
      setConfig(payload);
      setSelectionMessage(`${provider.name}已删除。`);
    } catch (error) {
      setSelectionMessage(`删除失败：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      setDeletingProvider("");
      setDeleteConfirm("");
    }
  };

  const isHealthy = serviceState === "online";
  const StatusIcon = serviceState === "checking" ? LoaderCircle : isHealthy ? CheckCircle2 : CircleAlert;
  const providerCount = config?.providers.length || 0;
  const configuredProviderCount = config?.providers.filter((provider) => provider.configured).length || 0;
  const visibleDependencies = config?.dependencies.filter(
    (dependency) => !HIDDEN_DEPENDENCY_IDS.has(dependency.id),
  ) || [];
  const totalCount = providerCount + visibleDependencies.length;
  const availableCount = configuredProviderCount + visibleDependencies.filter((dependency) => dependency.available).length;
  const inputClass = "mt-1.5 h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby="service-dependencies-title">
      <div className="flex flex-wrap items-start gap-3">
        <Server className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="service-dependencies-title" className="text-sm font-semibold">模型与服务</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            自行添加任意 OpenAI 兼容供应商；所有默认 AI 流程统一使用当前启用项。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={serviceState === "checking"}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-accent disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", serviceState === "checking" && "animate-spin")} aria-hidden />
          重新检查
        </button>
      </div>

      <div
        className={cn(
          "mt-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-xs leading-relaxed",
          isHealthy
            ? "border-success/30 bg-success/10 text-success"
            : serviceState === "checking"
              ? "bg-surface-2/35 text-muted-foreground"
              : "border-warning/30 bg-warning/[0.07] text-foreground",
        )}
        role="status"
        aria-live="polite"
      >
        <StatusIcon className={cn("size-4 shrink-0", serviceState === "checking" && "animate-spin")} aria-hidden />
        <span className="min-w-0 flex-1">{message}</span>
        {totalCount > 0 && <strong className="whitespace-nowrap">可用 {availableCount} / {totalCount}</strong>}
      </div>

      {config && (
        <div className="mt-5" aria-labelledby="chat-provider-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="chat-provider-title" className="text-xs font-semibold">OpenAI 兼容模型供应商</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                配置保存在本机 SQLite；API Key 保存后只显示掩码，不会通过配置接口返回明文。
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-3.5" aria-hidden />新增供应商
            </button>
          </div>

          {formOpen && (
            <form onSubmit={(event) => void saveProvider(event)} className="mt-3 rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{editingProvider ? "编辑供应商" : "新增供应商"}</strong>
                <button type="button" onClick={closeProviderForm} aria-label="关闭供应商配置" className="rounded-md p-1 hover:bg-accent">
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-xs font-medium">
                  显示名称
                  <input required maxLength={80} value={providerForm.name} onChange={(event) => setProviderForm((value) => ({ ...value, name: event.target.value }))} placeholder="例如：我的 DeepSeek" className={inputClass} />
                </label>
                <label className="text-xs font-medium">
                  模型名称
                  <input required maxLength={160} value={providerForm.model} onChange={(event) => setProviderForm((value) => ({ ...value, model: event.target.value }))} placeholder="例如：deepseek-chat" className={inputClass} />
                </label>
                <label className="text-xs font-medium md:col-span-2">
                  Base URL
                  <input required type="url" maxLength={512} value={providerForm.base_url} onChange={(event) => setProviderForm((value) => ({ ...value, base_url: event.target.value }))} placeholder="https://api.example.com/v1" className={inputClass} />
                </label>
                <label className="text-xs font-medium md:col-span-2">
                  API Key
                  <input type="password" maxLength={4096} autoComplete="new-password" value={providerForm.api_key} onChange={(event) => setProviderForm((value) => ({ ...value, api_key: event.target.value, clear_api_key: false }))} placeholder={editingProvider ? "留空则保留当前密钥" : "输入供应商 API Key"} className={inputClass} />
                </label>
              </div>
              {editingProvider && (
                <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={providerForm.clear_api_key} onChange={(event) => setProviderForm((value) => ({ ...value, clear_api_key: event.target.checked, api_key: event.target.checked ? "" : value.api_key }))} />
                  清除已保存的 API Key
                </label>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={closeProviderForm} disabled={savingProvider} className="h-9 rounded-lg border px-4 text-xs font-medium hover:bg-accent disabled:opacity-60">取消</button>
                <button type="submit" disabled={savingProvider} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-60">
                  {savingProvider && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
                  {savingProvider ? "保存中…" : "保存配置"}
                </button>
              </div>
            </form>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="默认对话模型">
            {config.providers.map((provider) => {
              const isActive = config.current === provider.id;
              const isSwitching = switchingProvider === provider.id;
              return (
                <div key={provider.id} className={cn("rounded-xl border p-3", isActive ? "border-primary bg-primary/[0.06]" : "bg-surface-2/35")}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    onClick={() => void selectProvider(provider)}
                    disabled={!provider.configured || Boolean(switchingProvider)}
                    className="flex w-full items-start gap-2 text-left disabled:cursor-not-allowed"
                  >
                    {isActive ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> : <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{provider.name}</strong>
                        <code className="text-xs text-muted-foreground">{provider.model}</code>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground" title={provider.base_url}>{provider.base_url}</span>
                    </span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", isActive ? "bg-primary text-primary-foreground" : provider.configured ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                      {isSwitching ? "切换中…" : isActive ? "当前启用" : provider.configured ? "可选择" : "未配置"}
                    </span>
                  </button>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2.5">
                    <span className={cn("mr-auto text-xs", provider.configured ? "text-muted-foreground" : "text-danger")}>
                      {provider.configured ? `密钥 ${provider.api_key_hint}` : "请补全 API Key"}
                    </span>
                    <button type="button" onClick={() => void testProvider(provider)} disabled={!provider.configured || Boolean(testing)} className="rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-55">
                      {testing === provider.id ? "测试中…" : "测试连接"}
                    </button>
                    <button type="button" onClick={() => openEditForm(provider)} className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-accent">
                      <Pencil className="size-3" aria-hidden />编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteProvider(provider)}
                      disabled={isActive || Boolean(deletingProvider)}
                      title={isActive ? "请先切换到其他供应商" : deleteConfirm === provider.id ? "再次点击确认删除" : "删除供应商"}
                      className={cn("inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-45", deleteConfirm === provider.id ? "border-danger bg-danger/10 text-danger" : "bg-card hover:bg-accent")}
                    >
                      {deletingProvider === provider.id ? <LoaderCircle className="size-3 animate-spin" aria-hidden /> : <Trash2 className="size-3" aria-hidden />}
                      {deleteConfirm === provider.id ? "确认删除" : "删除"}
                    </button>
                  </div>
                  {testResults[provider.id] && <p className="mt-2 text-xs leading-5 text-muted-foreground">{testResults[provider.id]}</p>}
                </div>
              );
            })}
          </div>
          {config.providers.length === 0 && (
            <div className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">还没有模型供应商，请新增一个 OpenAI 兼容接入。</div>
          )}
          {selectionMessage && <p className="mt-3 rounded-lg border bg-surface-2/35 px-3 py-2 text-xs" role="status" aria-live="polite">{selectionMessage}</p>}
        </div>
      )}

      <div className="mt-5 border-t pt-4">
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? "收起高级信息" : "查看高级信息：TTS、PPT 和识别服务"}
        </button>
        {expanded && config && (
          <div className="mt-3 space-y-2" aria-label="运行依赖列表">
            {visibleDependencies.map((dependency) => {
              const statusLabel = dependency.available ? "可用" : dependency.configured ? "待接入" : "未配置";
              return (
                <div key={dependency.id} className="rounded-lg border bg-surface-2/35 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Cpu className="size-3.5 text-muted-foreground" aria-hidden />
                    <strong className="text-xs">{dependency.display_name}</strong>
                    <span className="text-xs text-muted-foreground">{dependency.capability}</span>
                    <code className="text-xs text-muted-foreground">{dependency.model}</code>
                    <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", dependency.available ? "bg-success/10 text-success" : dependency.configured ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>{statusLabel}</span>
                  </div>
                  <p className={cn("mt-1.5 text-xs leading-5", dependency.configured ? "text-muted-foreground" : "text-danger")}>
                    {dependency.available ? "配置已生效，可由对应生成流程直接调用。" : dependency.configured ? "凭据已配置，但安全的服务端调用链尚未启用。" : `未配置 ${dependency.config_hint}。在 backend/.env 填写后重启后端。`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
