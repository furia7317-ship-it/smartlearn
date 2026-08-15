export type TeacherPersona = "alligator" | "raccoon";

export interface TeacherPersonaDefinition {
  id: TeacherPersona;
  name: string;
  shortName: string;
  description: string;
  avatar: string;
}

export const DEFAULT_TEACHER: TeacherPersona = "raccoon";

export const TEACHER_PERSONAS: Record<TeacherPersona, TeacherPersonaDefinition> = {
  alligator: {
    id: "alligator",
    name: "鳄鱼老师",
    shortName: "鳄鱼",
    description: "犀利、直接、先给结论，不绕弯。",
    avatar: "/brand/animals/chinese-alligator-review.webp",
  },
  raccoon: {
    id: "raccoon",
    name: "浣熊老师",
    shortName: "浣熊",
    description: "耐心、细致、拆成小步骤慢慢讲清楚。",
    avatar: "/brand/animals/red-panda-plan.webp",
  },
};

export function normalizeTeacherPersona(value: unknown): TeacherPersona {
  return value === "alligator" || value === "raccoon" ? value : DEFAULT_TEACHER;
}
