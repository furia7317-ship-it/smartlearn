import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as sandbox from "../lib/sandbox-runtime.ts";

const {
  SANDBOX_ALLOW,
  buildSandboxDocument,
  escapeForTextScript,
  isSandboxMessage,
  resolveRuntimes,
} = sandbox;

const SOURCES = {
  three: `import { X } from "${sandbox.THREE_CORE_SPECIFIER}"; export const REVISION = '182';`,
  threeCore: "export const X = 1;",
  katexJs: "window.katex = {};",
  katexCss: ".katex{font-family:KaTeX_Main}",
};

test("沙箱 iframe 绝不放开 allow-same-origin", () => {
  // 一旦带上 allow-same-origin，沙箱与宿主同源，隔离等于没有。
  assert.equal(SANDBOX_ALLOW, "allow-scripts");
  assert.ok(!SANDBOX_ALLOW.includes("allow-same-origin"));
  assert.ok(!SANDBOX_ALLOW.includes("allow-top-navigation"));
  assert.ok(!SANDBOX_ALLOW.includes("allow-popups"));
  assert.ok(!SANDBOX_ALLOW.includes("allow-modals"));
});

test("文档内联 CSP 关掉全部出网能力", () => {
  const doc = buildSandboxDocument({ html: "<p>hi</p>" }, SOURCES);
  const csp = doc.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, "必须写入内联 CSP");
  const policy = csp[1];
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /form-action 'none'/);
  assert.match(policy, /base-uri 'none'/);
  // 脚本只允许内联与 blob（装载被内联进来的运行时），不允许任何远端来源。
  assert.match(policy, /script-src 'unsafe-inline' blob:/);
  assert.ok(!/script-src[^;]*https?:/.test(policy));
});

test("</script> 载荷不能逃逸出 text/plain 容器", () => {
  const hostile = "const a = '</script><img src=x onerror=alert(1)>';";
  const escaped = escapeForTextScript(hostile);
  assert.ok(!escaped.includes("</script"));
  assert.match(escaped, /<\\\/script/);

  const doc = buildSandboxDocument({ js: hostile }, SOURCES);
  const carrier = doc.match(/<script type="text\/plain" id="__sl_user_js">([\s\S]*?)<\/script>/);
  assert.ok(carrier, "用户脚本必须留在 text/plain 容器里");
  assert.ok(!carrier[1].includes("</script"));
  // 大小写混合同样要挡住。
  assert.ok(!escapeForTextScript("</ScRiPt>").includes("</ScRiPt"));
});

test("只装载演示真正声明且宿主已取到的运行时", () => {
  assert.deepEqual(resolveRuntimes(["three"], SOURCES), ["three"]);
  assert.deepEqual(resolveRuntimes(["katex", "three"], SOURCES), ["three", "katex"]);
  // 非法运行时名被丢弃。
  assert.deepEqual(resolveRuntimes(["node", "fs"], SOURCES), []);
  // 声明了但宿主没取到源码时不能假装装载。
  assert.deepEqual(resolveRuntimes(["three"], {}), []);
  assert.deepEqual(resolveRuntimes(undefined, SOURCES), []);
});

test("未声明的运行时不会被塞进文档", () => {
  // 引导脚本恒会按 id 去取运行时，所以只能断言「载体元素」在不在，
  // 不能断言 id 字符串在不在。
  const carrier = (doc, id) => doc.includes(`<script type="text/plain" id="${id}">`);

  const doc = buildSandboxDocument({ html: "<p>x</p>", runtime: [] }, SOURCES);
  assert.ok(!carrier(doc, "__sl_rt_three"));
  assert.ok(!carrier(doc, "__sl_rt_katex"));
  assert.ok(!doc.includes(SOURCES.three));
  assert.ok(!doc.includes(SOURCES.katexCss));

  const withThree = buildSandboxDocument({ html: "<p>x</p>", runtime: ["three"] }, SOURCES);
  assert.ok(carrier(withThree, "__sl_rt_three"));
  assert.ok(withThree.includes(SOURCES.three));
  assert.ok(!carrier(withThree, "__sl_rt_katex"));
  assert.ok(!withThree.includes(SOURCES.katexCss));

  const withKatex = buildSandboxDocument({ html: "<p>x</p>", runtime: ["katex"] }, SOURCES);
  assert.ok(carrier(withKatex, "__sl_rt_katex"));
  assert.ok(withKatex.includes(SOURCES.katexCss));
});

test("three 的两段模块都被携带，且入口的相对说明符会在沙箱内被改写", () => {
  // three 的 ESM 入口 `import "./three.core.min.js"`，而 blob 文档没有基准地址，
  // 相对说明符必然解析失败——这是真机验证时才暴露出来的坑，用例把它钉住。
  const doc = buildSandboxDocument({ runtime: ["three"] }, SOURCES);
  assert.ok(doc.includes('<script type="text/plain" id="__sl_rt_three_core">'));
  assert.ok(doc.includes('<script type="text/plain" id="__sl_rt_three">'));
  // 核心分片必须排在入口前面，引导脚本才能先把它做成 blob。
  assert.ok(doc.indexOf("__sl_rt_three_core") < doc.indexOf('id="__sl_rt_three"'));
  // 引导脚本里要有把说明符换成 blob 地址的逻辑。
  assert.ok(doc.includes(JSON.stringify(sandbox.THREE_CORE_SPECIFIER)));

  // 只有入口、没有核心分片时不能假装能装载。
  assert.deepEqual(resolveRuntimes(["three"], { three: SOURCES.three }), []);
});

test("用户 css 与 html 被装进文档，主题令牌可用", () => {
  const doc = buildSandboxDocument(
    { html: "<div id='stage'></div>", css: "#stage{color:red}" },
    SOURCES,
    { theme: "dark", title: "齿轮传动" },
  );
  assert.ok(doc.includes("<div id='stage'></div>"));
  assert.ok(doc.includes("#stage{color:red}"));
  assert.match(doc, /data-theme="dark"/);
  assert.match(doc, /--sl-accent:/);
  assert.match(doc, /<title>齿轮传动<\/title>/);
});

test("标题中的标记字符被转义，不会破坏文档结构", () => {
  const doc = buildSandboxDocument({}, SOURCES, { title: '<img src=x onerror="alert(1)">' });
  assert.ok(!doc.includes("<img src=x"));
  assert.match(doc, /&lt;img/);
});

test("宿主消息校验只认沙箱自己的信封", () => {
  assert.ok(isSandboxMessage({ source: "smartlearn-sandbox", type: "ready" }));
  assert.ok(isSandboxMessage({ source: "smartlearn-sandbox", type: "height", height: 400 }));
  assert.ok(!isSandboxMessage({ source: "someone-else", type: "ready" }));
  assert.ok(!isSandboxMessage({ type: "ready" }));
  assert.ok(!isSandboxMessage(null));
  assert.ok(!isSandboxMessage("ready"));
});

test("渲染组件不得放宽沙箱边界", async () => {
  const source = await readFile(new URL("../components/html-sandbox.tsx", import.meta.url), "utf8");
  // 语义断言：不允许出现放宽隔离的 sandbox 关键字，也不允许绕开 srcDoc 直接给外部 src。
  assert.ok(!source.includes("allow-same-origin"));
  assert.ok(!source.includes("dangerouslySetInnerHTML"));
  assert.match(source, /sandbox=\{SANDBOX_ALLOW\}/);
  assert.match(source, /srcDoc=/);
  // 不透明源下 origin 恒为 "null"，必须靠 contentWindow 认人。
  assert.match(source, /event\.source !== frameRef\.current\.contentWindow/);
});
