import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("统一 Markdown 组件挂上了 gfm + math + katex 插件链", async () => {
  const source = await read("../components/markdown.tsx");

  assert.match(source, /from\s+["']remark-gfm["']/, "必须保留 remark-gfm");
  assert.match(source, /from\s+["']remark-math["']/, "必须引入 remark-math");
  assert.match(source, /from\s+["']rehype-katex["']/, "必须引入 rehype-katex");

  // remarkPlugins 里同时有 gfm 与 math，rehypePlugins 里有 katex（不锁死数组写法）
  const remarkList = source.match(/remarkPlugins=\{([^}]+)\}/);
  assert.ok(remarkList, "ReactMarkdown 必须传 remarkPlugins");
  const remarkNames = source.match(/=\s*\[\s*remarkGfm\s*,\s*remarkMath\s*\]/);
  assert.ok(remarkNames, "remark 插件数组需同时包含 remarkGfm 与 remarkMath");
  assert.match(source, /rehypePlugins=\{[^}]+\}/, "ReactMarkdown 必须传 rehypePlugins");
  assert.match(source, /=\s*\[\s*rehypeKatex\s*\]/, "rehype 插件数组需包含 rehypeKatex");

  // 容器类名（globals.css 与既有测试依赖）不能在重构中丢
  assert.match(source, /chat-prose/, "统一组件仍需渲染 .chat-prose 容器");
});

test("链接拦截行为保留在统一组件里，并由对话区显式开启", async () => {
  const markdown = await read("../components/markdown.tsx");
  const chat = await read("../components/chat.tsx");

  // 拦截逻辑本体搬进了统一组件
  assert.match(markdown, /openInBrowser/, "统一组件需要能走内置浏览器抽屉");
  assert.match(markdown, /\^https\?:/, "只拦截 http(s) 链接");
  assert.match(markdown, /preventDefault\(\)/);
  assert.match(markdown, /window\.open\(\s*href\s*,\s*["']_blank["']/);
  assert.match(markdown, /interceptLinks/, "需要暴露「是否拦截链接」开关");

  // 对话区必须把开关打开，否则 B 站链接会跳系统浏览器
  assert.match(chat, /<Markdown[^>]*interceptLinks/s, "chat.tsx 需要开启 interceptLinks");
});

test("三处调用方都改用统一组件，不再各自实例化 ReactMarkdown", async () => {
  const callers = {
    chat: await read("../components/chat.tsx"),
    resourceViewer: await read("../components/resource-viewer.tsx"),
    study: await read("../app/path/study/page.tsx"),
    quizRunner: await read("../components/quiz-runner.tsx"),
  };

  for (const [name, source] of Object.entries(callers)) {
    assert.doesNotMatch(
      source,
      /from\s+["']react-markdown["']/,
      `${name} 不应再直接依赖 react-markdown`
    );
    assert.doesNotMatch(source, /<ReactMarkdown/, `${name} 不应再自己实例化 ReactMarkdown`);
    assert.doesNotMatch(
      source,
      /from\s+["']remark-gfm["']/,
      `${name} 的插件集合应由统一组件统一维护`
    );
    assert.match(
      source,
      /import\s*\{[^}]*\bMarkdown\b[^}]*\}\s*from\s+["']@\/components\/markdown["']/,
      `${name} 需要改用 @/components/markdown`
    );
  }
});

test("试卷题干 / 选项 / 解析走 Markdown 渲染", async () => {
  const quiz = await read("../components/quiz-runner.tsx");
  const viewer = await read("../components/resource-viewer.tsx");

  assert.match(quiz, /<Markdown[^>]*content=\{q\.stem\}/s, "题干需 Markdown 渲染");
  assert.match(quiz, /<Markdown[^>]*content=\{optionText\(opt\)\}/s, "选项需 Markdown 渲染");
  assert.match(quiz, /<Markdown[^>]*content=\{q\.explanation\}/s, "解析需 Markdown 渲染");
  // 选项保持紧凑 / 行内排版
  assert.match(quiz, /<Markdown[^>]*\binline\b/s, "选项应使用行内变体，避免 div-in-button");

  assert.match(viewer, /<Markdown[^>]*content=\{question\.stem\}/s);
  assert.match(viewer, /<Markdown[^>]*content=\{question\.explanation/s);
  assert.doesNotMatch(
    viewer,
    /whitespace-pre-wrap[^"]*"\s*>\s*\{question\.(stem|explanation)\}/,
    "SolutionBody 不应再用纯文本 whitespace-pre-wrap 承载题干/解析"
  );
});

test("KaTeX 样式已接入应用主样式，且没有牵连沙箱副本", async () => {
  const layout = await read("../app/layout.tsx");
  const globals = await read("../app/globals.css");

  // 第三方表在 app/ 内 import（Next 16 App Router 的 external stylesheet 姿势）
  assert.match(layout, /import\s+["']katex\/dist\/katex(\.min)?\.css["']/);

  // 沙箱 iframe 的独立副本（字体已内联）不能被应用主样式真正引用（注释提及不算）
  assert.doesNotMatch(globals, /@import[^;\n]*sandbox-runtime\/katex/);
  assert.doesNotMatch(globals, /url\([^)]*sandbox-runtime\/katex/);
  assert.doesNotMatch(layout, /import\s+["'][^"']*sandbox-runtime\/katex/);

  // 暗色可读性覆盖存在，且没有污染 :root / .dark 颜色基线与 .desktop-scope
  assert.match(globals, /\.dark\s+\.katex/, "暗色下需要有 KaTeX 可读性覆盖");
  assert.match(globals, /\.katex-display\s*\{[^}]*overflow-x:\s*auto/s, "长公式需可横向滚动");
  assert.doesNotMatch(globals, /\.desktop-scope[^{]*\.katex/);
});

test("solution paper pins its own tokens so dark mode never renders light-on-light", async () => {
  const [css, viewer] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../components/resource-viewer.tsx", import.meta.url), "utf8"),
  ]);

  // 解析卡片是一张与主题无关的硬编码浅色纸，任何 var(--foreground)/var(--muted)
  // 的后代规则（公式、行内代码、表头）在 .dark 下都会变成浅色印在浅纸上。
  assert.match(css, /\.dark\s+\.solution-paper/, "paper must re-pin tokens under .dark");
  assert.match(viewer, /className="solution-paper[^"]*bg-white/);

  // 这条规则会压过 KaTeX 的颜色继承，把公式钉成暗色主题前景色 —— 纸面上就是白字白底。
  // 先剥注释：解释「为什么不写这条规则」的说明里恰好包含这段代码。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    rules,
    /\.dark\s+\.katex[^{;]*\{[^}]*color\s*:/,
    "do not force a color onto .katex in dark mode; inheritance already handles both scopes",
  );
});
