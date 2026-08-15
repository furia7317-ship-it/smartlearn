/**
 * 交互演示沙箱的文档装配层。
 *
 * 沙箱是一个 `sandbox="allow-scripts"`（**不带** allow-same-origin）的 iframe，
 * 因此它跑在不透明源上：拿不到宿主的 DOM、cookie、localStorage，也过不去同源请求。
 * 再叠一层 `default-src 'none'` 的内联 CSP，把网络出口整个关掉——这意味着
 * AI 生成的演示既不能外链 CDN，也不能把任何东西发出去。
 *
 * 代价是三方运行时（three.js / katex）必须由宿主读成文本后内联进文档，
 * 这正是 scripts/copy-sandbox-runtime.mjs 把它们抽到 public/sandbox-runtime/ 的原因。
 *
 * 本文件只做纯字符串装配，不碰 DOM，便于用 node:test 直接单测。
 */

export type SandboxRuntimeId = "three" | "katex";

export const SANDBOX_RUNTIME_IDS: readonly SandboxRuntimeId[] = ["three", "katex"] as const;

/** 与 backend/app/agents/interactive.py 的输出契约一一对应。 */
export interface InteractiveSandboxPayload {
  summary?: string;
  html?: string;
  css?: string;
  js?: string;
  runtime?: string[];
  interactions?: string[];
}

export interface SandboxRuntimeSources {
  /** three.js 的 ESM 入口源码，装载后挂到 window.THREE。 */
  three?: string;
  /** three.js 的核心分片，被入口以相对说明符引用，装载时需先做成 blob 再改写说明符。 */
  threeCore?: string;
  /** katex 的 UMD 源码，装载后挂到 window.katex。 */
  katexJs?: string;
  /** 已把字体内联成 data: URI 的 katex 样式表。 */
  katexCss?: string;
}

/** three 入口里引用核心分片的相对说明符；与 scripts/copy-sandbox-runtime.mjs 的构建期断言一致。 */
export const THREE_CORE_SPECIFIER = "./three.core.min.js";

export interface BuildSandboxDocumentOptions {
  theme?: "light" | "dark";
  /** 仅用于给 iframe 标题/错误信息提供上下文。 */
  title?: string;
}

const SANDBOX_CSP = [
  "default-src 'none'",
  // 内联脚本是装配方式本身；blob: 用来装载被内联进来的运行时与用户模块。
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  // 关键：沙箱内不允许任何出网，AI 生成的代码无法回传数据也无法拉外部资源。
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** iframe 的 sandbox 白名单。**绝不能加 allow-same-origin**，否则沙箱形同虚设。 */
export const SANDBOX_ALLOW = "allow-scripts";

export const SANDBOX_MESSAGE_SOURCE = "smartlearn-sandbox";

export type SandboxMessage =
  | { source: typeof SANDBOX_MESSAGE_SOURCE; type: "ready" }
  | { source: typeof SANDBOX_MESSAGE_SOURCE; type: "height"; height: number }
  | { source: typeof SANDBOX_MESSAGE_SOURCE; type: "error"; message: string };

export function isSandboxMessage(value: unknown): value is SandboxMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { source?: unknown; type?: unknown };
  if (candidate.source !== SANDBOX_MESSAGE_SOURCE) return false;
  return candidate.type === "ready" || candidate.type === "height" || candidate.type === "error";
}

/**
 * 把任意文本安全地塞进 `<script type="text/plain">` 容器。
 *
 * HTML 分词器只认字面量 `</script`，一旦载荷里出现它就会提前闭合脚本块并让后面的
 * 内容逃逸成真实标记，所以这里把它拆开。反斜杠形式在 JS 字符串里等价，不影响语义。
 */
export function escapeForTextScript(source: string): string {
  return source.replace(/<\/(script)/gi, "<\\/$1");
}

/** 把 HTML 特殊字符转义，用于把纯文本安全地放进标记里。 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 只保留后端已声明、且宿主确实拿到了源码的运行时。 */
export function resolveRuntimes(
  requested: string[] | undefined,
  sources: SandboxRuntimeSources,
): SandboxRuntimeId[] {
  if (!Array.isArray(requested)) return [];
  const wanted = new Set(requested.filter((id): id is SandboxRuntimeId =>
    (SANDBOX_RUNTIME_IDS as readonly string[]).includes(id),
  ));
  const resolved: SandboxRuntimeId[] = [];
  // three 必须两段都在：只有入口没有核心分片的话，装载时会直接抛模块解析错误。
  if (wanted.has("three") && sources.three && sources.threeCore) resolved.push("three");
  if (wanted.has("katex") && sources.katexJs) resolved.push("katex");
  return resolved;
}

const BASE_STYLE = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { color-scheme: var(--sl-color-scheme); }
body {
  min-height: 100vh;
  padding: 16px;
  background: var(--sl-bg);
  color: var(--sl-fg);
  font-family: var(--sl-font);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
canvas { display: block; max-width: 100%; }
img, svg, video { max-width: 100%; height: auto; }
a { color: var(--sl-accent); }
button {
  font: inherit;
  color: var(--sl-fg);
  background: var(--sl-surface);
  border: 1px solid var(--sl-border);
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease;
}
button:hover { background: var(--sl-surface-hover); }
button:focus-visible { outline: 2px solid var(--sl-accent); outline-offset: 2px; }
input[type="range"] { accent-color: var(--sl-accent); }
`.trim();

const LIGHT_TOKENS = `
--sl-color-scheme: light;
--sl-bg: #ffffff;
--sl-fg: #1f2426;
--sl-muted: #667079;
--sl-accent: #2f7d5d;
--sl-surface: #f4f6f5;
--sl-surface-hover: #e8ecea;
--sl-border: #d9dedc;
`.trim();

const DARK_TOKENS = `
--sl-color-scheme: dark;
--sl-bg: #14181a;
--sl-fg: #e8ecea;
--sl-muted: #9aa5ab;
--sl-accent: #6fd0a1;
--sl-surface: #1e2427;
--sl-surface-hover: #272f33;
--sl-border: #333c41;
`.trim();

const BOOTSTRAP = `
const POST = (payload) => {
  try { parent.postMessage(Object.assign({ source: ${JSON.stringify(SANDBOX_MESSAGE_SOURCE)} }, payload), "*"); }
  catch (_) { /* 宿主可能已卸载，忽略 */ }
};
const readSource = (id) => {
  const node = document.getElementById(id);
  return node ? node.textContent || "" : "";
};
const toModuleUrl = (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

const loadClassicScript = (source) => new Promise((resolve, reject) => {
  const url = toModuleUrl(source);
  const el = document.createElement("script");
  el.src = url;
  el.onload = () => { URL.revokeObjectURL(url); resolve(); };
  el.onerror = () => { URL.revokeObjectURL(url); reject(new Error("运行时脚本装载失败")); };
  document.head.appendChild(el);
});

window.addEventListener("error", (event) => {
  POST({ type: "error", message: String((event && event.message) || "演示运行出错") });
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event && event.reason;
  POST({ type: "error", message: String((reason && reason.message) || reason || "演示运行出错") });
});

let lastHeight = 0;
const reportHeight = () => {
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (height > 0 && Math.abs(height - lastHeight) > 2) {
    lastHeight = height;
    POST({ type: "height", height });
  }
};

(async () => {
  try {
    let threeSource = readSource("__sl_rt_three");
    if (threeSource) {
      // three 的 ESM 入口以相对路径引用核心分片，而 blob 文档没有可解析的基准地址，
      // 所以先把分片做成 blob，再把说明符替换掉。
      const coreSource = readSource("__sl_rt_three_core");
      if (coreSource) {
        threeSource = threeSource.split(${JSON.stringify(THREE_CORE_SPECIFIER)}).join(toModuleUrl(coreSource));
      }
      const url = toModuleUrl(threeSource);
      window.THREE = await import(url);
      URL.revokeObjectURL(url);
    }
    const katexSource = readSource("__sl_rt_katex");
    if (katexSource) await loadClassicScript(katexSource);

    const userSource = readSource("__sl_user_js");
    if (userSource.trim()) {
      const url = toModuleUrl(userSource);
      await import(url);
      URL.revokeObjectURL(url);
    }
    POST({ type: "ready" });
  } catch (error) {
    POST({ type: "error", message: String((error && error.message) || error || "演示初始化失败") });
  } finally {
    reportHeight();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(reportHeight).observe(document.documentElement);
    }
    window.addEventListener("resize", reportHeight);
  }
})();
`.trim();

function textScript(id: string, source: string): string {
  return `<script type="text/plain" id="${id}">${escapeForTextScript(source)}</script>`;
}

/**
 * 把生成器产出的载荷装配成一份完全自包含的 HTML 文档。
 *
 * 顺序是刻意的：用户标记先落地（保证 DOM 就绪），运行时与用户脚本以 text/plain
 * 形式携带、由末尾的引导模块统一装载，这样宿主完全掌控执行时序——
 * AI 不需要（也不能）自己写 `<script>` 标签。
 */
export function buildSandboxDocument(
  payload: InteractiveSandboxPayload,
  sources: SandboxRuntimeSources = {},
  options: BuildSandboxDocumentOptions = {},
): string {
  const theme = options.theme === "dark" ? "dark" : "light";
  const runtimes = resolveRuntimes(payload.runtime, sources);
  const tokens = theme === "dark" ? DARK_TOKENS : LIGHT_TOKENS;

  const styles: string[] = [`:root {\n${tokens}\n--sl-font: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;\n}`, BASE_STYLE];
  if (runtimes.includes("katex") && sources.katexCss) styles.push(sources.katexCss);
  if (typeof payload.css === "string" && payload.css.trim()) styles.push(payload.css);

  const carriers: string[] = [];
  if (runtimes.includes("three") && sources.three && sources.threeCore) {
    carriers.push(textScript("__sl_rt_three_core", sources.threeCore));
    carriers.push(textScript("__sl_rt_three", sources.three));
  }
  if (runtimes.includes("katex") && sources.katexJs) carriers.push(textScript("__sl_rt_katex", sources.katexJs));
  carriers.push(textScript("__sl_user_js", typeof payload.js === "string" ? payload.js : ""));

  const title = escapeHtml(options.title?.trim() || "交互演示");

  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<title>${title}</title>
<style>${styles.join("\n\n")}</style>
</head>
<body>
${typeof payload.html === "string" ? payload.html : ""}
${carriers.join("\n")}
<script type="module">
${BOOTSTRAP}
</script>
</body>
</html>`;
}

const RUNTIME_ASSETS: Record<keyof SandboxRuntimeSources, string> = {
  three: "/sandbox-runtime/three.module.min.js",
  threeCore: "/sandbox-runtime/three.core.min.js",
  katexJs: "/sandbox-runtime/katex.min.js",
  katexCss: "/sandbox-runtime/katex.inline.css",
};

const runtimeCache = new Map<keyof SandboxRuntimeSources, Promise<string>>();

async function loadAsset(key: keyof SandboxRuntimeSources): Promise<string> {
  let pending = runtimeCache.get(key);
  if (!pending) {
    pending = fetch(RUNTIME_ASSETS[key])
      .then((response) => {
        if (!response.ok) throw new Error(`运行时资源不可用（${response.status}）`);
        return response.text();
      })
      .catch((error) => {
        // 失败不缓存，下次打开还能重试。
        runtimeCache.delete(key);
        throw error;
      });
    runtimeCache.set(key, pending);
  }
  return pending;
}

/**
 * 按需拉取演示实际声明的运行时。
 *
 * 三份资产加起来接近 1MB，绝不能在应用启动时就加载——只有真的打开了一个
 * 声明了对应 runtime 的交互演示才会去取，取到后进程内缓存。
 */
export async function loadSandboxRuntimes(requested: string[] | undefined): Promise<SandboxRuntimeSources> {
  if (!Array.isArray(requested) || requested.length === 0) return {};
  const wanted = new Set(requested);
  const sources: SandboxRuntimeSources = {};

  const jobs: Promise<void>[] = [];
  if (wanted.has("three")) {
    jobs.push(loadAsset("three").then((text) => { sources.three = text; }));
    jobs.push(loadAsset("threeCore").then((text) => { sources.threeCore = text; }));
  }
  if (wanted.has("katex")) {
    jobs.push(loadAsset("katexJs").then((text) => { sources.katexJs = text; }));
    jobs.push(loadAsset("katexCss").then((text) => { sources.katexCss = text; }));
  }

  await Promise.all(jobs);
  return sources;
}
