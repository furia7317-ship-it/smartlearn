"""Small reviewed starter curricula. No seeded scores or learner achievements."""
from app.schemas.focus import CourseGraph, validate_graph


def frontend_graph() -> CourseGraph:
    modules = [
        ("foundation", "基础入门", "构建前端的基石", "red"),
        ("engineering", "工程化建设", "让开发有章可循", "blue"),
        ("framework", "框架进阶", "组织可维护的页面", "green"),
        ("application", "项目应用", "用接口连接真实业务", "brown"),
        ("quality", "优化与进阶", "把项目做稳、做快", "purple"),
        ("extension", "拓展方向", "从作品走向更多可能", "teal"),
    ]
    rows = [
        ("html", "HTML 语义结构", "foundation", [], "html", "用语义化标签组织文章、导航与表单，让页面结构清楚且可访问。"),
        ("css", "CSS 布局", "foundation", [], "css", "用盒模型、Flex 与 Grid 完成页面布局，并说明尺寸变化的原因。"),
        ("javascript", "JavaScript 基础", "foundation", [], "code", "用变量、函数、数组与对象完成数据处理，并理解作用域。"),
        ("dom", "DOM 与事件", "foundation", ["html", "javascript"], "cursor", "查询和更新 DOM，处理事件传播，并完成可交互的待办列表。"),
        ("web-api", "异步与 Web API", "foundation", ["javascript"], "globe", "使用 Promise 与 async/await 组织异步流程，并处理失败情况。"),
        ("responsive", "响应式页面", "foundation", ["html", "css"], "devices", "用媒体查询和弹性布局适配手机与桌面，并保持阅读顺序。"),
        ("git", "Git 版本管理", "engineering", [], "git", "完成提交、分支与合并，能定位和处理一次普通的合并冲突。"),
        ("npm", "npm / pnpm", "engineering", [], "package", "理解依赖清单与锁文件，安装依赖并运行项目脚本。"),
        ("vite", "Vite 构建工具", "engineering", ["npm", "javascript"], "bolt", "配置并启动 Vite 项目，区分开发服务与生产构建。"),
        ("modules", "模块化开发", "engineering", ["javascript"], "cubes", "用 import/export 拆分职责，避免循环依赖和全局变量耦合。"),
        ("conventions", "代码规范", "engineering", ["git", "npm"], "check", "为项目配置检查与格式化，并说明团队约定的实际用途。"),
        ("deploy", "自动化部署", "engineering", ["vite", "git"], "rocket", "从提交触发检查、构建与部署，能检查部署失败日志。"),
        ("vue", "Vue 基础", "framework", ["dom", "css"], "vue", "使用 Vue 的响应式数据、模板和指令完成一个交互页面。"),
        ("typescript", "TypeScript", "framework", ["javascript"], "typescript", "为对象、函数与接口声明类型，并处理联合类型的收窄。"),
        ("router", "Vue Router", "framework", ["vue"], "route", "配置页面路由、参数与导航守卫，处理刷新和不存在的页面。"),
        ("pinia", "Pinia 状态库", "framework", ["vue"], "database", "用 store 共享状态，区分页面局部状态与跨页面数据。"),
        ("components", "组件开发", "framework", ["vue", "typescript"], "cubes", "用 props、事件与插槽设计可复用组件，明确组件职责。"),
        ("state", "状态管理实践", "framework", ["pinia", "components"], "tree", "为复杂页面组织状态更新，避免重复来源和意外覆盖。"),
        ("fetch", "Fetch 请求", "application", ["web-api"], "globe", "使用 Fetch 请求接口，检查 HTTP 状态并处理取消与异常。"),
        ("axios", "Axios 请求", "application", ["web-api", "npm"], "globe", "使用 Axios 实例与拦截器组织请求，处理超时及错误响应。"),
        ("data", "接口数据处理", "application", ["dom"], "database", "将接口数据转换成视图需要的结构，展示加载、空数据与失败状态。"),
        ("business", "前端业务开发", "application", ["data", "components"], "briefcase", "把表单、列表与查询组合成业务流程，处理输入校验和重复提交。"),
        ("admin", "后台管理系统", "application", ["business", "router", "state"], "lock", "实现带权限提示的管理界面，并认识服务端鉴权的必要性。"),
        ("project", "完整项目实践", "application", ["admin", "deploy"], "monitor", "交付可访问的项目，说明需求、架构、运行步骤和主要取舍。"),
        ("performance", "性能优化", "quality", ["dom", "web-api"], "gauge", "用性能工具找出加载或交互瓶颈，对比优化前后的测量结果。"),
        ("security", "前端安全", "quality", ["dom", "web-api"], "shield", "识别 XSS 与不可信输入，解释凭据保护和服务端校验的职责。"),
        ("splitting", "代码分割", "quality", ["vite", "router"], "cubes", "按路由延迟加载资源，比较首屏体积与后续加载的取舍。"),
        ("testing", "组件与交互测试", "quality", ["components", "conventions"], "check", "验证用户可见的行为，覆盖失败路径并减少实现细节断言。"),
        ("monitoring", "监控与调试", "quality", ["performance", "security"], "chart", "结合日志、网络面板和错误监控复现并定位一个问题。"),
        ("quality-gate", "工程质量验收", "quality", ["testing", "monitoring", "splitting"], "medal", "结合检查、测试与性能证据验收项目，记录仍需改进的问题。"),
        ("echarts", "ECharts 图表", "extension", ["data"], "chart", "根据问题选择图表、编码和交互，避免用视觉效果误导数据。"),
        ("nodejs", "Node.js 基础", "extension", ["modules", "web-api"], "server", "编写简单的 HTTP 服务，理解路由、请求处理与异步 I/O。"),
        ("fullstack", "全栈协作", "extension", ["nodejs", "data"], "network", "约定接口格式、错误码与鉴权流程，让前后端能够独立协作。"),
        ("accessibility", "无障碍体验", "extension", ["responsive", "dom"], "person", "检查键盘操作、焦点顺序、名称和对比度，改进基本可访问性。"),
        ("opensource", "开源贡献", "extension", ["git", "conventions"], "git", "阅读贡献指南、复现问题并提交带验证步骤的小改动。"),
        ("portfolio", "个人作品集", "extension", ["project", "quality-gate"], "medal", "整理作品演示、设计取舍与改进记录，用证据呈现自己的能力。"),
    ]
    nodes = []
    for key, title, module, deps, icon, objective in rows:
        nodes.append({"id": f"fe.{key}", "title": title, "module_id": module, "objective": objective,
                      "knowledge_point_ids": [f"kp.{key}"], "prerequisites": {"all_of": [f"fe.{d}" for d in deps],
                      "any_of_groups": [["fe.fetch", "fe.axios"]] if key == "data" else []},
                      "kind": "milestone" if key in ("project", "quality-gate", "portfolio") else "extension" if module == "extension" or key in ("fetch", "axios") else "core",
                      "estimated_minutes": 60 if key in ("project", "quality-gate", "portfolio") else 35,
                      "icon": icon, "source_ids": ["mdn"] if module == "foundation" else ["vue-docs"] if module == "framework" else [],
                      "completion_rule_id": "concept-check-v1"})
    return validate_graph(CourseGraph.model_validate({"title": "前端学习国策树", "goal": "从网页基础到完整项目，逐步建立可以独立开发、调试与交付前端应用的能力。",
        "modules": [dict(zip(("id", "title", "description", "color"), m)) for m in modules],
        "knowledge_inventory": [n["knowledge_point_ids"][0] for n in nodes], "nodes": nodes,
        "relations": [{"source": "fe.typescript", "target": "fe.business", "kind": "recommended", "reason": "类型约束有助于整理业务数据，但不是开始业务练习的门槛。"},
                      {"source": "fe.accessibility", "target": "fe.quality-gate", "kind": "recommended", "reason": "建议将无障碍检查加入项目验收。"}],
        "sources": [{"id": "mdn", "title": "MDN Web 开发学习区", "url": "https://developer.mozilla.org/zh-CN/docs/Learn_web_development"},
                    {"id": "vue-docs", "title": "Vue 官方指南", "url": "https://cn.vuejs.org/guide/introduction.html"}]}))


def starter_html_package() -> dict:
    return {"lesson": "## 让 HTML 说明内容的含义\n\nHTML 的职责是表达文档结构。标题、段落、导航、表单都有各自的语义；外观交给 CSS 调整。不要因为某个标签默认更大，就用它代替合适的内容结构。\n\n### 先搭骨架\n\n页面主要内容放在 `<main>` 中，导航放在 `<nav>` 中。`<h1>` 说明页面主题，随后按内容层级使用 `<h2>` 和 `<h3>`。`<button>` 执行动作，`<a href=\"…\">` 跳转到其他位置。\n\n### 表单需要可识别的名称\n\n用 `<label for=\"email\">` 关联相同 id 的输入框。只写占位文字会在输入后丢失提示，也不能替代可靠的表单名称。\n\n### 实践检查\n\n关闭样式后阅读页面：结构是否仍然清楚？只使用键盘能否到达按钮和链接？这些检查比页面看起来整齐更能发现结构问题。",
        "example": "## 练习：一张课程报名卡\n\n```html\n<main>\n  <h1>前端入门课程</h1>\n  <p>学习网页结构、布局与交互。</p>\n  <form>\n    <label for=\"email\">联系邮箱</label>\n    <input id=\"email\" name=\"email\" type=\"email\" required>\n    <button type=\"submit\">报名</button>\n  </form>\n</main>\n```\n\n请在自己的编辑器中补上课程介绍和课程目录导航。用 Tab 键依次操作，检查焦点是否按阅读顺序移动。再说明：为什么报名使用 button，而课程资料链接使用 a？",
        "questions": [
            {"id": "semantic", "stem": "页面中的“提交报名”操作，最合适使用哪个元素？", "options": ["A. button", "B. 只有点击事件的 div", "C. h1", "D. 没有 href 的 a"], "answer": "A", "explanation": "button 原生表达动作，具备键盘和表单行为。"},
            {"id": "label", "stem": "让“联系邮箱”文字与输入框建立语义关联，应该怎么做？", "options": ["A. 只把文字放在旁边", "B. 只设置 placeholder", "C. 让 label 的 for 对应 input 的 id", "D. 增加字体大小"], "answer": "C", "explanation": "for 与 id 建立明确关联，也支持点击标签聚焦输入框。"},
            {"id": "headings", "stem": "决定 h1、h2、h3 的依据应该是什么？", "options": ["A. 默认字体大小", "B. 内容的逻辑层级", "C. 想要的颜色", "D. 屏幕分辨率"], "answer": "B", "explanation": "标题层级反映内容结构，视觉大小可用 CSS 调整。"},
            {"id": "nav", "stem": "哪个元素更适合表达一组主要导航链接？", "options": ["A. input", "B. canvas", "C. label", "D. nav"], "answer": "D", "explanation": "nav 表达页面或站点的主要导航区域。"},
        ], "pass_ratio": 0.75, "assessment_scope": "概念核验；项目实践还需结合实际作品检查。", "source_ids": ["mdn"]}
