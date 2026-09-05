# 学枢 · AI 个性化学习平台

> 面向高等教育的 AI 个性化学习系统 —— 以 **LangGraph 多智能体协同** 为核心，把"难学的"讲成"你能学的"。
> 内置《数据结构》等计算机专业课程知识库。

学枢不是一个"问答机器人"，而是一支**分工明确的 AI 教研团队**：你用一句话说出专业、目标和卡点，十多个智能体会检索课程知识库、构建你的学习画像、并行生成多模态学习资料（讲义 / 导图 / 题库 / 代码 / 动画 / 课件），经质检官逐条与知识库比对、标注引用来源后交付，再编排出一条随学习数据动态调整的个性化路径。

---

## ✨ 核心亮点

- **多智能体协同生成**：总控调度官分诊 → 7 个生成智能体并行扇出 → 质检审核官逐项审核（可驳回重做），全过程经 SSE 实时回传到前端。
- **云端 LLM + 本地 RAG**：用云端大模型（DeepSeek）负责"想"，本地向量库（bge 中文嵌入 + ChromaDB）负责"查"。知识库提前准备，生成内容必须引用库内片段。
- **真·防幻觉**：审核环节用**嵌入相似度**把每条事实性陈述与知识库溯源比对（而非字符串匹配），未对齐的内容驳回重做并标注。
- **一份学习会话，全站联动**：对话产出的画像、资源、路径、练习成绩共用同一份会话。会话存入 SQLite，浏览器保留当前窗口的未同步草稿；多个窗口同时修改时保留冲突副本并显示提示。
- **资源点开即用**：讲义（Markdown）、思维导图（可折叠 + 点节点跳章节）、题库（在线作答 + 即时评分 + 解析）、代码、拓展阅读、**应用内动画讲解播放器**（无需 ffmpeg）、课件大纲，七类资源各有专属查看器。
- **缺什么补什么**：知识库没有的科目 → 联网找教材（博查，国内可达）/ 按专业年级智能荐书 / **未命中自动询问"下载哪一版"教材**（类 Claude 单选），下载即向量化入库。
- **桌面端零安装依赖启动**：Electron 一体安装包自带 Python 后端 + 中文嵌入模型 + 知识库种子；需要模型生成或联网检索时仍须配置相应服务凭据并联网。

---

## 🧠 系统架构

```
┌──────────────────────────── 前端 (Next.js / React) ────────────────────────────┐
│  AI 工坊  学习总览  学习画像  学习路径  资源中心  练习与错题  课程知识库  设置        │
│        └──────────── 共用一份「学习会话」(OrchestratorProvider) ───────────┘        │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                     │  POST + SSE (plan / progress / content / review / done)
                                     │  REST (检索 / 荐书 / 入库 / 题库 / 画像 …)
┌────────────────────────────────────▼───────────────────────────────────────────┐
│                         后端 (FastAPI + LangGraph)                               │
│                                                                                 │
│   资源生成图：  Supervisor 分诊 ──► [explainer mindmap quiz reading              │
│                                      code video courseware] 并行扇出             │
│                                          └──► Reviewer 审核 ──(驳回)──► 重做      │
│                                                                                 │
│   云端 LLM (DeepSeek)         本地 RAG (bge-small-zh + ChromaDB)                 │
│   讯飞 TTS/IAT/OCR · Remotion/FFmpeg 视频 · 防幻觉 · 画像/路径/题库/错题/记忆       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**交付形态**

| 形态 | 说明 |
| --- | --- |
| 桌面一体安装版 | Electron 壳 + 自带 Python 后端/模型/知识库种子，`app://` 协议离线加载，双击即用 |
| 离线状态 | 后端不可达时明确显示服务未连接；保留已缓存的本地学习记录，不伪造生成结果或答疑内容 |

---

## 🤝 多智能体团队

围绕「画像 → 分诊 → 生成 → 审核 → 规划 → 辅导」的教研闭环：

| 智能体 | 角色 | 职责 |
| --- | --- | --- |
| 学情画像师 `profiler` | 画像 | 从对话语义抽取 6 维学习特征、定位易错点 |
| 总控调度官 `supervisor` | 分诊 | 检索知识库 + 结合画像，决定本轮生成哪些模块 |
| 概念讲解官 `explainer` | 生成 | 通俗讲解 + 生活类比 + 引用角标 |
| 导图架构师 `mindmap` | 生成 | 知识结构树（中心主题 → 分支 → 子节点） |
| 题库命题官 `quiz` | 生成 | 按薄弱点定向命题（选择 / 填空 + 解析） |
| 拓展阅读官 `reading` | 生成 | 延伸材料 + 关键术语 + 思考题 |
| 代码教练 `code` | 生成 | 可运行代码示例 + 逐行解释 + 变体 |
| 动画导演 `video` | 生成 | Remotion 分镜脚本 + 旁白（前端可直接播） |
| 课件设计师 `courseware` | 生成 | PPT 大纲（标题页 → 内容 → 总结） |
| 质检审核官 `reviewer` | 审核 | 防幻觉：逐项与知识库嵌入相似度溯源，不达标驳回 |
| 路径规划师 `planner` | 规划 | 综合画像 × 资源 × 考期编排个性化路径 |
| 答疑辅导师 `tutor` | 辅导 | 实时检索 + 流式答疑，带 `[来源n]` 角标 |

> 另含 `classifier / analyst / grader / examiner` 等辅助智能体，支撑分类、分析、判分与组卷。

**资源生成图（LangGraph）**：`Supervisor` 自适应分诊（如冲刺题选 6 模块、概念题选 4 模块）→ `Send` 并行扇出 → `Reviewer` 审核，首轮有驳回则 `Send` 回对应生成器重做一轮 → `done`。事件流见 `backend/app/core/sse.py`。

---

## 📚 功能模块

| 页面 | 路由 | 能力 |
| --- | --- | --- |
| **AI 工坊** | `/studio` | 对话式多智能体协同生成，SSE 实时事件流，等待首响应时显示「思考中…」，右侧「协同 / 画像 / 路径」面板同步 |
| **学习总览** | `/` | 从当前会话派生：画像均值、已过审资料、知识库引用数、路径阶段、当前主线与薄弱点 |
| **学习画像** | `/profile` | 6 维画像雷达，随对话与测验实时更新（无需填表） |
| **学习路径** | `/path` · `/path/study` | 直接读取路径智能体生成的阶段、任务与资料；支持完成状态、资料查看和**框选文字 → AI 解释** |
| **资源中心** | `/resources` | 七类资源汇总，按**类型 / 质检状态**筛选；点开即用的专属查看器；驳回重做的版本自动隐藏 |
| **练习与错题** | `/practice` | 会话题库在线作答 + 即时评分 + 解析；错题按结果**自动归档错题本**，联动路径复盘 |
| **课程知识库** | `/kb` | RAG 语义检索；联网找教材；按专业 + 年级智能荐书；**未命中自动询问下哪一版教材**；课程文档清单 |
| **设置** | `/settings` | 全局学情（专业 / 年级），驱动智能荐书与个性化生成 |

**七类资源查看器**：讲义→Markdown 渲染（概述 / 详解 / 类比 / 要点 / 来源）；导图→可折叠节点树 + 点击跳转该知识点资源；题库→可交互答题器（评分 + 逐题解析 + 掌握度 + 再做一遍）；代码→代码块 + 解释 + 输出 + 变体；阅读→正文 + 术语 + 思考题；视频→**应用内动画讲解播放器**（分镜自动推进 + 字幕 + 播放控制）；课件→幻灯片大纲。

---

## 🛡️ 知识库与防幻觉

- **嵌入模型**：`BAAI/bge-small-zh-v1.5`（中文检索，512 维），余弦空间 + 向量归一化 + bge 查询指令前缀；索引向量额外携带文档标题和章节标题，展示正文保持不变。
- **混合检索**：Chroma 向量召回 + BM25 + RRF 融合，并抑制同一文档的相邻/重叠 Chunk；可通过本地 CrossEncoder 做候选精排。
- **版本化索引**：课程精编库由 `knowledge/` Markdown 智能分块导入，新集合校验完整后再原子切换；模型、分块或嵌入协议变化会触发重建。
- **检索评测**：`backend/scripts/evaluate_rag.py` 输出 Recall@K、MRR、负样本误命中率、P95 延迟和重排器状态，支持基线/重排 A/B。
- **防幻觉**：`anti_hallucination.verify_factual_claims` 抽取陈述 → 与知识库片段计算嵌入相似度 → 低于阈值即判为未溯源（可注入 embedder 便于单测）。
- **联网资料隔离**：博查搜索/下载的教材进**独立 `web_kb` 集合**，不污染精编库、不参与防幻觉裁判。
- **未命中即荐版**：检索按**相关度**（非条数）判断"没这门科目"，触发 LLM 列出该科目主流教材版本供选择下载。

---

## 🧰 技术栈

**前端** `frontend/`
- Next.js 16（App Router · Turbopack · `output: "export"` · `trailingSlash`）、React 19、TypeScript 5
- Tailwind CSS v4、framer-motion（动效）、recharts（画像雷达，懒加载）、react-markdown + remark-gfm、lucide-react、next-themes
- 设计系统「墨与朱批」：冷墨中性底 + 朱红只承载批改语义；宋体标题、楷体批注声线；朱印「智」字章为品牌标识

**后端** `backend/`
- FastAPI、LangGraph（多智能体编排）、Pydantic、Uvicorn
- ChromaDB + sentence-transformers（bge 中文嵌入）、async SQLAlchemy + SQLite
- DeepSeek（云端 LLM）、讯飞 IAT/OCR/TTS、Remotion + FFmpeg（视频）、httpx + BeautifulSoup（联网抓取）

**桌面端** `frontend/electron/`
- Electron 42 + electron-builder（NSIS），按哈希锁文件构建的独立 Python 3.11.15 运行时 + 离线中文嵌入模型 + ChromaDB 种子
- 主进程监管后端（spawn uvicorn、健康轮询、退出杀进程树），渲染进程经 `app://` 协议加载静态前端

---

## 🗂️ 目录结构

```
smartlearn/
├─ frontend/                 # Next.js 前端 + Electron 桌面壳
│  ├─ app/                   # 路由页面（/ studio profile path practice resources kb settings）
│  ├─ components/            # UI 组件（资源查看器 / 答题器 / 视频播放器 / 思考中指示器 …）
│  ├─ hooks/                 # use-orchestrator（协同编排引擎，真实 SSE + 会话持久化）
│  ├─ lib/                   # api(SSE 解析) / types / identity / study-plan / session-insights
│  ├─ electron/              # 主进程、启动页、打包配置
│  └─ runtime/              # 打包期自包含 Python 运行时 + 模型 + 种子（不进 git）
├─ backend/                  # FastAPI + LangGraph 后端
│  └─ app/
│     ├─ agents/             # 15 个智能体（profiler/supervisor/explainer/.../tutor）
│     ├─ graph/              # LangGraph 状态图（资源 / 画像 / 辅导 / 测评 / 组卷）
│     ├─ routers/            # 16 个路由（agents/chat/kb/papers/profile/path/…）
│     ├─ services/           # rag / anti_hallucination / web_search / media / memory …
│     └─ core/               # config / llm / sse 协议
└─ knowledge/                # 计算机专业课程知识库（18 章 Markdown，向量化源）
```

---

## 🚀 运行方式

> 前置：Node 24、uv、Python 3.11.15（由 uv 安装）。后端服务凭据写入 `backend/.env`；桌面安装版也可在用户数据目录的 `backend.env` 中配置。仓库和安装包不内置服务密钥。

**① 开发预览**
```powershell
# Windows / PowerShell 7：后端
cd backend
uv python install 3.11.15
uv venv --python 3.11.15
uv pip sync --python .venv/Scripts/python.exe --require-hashes requirements-windows.lock
# 若 .env 仍指向旧 WSL 路径，指定同一嵌入模型的本机文件目录：
# $env:EMBEDDING_MODEL = (Resolve-Path ../frontend/runtime/assets/models/bge-small-zh-v1.5).Path
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 前端（另开一个终端）
cd frontend
npm ci
npm run dev                                    # http://localhost:3000/desktop/
```

Linux 使用同一 Python 版本和 `requirements-linux.lock`，解释器路径为 `.venv/bin/python`。Linux 锁文件保留现有 PyTorch 版本所声明的 CUDA 依赖，下载量比 Windows 大；本次没有替换嵌入模型或改用另一套推理引擎。

生产静态预览运行 `npm run build` 后执行 `npm start`，默认监听 `127.0.0.1:3000`，可通过 `PORT` 更改端口。

首次使用请在登录页自行注册账户；仓库和安装包均不包含预置账号、数据库或服务密钥。

**② 打桌面安装包**
```bash
cd frontend && npm run app:dist                # next build + electron-builder
# 产物：frontend/dist-electron/学枢-一体安装版-0.1.14.exe
```

> **模式说明**：前端启动时自动探测后端。后端在线时提供真实生成、检索、荐书与答疑；后端不可达时明确显示连接问题，不自动填充示例资源或虚构结果。

**运行时与数据升级**

- `prepare:python-runtime` 在独立目录安装并校验 `requirements-windows.lock`，校验通过后才切换；旧运行时保留在 `frontend/runtime/python.previous-*` 以便回退。可用 `--stage-only` 只构建，用 `--check` 检查当前运行时。
- 更新依赖时先维护 `runtime-constraints.txt`，再用 `uv pip compile` 分别生成 Windows / Linux 的哈希锁文件；不要把开发环境的整个 `site-packages` 复制进安装包。
- 数据库启动迁移由 `schema_migrations` 记录版本，升级前在数据库旁的 `.schema-backups/` 创建 SQLite 一致性备份；迁移失败会回滚，较旧程序拒绝打开未知的新版本结构。
- 会话保存携带 `revision`，冲突返回 409；仅 `deleted_session_ids` 明确列出的会话会被删除。前后端应同时更新。未同步草稿按账户和窗口隔离，刷新当前窗口可恢复；关闭窗口后的草稿尚无独立恢复入口。

**提交前检查**
```bash
cd frontend
npm test
npx tsc --noEmit
npx eslint app components hooks lib electron --max-warnings=0
npm run build

cd ../backend
uv pip install --python .venv/Scripts/python.exe -e ".[dev]" -c runtime-constraints.txt
.venv/Scripts/python.exe -m pytest
.venv/Scripts/python.exe -m ruff check app tests
```

---

## 🌐 国内化适配

- **嵌入模型**走 `hf-mirror.com` 逐文件下载（避开被墙的 HuggingFace），运行时离线加载。
- **联网找教材**用博查（`api.bochaai.com`）Web Search，国内不翻墙可达。
- **字体**用系统字体栈（Google Fonts 不可达），shadcn 注册表不可达的组件均手写。
- **Electron / 构建二进制**走 npmmirror 镜像。

---

<sub>学枢 · AI 个性化学习平台</sub>
