/** Personal teaching procedures. Approval and ownership are enforced by the API. */
export type SkillVersionStatus = "candidate" | "passed" | "rejected";
export type SkillStatus = SkillVersionStatus | "active" | "disabled";

export interface SkillDefinition {
  name: string;
  description: string;
  resource_types: string[];
  triggers: string[];
  steps: string[];
  checks: string[];
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version: number;
  definition: SkillDefinition;
  content_hash: string;
  status: SkillVersionStatus;
  validation: Record<string, unknown>;
  source_run_id: string;
  created_at: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  read_only: boolean;
  disabled: boolean;
  active_version_id: string | null;
  active_version: number | null;
  latest_version_id: string;
  latest_version: number;
  latest_version_status: SkillVersionStatus;
  status: SkillStatus;
  resource_types: string[];
  created_at: string;
  updated_at: string;
  usage_summary: { total: number; approved: number; failed: number };
}

export interface SkillDetail extends SkillSummary {
  versions: SkillVersion[];
  events: {
    id: string;
    event_type: string;
    actor_id: string;
    version_id: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }[];
}

export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  candidate: "待检查",
  passed: "检查通过",
  rejected: "未通过",
  active: "已启用",
  disabled: "已停用",
};

export const SKILL_RESOURCE_LABELS: Record<string, string> = {
  explainer: "知识讲解", mindmap: "思维导图", quiz: "练习题", reading: "阅读材料",
  code: "代码示例", video: "教学视频", courseware: "课件", interactive: "互动教学",
  solution: "题目解析",
};

export function skillVersionActions(skill: SkillDetail, version: SkillVersion) {
  const belongsToSkill = version.skill_id === skill.id && skill.versions.some((item) => item.id === version.id);
  const writable = !skill.read_only && belongsToSkill;
  const active = skill.active_version_id === version.id && !skill.disabled;
  return {
    active,
    evaluate: writable && !active,
    activate: writable && version.status === "passed" && !active &&
      version.validation.status === "passed" && version.validation.passed === true && version.validation.completed === true &&
      version.validation.content_hash === version.content_hash,
    disable: writable && Boolean(skill.active_version_id) && !skill.disabled,
    activationLabel: skill.disabled && skill.active_version_id === version.id
      ? "重新启用此版本"
      : version.version < skill.latest_version ? "切回此版本" : "启用此版本",
  };
}

export function preferredSkillVersion(skill: SkillDetail, selectedId = ""): SkillVersion | undefined {
  return skill.versions.find((version) => version.id === selectedId)
    ?? skill.versions.find((version) => version.id === skill.latest_version_id)
    ?? skill.versions[0];
}

export function skillDateLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "时间未记录";
}

export interface SkillCheckItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export function skillValidationView(validation: Record<string, unknown>) {
  const text = (value: unknown, limit = 800) => typeof value === "string" ? value.slice(0, limit) : "";
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const checks = (value: unknown): SkillCheckItem[] => !Array.isArray(value) ? [] : value.slice(0, 20).map((item) => {
    const check = record(item);
    return { id: text(check.id, 100), label: text(check.label, 150), passed: check.passed === true, detail: text(check.detail) };
  }).filter((item) => item.label);
  return {
    summary: text(validation.summary),
    unavailable: validation.status === "unavailable",
    completed: validation.completed === true,
    checks: checks(validation.deterministic_checks),
    cases: !Array.isArray(validation.scenario_results) ? [] : validation.scenario_results.slice(0, 12).map((item) => {
      const scenario = record(item);
      return { id: text(scenario.case_id, 100), title: text(scenario.title, 150), passed: scenario.passed === true, checks: checks(scenario.checks) };
    }).filter((item) => item.title),
    limitations: !Array.isArray(validation.limitations) ? [] : validation.limitations.slice(0, 6).map((item) => text(item)).filter(Boolean),
    evaluatedAt: text(validation.evaluated_at, 80),
  };
}
