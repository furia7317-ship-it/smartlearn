# 学枢 · 前端

高等教育个性化学习平台的桌面前端工程。Next.js 负责界面和静态导出，Electron 负责桌面壳并启动随包分发的本地 Python 后端。

界面采用面向桌面端的书卷式视觉体系，提供分页仪表盘、页面过场动画和统一的业务交互。

## 快速开始

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

## 打包成桌面应用（Electron）

桌面程序会随包启动本地 Python 后端；后端不可用时只显示连接提示，不生成占位回答。

```powershell
cd frontend
npm install
npm run app:dist      # 静态导出 + electron-builder 出 exe
```

产物在 `frontend/dist-electron/`：

- `学枢-一体安装版-0.1.14.exe` — NSIS 安装包，可选目录、建桌面快捷方式

安装包不携带 SQLite 用户库、固定账号或服务密钥。首次启动时创建空数据库，用户从登录页自行注册；公共课程知识索引单独随包分发。

**原理**：前端 `output: "export"` 导出纯静态站到 `out/`；Electron 主进程（`electron/main.js`）
注册 `app://` 自定义协议把窗口请求映射到 `out/`，离线加载、不占端口；
若本机同时跑了后端（`:8000`），桌面程序内会使用真实后端。

**环境**：仅需 Node 18+（用现成 Node 打包，无需 Rust/MSVC）；Win11 自带 WebView2；
一体安装包包含 Chromium、Python 后端和离线模型。应用图标使用红熊猫学习伙伴吉祥物。

## 功能模块

| 路由 | 模块 | 后端能力 |
|---|---|---|
| `/` | 学习总览 | dashboard/assess/behavior |
| `/studio` | AI 工坊 | 对话式画像 + 多智能体资源生成 · chat/agents/graph |
| `/profile` | 学习画像 | 6 维画像 · 易错点档案 · 画像演变 · profile |
| `/path` | 学习路径 | 路径规划 + 动态调整记录 · path/goals |
| `/resources` | 资源中心 | 多模态资源库（筛选 + 行内预览）· media |
| `/practice` | 练习与错题 | 试卷库 + 互动样题 + 错题本 · papers/wrongbook |
| `/kb` | 课程知识库 | 文档集 + RAG 检索 · kb |

## 与后端的对接（已接通）

前端启动时探测后端（`GET :8000/`）并自动选择运行模式，工坊工具栏有状态徽标：

- **在线模式**（后端已连接）：
  - 首条消息 → `POST /api/agents/resource`（SSE）：真实 LangGraph 资源生成，
    `plan / progress / content / review / done` 事件实时驱动协同面板、资源卡与事件流终端；
  - 后续消息 → `POST /api/chat`（SSE）：辅导图 `delta` 逐字流式作答 + 来源角标；
  - 知识库页检索 → `GET /api/kb/search`（ChromaDB 实时命中）。
- **离线状态**（后端不可达）：前端显示后端未连接，不再合成脚本数据。

接入层：`lib/api.ts`（含 POST-SSE 流解析器）；事件映射：`hooks/use-orchestrator.ts`。
后端启动：`cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000`。

## 目录结构

```
app/                 # Next.js App Router（layout / page / 主题样式）
components/
  ui/                # shadcn/ui 基础组件（源码内置）
  agent-panel.tsx    # 多智能体协同管线 + SSE 事件流终端
  chat.tsx           # 对话区：流式 Markdown / 分诊计划块 / 资源网格 / 输入框
  resource-card.tsx  # 多模态资源卡（6 类迷你预览）
  profile-panel.tsx  # 6 维画像雷达图
  path-panel.tsx     # 学习路径时间轴
hooks/use-orchestrator.ts  # 会话编排、SSE 事件和业务状态
lib/starter-content.ts     # 首次使用提示和画像初始值
lib/agents.ts        # 12 个智能体花名册（与后端对应）
```

## 开源项目与协议

| 项目 | 用途 | 来源 | 协议 |
|---|---|---|---|
| Next.js | React 应用框架 | github.com/vercel/next.js | MIT |
| React | UI 框架 | github.com/facebook/react | MIT |
| Tailwind CSS v4 | 原子化样式 | github.com/tailwindlabs/tailwindcss | MIT |
| shadcn/ui | 基础组件体系（源码复制模式） | github.com/shadcn-ui/ui | MIT |
| Radix UI | 无障碍交互原语（Tabs/Tooltip 等） | github.com/radix-ui/primitives | MIT |
| Vercel AI Elements | AI 对话界面设计范式参考（Conversation/Task/Response） | github.com/vercel/ai-elements | Apache-2.0 |
| Framer Motion | 动效 | github.com/motiondivision/motion | MIT |
| Recharts | 雷达图 | github.com/recharts/recharts | MIT |
| react-markdown + remark-gfm | Markdown 流式渲染 | github.com/remarkjs | MIT |
| Lucide | 图标 | github.com/lucide-icons/lucide | ISC |
| next-themes | 明暗主题 | github.com/pacocoursey/next-themes | MIT |

> 说明：shadcn/ui 与 AI Elements 均为「源码分发」模式的组件体系，本项目按其推荐方式将组件源码
> 内置于 `components/ui/`（因网络环境限制由人工内置等价源码，样式与官方 new-york 风格一致）。
> 多模态资源由后端智能体（Manim 渲染、讯飞 TTS/OCR 等）产出。
