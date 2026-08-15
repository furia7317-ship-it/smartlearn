export type VoiceCommand =
  | { type: "navigate"; destination: string; label: string }
  | { type: "back"; label: string }
  | { type: "scroll"; direction: "up" | "down" | "top" | "bottom"; label: string }
  | { type: "close"; label: string }
  | { type: "new_conversation"; label: string }
  | { type: "stop"; label: string };

const DESTINATIONS: Array<[RegExp, string, string]> = [
  [/^(首页|工作台|主页)$/, "", "首页"],
  [/^(智能教师|教师|老师|对话)$/, "studio", "智能教师"],
  [/^(资源中心|资源|资料中心)$/, "resources", "资源中心"],
  [/^(资源生成|生成资料|创建资料)$/, "create", "资源生成"],
  [/^(学习路径|路径|总学习路径)$/, "path", "学习路径"],
  [/^(练习|练习中心)$/, "practice", "练习中心"],
  [/^(代码挑战|代码编译器|编译器|代码实验室)$/, "code-lab", "代码挑战"],
  [/^(知识库|课程知识库)$/, "kb", "知识库"],
  [/^(错题本|错题)$/, "practice", "错题本"],
  [/^(视频学习|学习视频)$/, "video-learning", "视频学习"],
  [/^(日历|日程)$/, "calendar", "日程"],
  [/^(设置|系统设置)$/, "settings", "设置"],
];

export function parseVoiceCommand(raw: string): VoiceCommand | null {
  const text = raw.replace(/[，。！？!?、\s]+/g, "").trim();
  if (!text || text.length > 26) return null;

  if (/^(请)?(返回|回到)(上一页|上个页面|前一页)$/.test(text)) return { type: "back", label: "返回上一页" };
  if (/^(请)?(向上滚动|往上滚|上翻一页)$/.test(text)) return { type: "scroll", direction: "up", label: "向上滚动" };
  if (/^(请)?(向下滚动|往下滚|下翻一页)$/.test(text)) return { type: "scroll", direction: "down", label: "向下滚动" };
  if (/^(请)?(回到顶部|滚动到顶部)$/.test(text)) return { type: "scroll", direction: "top", label: "回到顶部" };
  if (/^(请)?(去到底部|滚动到底部)$/.test(text)) return { type: "scroll", direction: "bottom", label: "滚动到底部" };
  if (/^(请)?(关闭|关掉)(这个)?(小窗|窗口|答疑窗|资料)$/.test(text)) return { type: "close", label: "关闭当前窗口" };
  if (/^(请)?(新建|创建)(一个)?(新会话|对话)$/.test(text)) return { type: "new_conversation", label: "新建会话" };
  if (/^(请)?(停止|打断|别说了|停止回答|停止生成)$/.test(text)) return { type: "stop", label: "停止当前回答" };

  const match = text.match(/^(?:请|帮我)?(?:打开|进入|前往|切换到|去)(.+)$/);
  if (!match) return null;
  const target = match[1];
  for (const [pattern, destination, label] of DESTINATIONS) {
    if (pattern.test(target)) return { type: "navigate", destination, label: `打开${label}` };
  }
  return null;
}

export function voiceDestinationPath(destination: string, pathname: string): string {
  const desktop = pathname.startsWith("/desktop");
  if (!destination) return desktop ? "/desktop/" : "/";
  return desktop ? `/desktop/${destination}/` : `/${destination}/`;
}
