import { API_BASE } from "./api";
import { requireOk } from "./api-error";
import { getStudentId } from "./student-identity";

export type TeachingMode = "direct" | "socratic" | "practice";
export type AnswerDepth = "concise" | "balanced" | "deep";
export type PreferredDifficulty = "foundation" | "balanced" | "challenge";

export interface LearnerPreferences {
  teaching_mode: TeachingMode;
  answer_depth: AnswerDepth;
  difficulty: PreferredDifficulty;
  daily_minutes: 20 | 40 | 60 | 90;
  material_types: string[];
  long_term_memory_enabled: boolean;
  reminder_enabled: boolean;
  reminder_time: string;
  updated_at?: string | null;
}

export const DEFAULT_LEARNER_PREFERENCES: LearnerPreferences = {
  teaching_mode: "direct",
  answer_depth: "balanced",
  difficulty: "balanced",
  daily_minutes: 40,
  material_types: ["explainer", "quiz"],
  long_term_memory_enabled: true,
  reminder_enabled: false,
  reminder_time: "20:00",
  updated_at: null,
};

const EVENT_NAME = "xueshu-learner-preferences-changed";

export async function getLearnerPreferences(): Promise<LearnerPreferences> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/settings/${encodeURIComponent(getStudentId())}`,
    { cache: "no-store" },
  ));
  return { ...DEFAULT_LEARNER_PREFERENCES, ...await response.json() } as LearnerPreferences;
}

export async function saveLearnerPreferences(
  preferences: LearnerPreferences,
): Promise<LearnerPreferences> {
  const response = await requireOk(await fetch(
    `${API_BASE}/api/settings/${encodeURIComponent(getStudentId())}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teaching_mode: preferences.teaching_mode,
        answer_depth: preferences.answer_depth,
        difficulty: preferences.difficulty,
        daily_minutes: preferences.daily_minutes,
        material_types: preferences.material_types,
        long_term_memory_enabled: preferences.long_term_memory_enabled,
        reminder_enabled: preferences.reminder_enabled,
        reminder_time: preferences.reminder_time,
      }),
    },
  ));
  const saved = { ...DEFAULT_LEARNER_PREFERENCES, ...await response.json() } as LearnerPreferences;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<LearnerPreferences>(EVENT_NAME, { detail: saved }));
  }
  return saved;
}

export function onLearnerPreferencesChanged(
  callback: (preferences: LearnerPreferences) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const preferences = (event as CustomEvent<LearnerPreferences>).detail;
    if (preferences) callback(preferences);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
