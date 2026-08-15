export class ApiRequestError extends Error {
  status: number;
  detail: string;
  code?: string;
  retryable?: boolean;
  actions?: string[];
  checkpoint?: unknown;

  constructor(
    status: number,
    detail: string,
    structured?: { code?: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown },
  ) {
    super(detail);
    this.name = "ApiRequestError";
    this.status = status;
    this.detail = detail;
    this.code = structured?.code;
    this.retryable = structured?.retryable;
    this.actions = structured?.actions;
    this.checkpoint = structured?.checkpoint;
  }
}

const NETWORK_FAILURE_PATTERN = /failed to fetch|fetch failed|networkerror|network request failed|load failed/i;

export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.detail;
  const message = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  if (NETWORK_FAILURE_PATTERN.test(message)) {
    return "与本地生成服务的连接中断；已完成内容会保留，请等待状态恢复后再重试";
  }
  return message || fallback;
}

type FastApiValidationIssue = {
  type?: unknown;
  loc?: unknown;
  msg?: unknown;
  ctx?: unknown;
};

const REQUEST_FIELD_LABELS: Record<string, string> = {
  material_types: "资料类型",
  days: "学习天数",
  daily_minutes: "每日学习时长",
  goal: "学习目标",
};

function formatValidationIssues(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  const messages = value
    .filter((item): item is FastApiValidationIssue => Boolean(item) && typeof item === "object")
    .map((issue) => {
      const location = Array.isArray(issue.loc)
        ? issue.loc.filter((part): part is string => typeof part === "string")
        : [];
      const field = location.at(-1) ?? "请求参数";
      const label = REQUEST_FIELD_LABELS[field] ?? field;
      const context = issue.ctx && typeof issue.ctx === "object"
        ? issue.ctx as Record<string, unknown>
        : {};

      if (issue.type === "too_long" && typeof context.max_length === "number") {
        const actual = typeof context.actual_length === "number"
          ? `，当前为 ${context.actual_length} 项`
          : "";
        return `${label}最多可选 ${context.max_length} 项${actual}`;
      }
      if (issue.type === "literal_error") {
        return `${label}包含暂不支持的选项`;
      }
      return typeof issue.msg === "string" && issue.msg.trim()
        ? `${label}：${issue.msg.trim()}`
        : null;
    })
    .filter((message): message is string => Boolean(message));

  return messages.length > 0 ? messages.join("；").slice(0, 240) : null;
}

export async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;

  let detail = `HTTP ${response.status}`;
  let structured: { code?: string; retryable?: boolean; actions?: string[]; checkpoint?: unknown } | undefined;
  try {
    const payload = (await response.clone().json()) as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      detail = payload.detail.trim().slice(0, 240);
    } else if (Array.isArray(payload.detail)) {
      detail = formatValidationIssues(payload.detail) ?? detail;
    } else if (payload.detail && typeof payload.detail === "object") {
      const validation = payload.detail as {
        code?: unknown;
        message?: unknown;
        retryable?: unknown;
        actions?: unknown;
        checkpoint?: unknown;
        errors?: unknown;
      };
      if (typeof validation.code === "string") {
        structured = {
          code: validation.code,
          retryable: validation.retryable === true,
          actions: Array.isArray(validation.actions)
            ? validation.actions.filter((action): action is string => typeof action === "string")
            : [],
          checkpoint: validation.checkpoint,
        };
        detail = typeof validation.message === "string" ? validation.message : "请求未能完成";
      } else if (Array.isArray(validation.errors)) {
        detail = validation.errors.map(String).join("；").slice(0, 240);
      }
    }
  } catch {
    const text = await response.text().catch(() => "");
    if (text.trim()) detail = text.trim().slice(0, 240);
  }
  throw new ApiRequestError(response.status, detail, structured);
}
