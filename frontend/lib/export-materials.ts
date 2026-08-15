import type { ResourceItem } from "@/lib/types";

/** 把一批已生成的资源拼成可读 Markdown（教师可直接用 / 再编辑）。 */
export function materialsToMarkdown(items: ResourceItem[]): string {
  const blocks = items
    .filter((it) => it.status === "ready" && it.data)
    .map((it) => {
      const d = it.data!;
      const out: string[] = [`# ${it.title}`];
      if (it.subtitle) out.push("", it.subtitle);
      if (typeof d.overview === "string" && d.overview) out.push("", d.overview);
      if (typeof d.explanation === "string" && d.explanation) out.push("", d.explanation);
      if (Array.isArray(d.key_points) && d.key_points.length) {
        out.push("", "## 知识要点");
        d.key_points.forEach((k, i) => out.push(`${i + 1}. ${k}`));
      }
      if (Array.isArray(d.questions) && d.questions.length) {
        out.push("", "## 题目");
        d.questions.forEach((q, i) => {
          out.push(`**${i + 1}. ${q.stem}**`);
          (q.options ?? []).forEach((o) => out.push(`- ${o}`));
          if (q.answer) out.push(`> 答案：${q.answer}`);
          if (q.explanation) out.push(`> 解析：${q.explanation}`);
          out.push("");
        });
      }
      if (typeof d.content === "string" && d.content) out.push("", d.content);
      if (Array.isArray(d.slides) && d.slides.length) {
        out.push("", "## 课件大纲");
        d.slides.forEach((s) => {
          out.push(`### ${s.slide_num ? `${s.slide_num}. ` : ""}${s.title}`);
          (s.content ?? []).forEach((c) => out.push(`- ${c}`));
        });
      }
      if (typeof d.code === "string" && d.code) {
        out.push("", "```" + (typeof d.language === "string" ? d.language : ""), d.code, "```");
      }
      return out.join("\n");
    });
  return `${blocks.join("\n\n---\n\n")}\n`;
}

/** 触发浏览器下载文本文件（离线、纯前端）。 */
export function downloadText(filename: string, content: string, mime = "text/markdown") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
