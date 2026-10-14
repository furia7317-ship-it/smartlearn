import { ApiRequestError, requireOk } from "./api-error.ts";
import type { SkillDetail, SkillSummary } from "./procedure-skill-model.ts";

interface ClientOptions {
  apiBase: string;
  getStudentId: () => string;
  fetch?: typeof globalThis.fetch;
}

/** No response is shared across accounts or cached beyond its mounted view. */
export function createProcedureSkillsClient(options: ClientOptions) {
  const fetcher = options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  async function request<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const studentId = options.getStudentId();
    const query = body ? "" : `?${new URLSearchParams({ student_id: studentId })}`;
    const timeout = AbortSignal.timeout(path.endsWith("/evaluate") ? 120_000 : 20_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await fetcher(`${options.apiBase}/api/procedure-skills${path}${query}`, {
        method: body ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        signal: requestSignal,
        ...(body ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, student_id: studentId }),
        } : {}),
      });
      if (options.getStudentId() !== studentId) throw new Error("账户已切换，请重新打开教学方法。");
      await requireOk(response);
      const result = await response.json() as T;
      if (options.getStudentId() !== studentId) throw new Error("账户已切换，请重新打开教学方法。");
      return result;
    } catch (error) {
      if (timeout.aborted && !signal?.aborted) {
        throw new Error("请求超时，请刷新查看最新结果后再试。");
      }
      if (error instanceof ApiRequestError) {
        if (error.status === 401) throw new Error("登录状态已失效，请重新登录后查看教学方法。");
        if (error.status === 403) throw new Error("当前账户不能修改此方法，请刷新查看最新状态。");
        if (error.status === 404) throw new Error(path
          ? "此方法不存在或已不可访问，请刷新列表。"
          : "当前学习服务暂不支持教学方法，请更新或重启服务后重试。");
      }
      throw error;
    }
  }
  return {
    list: (signal?: AbortSignal) => request<SkillSummary[]>("", undefined, signal),
    detail: (skillId: string, signal?: AbortSignal) => request<SkillDetail>(`/${encodeURIComponent(skillId)}`, undefined, signal),
    evaluate: (skillId: string, versionId: string, signal?: AbortSignal) => request<SkillDetail>(
      `/${encodeURIComponent(skillId)}/evaluate`, { version_id: versionId }, signal,
    ),
    activate: (skillId: string, versionId: string, signal?: AbortSignal) => request<SkillDetail>(
      `/${encodeURIComponent(skillId)}/activate`, { version_id: versionId }, signal,
    ),
    disable: (skillId: string, signal?: AbortSignal) => request<SkillDetail>(
      `/${encodeURIComponent(skillId)}/disable`, { disabled: true }, signal,
    ),
  };
}
