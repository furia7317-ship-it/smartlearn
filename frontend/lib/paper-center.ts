import type { PaperSummary } from "./library";

export const PAPER_STATUS_LABEL: Record<string, string> = {
  created: "待作答", in_progress: "作答中", submitted: "待评分", graded: "已完成",
};

export function filterPapers(papers: PaperSummary[], query: string, status: string, category: string): PaperSummary[] {
  const keyword = query.trim().toLocaleLowerCase();
  return papers.filter((paper) =>
    (!status || paper.status === status)
    && (!category || paper.category === category)
    && (!keyword || [paper.title, paper.topic, paper.category, ...(paper.tags || [])].join(" ").toLocaleLowerCase().includes(keyword))
  ).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export function paperAnswerText(answer: string | undefined, type?: string, options?: string[]): string {
  if (!answer?.trim()) return "未作答";
  if (type === "boolean") return ({ true: "正确", false: "错误" } as Record<string, string>)[answer.toLowerCase()] || answer;
  if (type === "mcq" && /^[A-Z]$/i.test(answer.trim())) {
    return options?.[answer.trim().toUpperCase().charCodeAt(0) - 65] || answer;
  }
  return answer;
}
