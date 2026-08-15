/** 全局用户学情设置：localStorage 持久化 + 同窗口实时同步（自定义事件）。 */

export interface UserSettings {
  name: string;
  major: string;
  grade: string;
}

const KEYS = { name: "sl_name", major: "sl_major", grade: "sl_grade" } as const;
const EVENT = "sl-settings-changed";
export const DEFAULT_GRADE = "大二上";

export const GRADES = [
  "大一上", "大一下",
  "大二上", "大二下",
  "大三上", "大三下",
  "大四上", "大四下",
  "研一上", "研一下",
  "研二上", "研二下",
  "研三上", "研三下",
  "博士",
];

const LEGACY_GRADE_PATTERN = /^(大[一二三四]|研[一二三])$/;

/** Keep old profiles usable while making the semester explicit in new UI. */
export function normalizeGrade(value: string | null | undefined): string {
  const grade = (value || "").trim();
  if (GRADES.includes(grade)) return grade;
  if (LEGACY_GRADE_PATTERN.test(grade)) return `${grade}上`;
  return DEFAULT_GRADE;
}

export function isUndergraduateGrade(grade: string): boolean {
  return grade.startsWith("大");
}

export function getUserSettings(): UserSettings {
  if (typeof window === "undefined") return { name: "", major: "", grade: DEFAULT_GRADE };
  return {
    name: localStorage.getItem(KEYS.name) || "",
    major: localStorage.getItem(KEYS.major) || "",
    grade: normalizeGrade(localStorage.getItem(KEYS.grade)),
  };
}

export function setUserSettings(patch: Partial<UserSettings>): void {
  if (typeof window === "undefined") return;
  if (patch.name !== undefined) localStorage.setItem(KEYS.name, patch.name);
  if (patch.major !== undefined) localStorage.setItem(KEYS.major, patch.major);
  if (patch.grade !== undefined) localStorage.setItem(KEYS.grade, patch.grade);
  window.dispatchEvent(new Event(EVENT));
}

/** 订阅设置变化（返回取消订阅函数）。 */
export function onUserSettingsChange(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
