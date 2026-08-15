// 把交互沙箱要用到的第三方运行时抽成纯文本资产。
// 沙箱 iframe 跑在不透明源 + `default-src 'none'` 之下，拿不到任何网络，
// 所以运行时必须由宿主页面读进来后内联进 srcDoc —— 这些文件就是给宿主 fetch 用的。
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "public", "sandbox-runtime");
const threeDist = join(root, "node_modules", "three", "build");
const katexDist = join(root, "node_modules", "katex", "dist");

await mkdir(destination, { recursive: true });

// three 自 r160 起只发 ESM，且拆成 three.module.min.js + three.core.min.js 两段
// （前者 `import "./three.core.min.js"`）。沙箱里用 Blob 装载模块，相对说明符无从解析，
// 宿主必须先把 core 做成 blob 再改写说明符——所以两个文件都要搬，且这里把
// 「模块图恰好是这个形状」钉成构建期断言：three 换布局时立刻构建失败，而不是等到运行时白屏。
const THREE_CORE_SPECIFIER = "./three.core.min.js";
const threeModule = await readFile(join(threeDist, "three.module.min.js"), "utf8");
const threeCore = await readFile(join(threeDist, "three.core.min.js"), "utf8");

if (!threeModule.includes(THREE_CORE_SPECIFIER)) {
  throw new Error(`three.module.min.js 不再引用 ${THREE_CORE_SPECIFIER}，沙箱装载逻辑需同步更新`);
}
const strayImports = [...threeCore.matchAll(/from"(\.[^"]+)"/g)].map((match) => match[1]);
if (strayImports.length > 0) {
  throw new Error(`three.core.min.js 出现了新的相对导入（${strayImports.join(", ")}），沙箱装载逻辑需同步更新`);
}

await writeFile(join(destination, "three.module.min.js"), threeModule, "utf8");
await writeFile(join(destination, "three.core.min.js"), threeCore, "utf8");

// katex 是 UMD，直接当经典脚本注入即可拿到 window.katex。
await copyFile(join(katexDist, "katex.min.js"), join(destination, "katex.min.js"));

// katex.min.css 用 `url(fonts/xxx.woff2)` 引字体，而 srcDoc 文档没有可用的基准地址，
// 相对路径必然解析失败。这里把 woff2 就地转成 data: URI，并丢掉 woff/ttf 兜底
// （沙箱只跑在 Chromium 里，woff2 一定可用），换来一个完全自包含的样式表。
const rawCss = await readFile(join(katexDist, "katex.min.css"), "utf8");
const fontCache = new Map();

async function fontDataUri(file) {
  if (!fontCache.has(file)) {
    const buffer = await readFile(join(katexDist, "fonts", file));
    fontCache.set(file, `data:font/woff2;base64,${buffer.toString("base64")}`);
  }
  return fontCache.get(file);
}

// 单条 src 形如：url(fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(...woff) format("woff"),...
const SRC_RULE = /src:([^;}]+)/g;
const WOFF2_REF = /url\(fonts\/([A-Za-z0-9_-]+\.woff2)\)/;

const replacements = [];
for (const match of rawCss.matchAll(SRC_RULE)) {
  const woff2 = match[1].match(WOFF2_REF);
  if (!woff2) continue;
  replacements.push({ from: match[0], file: woff2[1] });
}

let inlinedCss = rawCss;
for (const { from, file } of replacements) {
  const uri = await fontDataUri(file);
  inlinedCss = inlinedCss.replace(from, `src:url(${uri}) format("woff2")`);
}

if (/url\(fonts\//.test(inlinedCss)) {
  throw new Error("katex 样式表里仍残留相对字体路径，沙箱内会加载失败");
}

await writeFile(join(destination, "katex.inline.css"), inlinedCss, "utf8");

console.log(
  `Sandbox runtime assets are ready (${replacements.length} katex fonts inlined, ${fontCache.size} unique).`,
);
