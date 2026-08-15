/**
 * 把 AI 的 Markdown 回答转换成适合 TTS / 数字人朗读的纯文本。
 * 保留正文和链接文字，移除只用于视觉排版的标记与原始地址。
 */
export function toSpeakableText(markdown: string): string {
  let text = (markdown || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";

  // YAML front matter 与代码块不适合逐字符朗读。
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  text = text.replace(/(?:```|~~~)[^\n]*\n[\s\S]*?(?:```|~~~)/g, "\n这里有一段代码示例。\n");

  // 图片保留替代文本；链接只读标题，不读 URL。
  text = text.replace(/!\[([^\]]*)\]\([^\n)]*\)/g, (_match, alt: string) =>
    alt.trim() ? `图片：${alt.trim()}` : ""
  );
  text = text.replace(/\[([^\]]+)]\((?:[^()\n]|\([^()\n]*\))*\)/g, "$1");
  text = text.replace(/\[([^\]]+)]\[[^\]]*]/g, "$1");
  text = text.replace(/^\s*\[[^\]]+]:\s+\S+.*$/gm, "");
  text = text.replace(/<(?:https?:\/\/|mailto:)[^>]+>/gi, "链接");
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/<[^>]+>/g, " ");

  // 块级 Markdown：标题、引用、列表、任务框、分隔线与表格分隔行。
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, "");
  text = text.replace(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/gm, "");
  text = text.replace(
    /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm,
    ""
  );
  text = text.replace(/^\s*\|\s?/gm, "").replace(/\s?\|\s*$/gm, "");
  text = text.replace(/\|/g, "，");

  // 行内 Markdown 与常见 LaTeX 外壳。
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/[*_~`$]/g, "");
  text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|>])/g, "$1");
  text = text.replace(/\\(?=[A-Za-z])/g, "");

  text = text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "和")
    .replace(/&lt;/gi, "小于")
    .replace(/&gt;/gi, "大于")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, "\"")
    .replace(/&#39;|&apos;|&lsquo;|&rsquo;/gi, "'");

  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, "。")
    .replace(/([。！？；，、])\1+/g, "$1")
    .replace(/。([，；])/g, "$1")
    .replace(/^[，。；\s]+|[，；\s]+$/g, "")
    .trim();
}
