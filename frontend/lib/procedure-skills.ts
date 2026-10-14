import { API_BASE } from "./api";
import { getStudentId } from "./student-identity";
import { createProcedureSkillsClient } from "./procedure-skill-client";

export const procedureSkills = createProcedureSkillsClient({ apiBase: API_BASE, getStudentId });
