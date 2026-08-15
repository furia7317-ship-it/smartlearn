"""Interactive agent — 交互演示（沙箱内可交互的 HTML/CSS/ES module 演示）。"""

from __future__ import annotations

from typing import Any

from app.core.llm import build_llm, parse_json_response

SYSTEM_PROMPT = """你是交互式教学演示工程师。你产出的不是文章，而是一个学生可以直接动手操作的小演示，
用来把抽象内容变直观：三维模型、几何/向量关系、数学公式推导、算法动画、参数敏感性实验等。

【运行环境硬约束 —— 违反必然在沙箱里跑不起来，直接被驳回】
1. 演示运行在不透明源 iframe 中，CSP 为 default-src 'none'，**完全没有网络**。
   绝对不能引用任何 CDN、外链脚本/样式/图片/字体，不能 fetch / XMLHttpRequest / WebSocket / import 远程模块。
   html、css、js 里都不允许出现 http:// 或 https:// 开头的地址，也不允许 //cdn 之类的协议相对地址。
2. 三维/几何用宿主注入的 `window.THREE`（three.js r182 ESM）；只有在 runtime 里声明了 "three" 才会被注入。
3. 公式用宿主注入的 `window.katex`；只有在 runtime 里声明了 "katex" 才会被注入。
   渲染方式固定为 `katex.render(tex, element, { throwOnError: false })`。
4. js 字段是一段 **ES module** 源码，由宿主在运行时就绪后执行；可以使用顶层 await。
   DOM 在执行前已就绪，不要自己写 <script> 标签，也不要写 DOMContentLoaded 等待。
5. html 是 <body> 内的标记，**禁止** <script>、<iframe>、<object>、<embed>、<form>，
   **禁止** onclick / oninput 等 on* 内联事件属性，**禁止** javascript: URL。
   所有事件一律在 js 里用 addEventListener 绑定。
6. 图片只能用 data: URI，或者直接用 canvas / SVG 程序化绘制。
7. 必须自适应容器宽度（用百分比/flex/ResizeObserver 或 window resize 重算画布尺寸），
   深色与浅色主题下都要清晰可读；宿主注入了 CSS 变量 --sl-fg（前景）、--sl-bg（背景）、--sl-accent（强调色），
   鼓励优先使用它们，不要写死黑白配色。
8. 体量克制：html ≤ 40000 字符、css ≤ 20000 字符、js ≤ 40000 字符，三者合计 ≤ 80000 字符。

【三维骨架示例（runtime 声明 "three" 时可直接套用这个结构）】
```js
const host = document.getElementById('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, host.clientWidth / 360, 0.1, 100);
camera.position.set(3, 2, 4);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const light = new THREE.DirectionalLight(0xffffff, 1.1);
light.position.set(4, 6, 5);
scene.add(light);
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 1.4, 1.4),
  new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.35 })
);
scene.add(mesh);
function resize() {
  const width = host.clientWidth || 320;
  const height = Math.max(240, Math.round(width * 0.62));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
resize();
window.addEventListener('resize', resize);
let spinning = true;
document.getElementById('toggle').addEventListener('click', () => { spinning = !spinning; });
function loop() {
  if (spinning) mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
```

【输出 JSON —— 只输出这一个对象，不要输出任何解释文字】
```json
{
  "summary": "一句话说明这个演示展示了什么、学生能看懂什么",
  "html": "<body> 内的标记，禁止 <script> 与 on* 内联事件",
  "css": "样式，可以为空字符串",
  "js": "ES module 源码，可以为空字符串",
  "runtime": ["three"],
  "interactions": ["可交互点1", "可交互点2"]
}
```

规则：
1. runtime 只能取 "three" 和 "katex" 的子集；纯 canvas/SVG 演示请给空数组 []，不要凭空声明用不到的运行时。
2. interactions 写 2 到 4 条，每条描述一个学生真正能做的操作及其观察到的变化（会渲染在沙箱下方）。
3. 演示必须围绕本次学习主题的核心概念，参数默认值要一眼能看出规律，不要做成空壳。
4. 给每个可交互控件加 aria-label 或可见文字标签，键盘也要能操作。"""


def _fallback(topic: str) -> dict[str, Any]:
    """A structurally complete, sandbox-legal minimal demo used when parsing fails."""

    safe_topic = (topic or "学习主题").strip()[:40] or "学习主题"
    return {
        "summary": f"用一个可调参数的折线演示，直观呈现「{safe_topic}」中数量变化带来的趋势差异。",
        "html": (
            '<section class="sl-demo">\n'
            f"  <h2>{safe_topic} · 交互演示</h2>\n"
            "  <p class=\"sl-hint\">拖动滑块改变样本数量，观察曲线形状与增长速度的变化。</p>\n"
            '  <label class="sl-control" for="sl-range">样本数量</label>\n'
            '  <input id="sl-range" type="range" min="2" max="40" value="12" aria-label="样本数量" />\n'
            '  <output id="sl-value">12</output>\n'
            '  <canvas id="sl-canvas" aria-label="趋势曲线" role="img"></canvas>\n'
            "</section>"
        ),
        "css": (
            ".sl-demo{display:flex;flex-direction:column;gap:.6rem;width:100%;"
            "color:var(--sl-fg,#111);background:var(--sl-bg,transparent);font:14px/1.6 system-ui,sans-serif}\n"
            ".sl-demo h2{font-size:1.05rem;margin:0}\n"
            ".sl-hint{opacity:.75;margin:0}\n"
            ".sl-demo input[type=range]{width:100%;accent-color:var(--sl-accent,#4f8cff)}\n"
            ".sl-demo canvas{width:100%;height:auto;display:block}"
        ),
        "js": (
            "const canvas = document.getElementById('sl-canvas');\n"
            "const range = document.getElementById('sl-range');\n"
            "const value = document.getElementById('sl-value');\n"
            "const ctx = canvas.getContext('2d');\n"
            "const accent = getComputedStyle(document.body).getPropertyValue('--sl-accent').trim() || '#4f8cff';\n"
            "function draw() {\n"
            "  const width = canvas.clientWidth || 320;\n"
            "  const height = Math.max(180, Math.round(width * 0.5));\n"
            "  const ratio = Math.min(window.devicePixelRatio || 1, 2);\n"
            "  canvas.width = width * ratio;\n"
            "  canvas.height = height * ratio;\n"
            "  canvas.style.height = height + 'px';\n"
            "  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);\n"
            "  ctx.clearRect(0, 0, width, height);\n"
            "  const count = Number(range.value);\n"
            "  ctx.strokeStyle = accent;\n"
            "  ctx.lineWidth = 2;\n"
            "  ctx.beginPath();\n"
            "  for (let i = 0; i < count; i += 1) {\n"
            "    const x = (i / Math.max(1, count - 1)) * (width - 16) + 8;\n"
            "    const y = height - 8 - (Math.log2(i + 1) / Math.log2(count + 1)) * (height - 24);\n"
            "    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);\n"
            "  }\n"
            "  ctx.stroke();\n"
            "}\n"
            "range.addEventListener('input', () => { value.textContent = range.value; draw(); });\n"
            "window.addEventListener('resize', draw);\n"
            "draw();"
        ),
        "runtime": [],
        "interactions": [
            "拖动「样本数量」滑块：曲线采样点变多，可以看到增长逐渐放缓的形状。",
            "把滑块拉到最小值再拉到最大值：对比两端形状，感受同一规律在不同规模下的差异。",
        ],
    }


def generate(state: dict[str, Any]) -> dict[str, Any]:
    """生成一份可在沙箱 iframe 中运行的交互演示。"""

    llm = build_llm(temperature=0.6)

    from app.agents.common import format_untrusted_knowledge_context, prompt_extras

    kb_text = format_untrusted_knowledge_context(
        state.get("kb_context", []),
        max_sources=5,
        max_content_chars=1200,
        max_total_chars=6000,
    )

    topic = str(state.get("topic") or "学习主题")
    prompt = (
        f"主题：{topic}\n\n知识库参考：{kb_text}{prompt_extras(state)}"
        "\n\n请为这个主题生成一个可交互演示。"
    )

    # 预算是 run 级的：这里只允许一次模型调用，重试由管线的返工工单驱动。
    resp = llm.invoke([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])

    resource_id = f"interactive_{topic[:20]}"
    try:
        result = parse_json_response(resp.content)
        if not isinstance(result, dict) or not str(result.get("html") or "").strip():
            raise ValueError("交互演示缺少 html")
    except Exception:
        result = _fallback(topic)

    result.setdefault("title", f"{topic} · 交互演示")
    result.setdefault("css", "")
    result.setdefault("js", "")
    if not isinstance(result.get("runtime"), list):
        result["runtime"] = []
    if not isinstance(result.get("interactions"), list):
        result["interactions"] = []
    result["type"] = "interactive"
    result["id"] = resource_id
    return result
