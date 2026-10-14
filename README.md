# 学枢：AI 个性化学习平台

学枢是一个面向大学课程学习的 AI 应用。你可以先告诉它要学什么、目前的基础和目标，再沿着学习路径阅读资料、练习和做项目。遇到不懂的地方，可以打开智能教师继续提问。

前端、后端和 Windows 桌面端的打包代码都在这个仓库里。

[在线体验](https://furia7317.art/) · [报告问题](https://github.com/furia7317-ship-it/smartlearn/issues) · [MIT 协议](LICENSE)

## 能做什么

**安排学习路径。** 把学习目标整理成课程和知识点，按实际的前置关系显示分支。节点里有学习目标、资料、练习和核验；每日可用时间用于安排任务。旧课程也可以从目录生成新的知识树。

**生成和管理学习资料。** 根据课程内容准备讲义、思维导图、练习题、代码示例、视频和课件。生成任务由不同智能体分工完成，审核时会结合知识库检查内容和引用。资料会保存在资源中心，方便以后继续看。

**把抽象知识讲具体。** 代码可视化用于观察程序过程；实训中心支持编写、运行和提交代码；情景剧场用角色对话展示知识。可以根据需要选择讲解方式，再回到课程里继续学习。

**随时向教师提问。** 智能教师可以结合当前页面和学习记录答疑，也支持语音通话。语音识别和语音合成使用单独配置的服务，回答会分段送去合成和播放。

**记住学习情况。** 应用会保存用户设置、学习记录和相关对话信息。长期记忆可以在设置中关闭，也可以管理已有内容，减少跨会话反复说明背景的麻烦。

**积累可复用的教学方法。** 系统可以从资料审核和返工记录中提出新的方法，也就是过程 Skill。候选方法需要检查并启用后才参与后续生成，可以查看版本、停用或回退。这部分改进的是工作步骤，不是重新训练模型。

AI 生成的资料和学习安排仍需要检查。知识库检索和审核能提供依据，但不能保证每个回答都正确；节点上的概念题核验也不能替代实际编程或项目验收。

## 本地运行

需要 Node.js 24、Python 3.11.15 和 uv。版本分别写在 `.node-version` 和 `backend/.python-version` 中，后端提供带哈希的 Windows、Linux 依赖锁文件。

### 1. 获取源码

```bash
git clone https://github.com/furia7317-ship-it/smartlearn.git
cd smartlearn
```

### 2. 配置并启动后端

Windows 使用 PowerShell 7：

```powershell
cd backend
uv python install 3.11.15
uv venv --python 3.11.15
uv pip sync --python .venv/Scripts/python.exe --require-hashes requirements-windows.lock
Copy-Item .env.example .env
```

打开 `backend/.env`，按需填写服务配置：

- 学习资料生成和答疑需要可用的模型。可以填写 DeepSeek 等预设的密钥，也可以启动后在“设置 → 模型与服务”中添加 OpenAI 兼容接口。
- 知识库检索需要 `SILICONFLOW_API_KEY`。嵌入和重排序调用云端服务，向量索引由本地 ChromaDB 保存。
- 语音、OCR 和联网搜索按需要配置，对应项目在 `.env.example` 中有说明。

填好后启动：

```powershell
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

后端地址是 `http://127.0.0.1:8000`，接口文档在 `http://127.0.0.1:8000/docs`。首次使用知识库时需要建立索引，所用服务必须能联网。

Linux 对应的安装和启动命令：

```bash
cd backend
uv python install 3.11.15
uv venv --python 3.11.15
uv pip sync --python .venv/bin/python --require-hashes requirements-linux.lock
cp .env.example .env
# 编辑 .env 后再启动
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 3. 启动前端

在项目根目录另开一个终端：

```bash
cd frontend
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000/desktop/`，注册自己的账号后使用。后端没有连接时，界面会提示连接问题；生成、检索和语音功能需要相应的云服务配置。

Windows 装好依赖后，也可以双击根目录的 `启动学枢.cmd` 启动前后端。用法见 [一键启动说明](docs/一键启动.md)。

登录页保留了公开演示账号的入口，方便体验已部署的演示服务。源码仓库不包含该账号的数据库；自己运行的空数据库需要自行注册，演示入口不会自动创建账号。

## Windows 桌面端

桌面端使用 Electron，前端静态文件和 Python 后端会一起打包：

```powershell
cd frontend
npm ci
npm run app:dist
```

脚本会准备 Python、Node 和媒体运行资源，再构建前端和安装包。这个过程需要联网，也会比网页构建花更多时间。生成的安装包在 `frontend/dist-electron/`。

普通安装包不带用户数据库或模型服务密钥。首次启动创建本地数据，服务配置可以放在 `%APPDATA%/学枢/backend.env`。单独的私有演示打包流程见 [演示发行说明](docs/desktop-demo-build.md)；它的产物不适合公开分发。

## 代码放在哪里

```text
frontend/              Next.js 页面、React 组件和 Electron 桌面壳
backend/app/           FastAPI 接口、智能体、数据模型和业务服务
backend/tests/         后端测试
frontend/tests/        前端逻辑和页面约定检查
knowledge/             随项目提供的课程知识资料
scripts/               本地启动工具
docs/                  配置、功能和打包说明
```

界面使用 Next.js、React 和 TypeScript；后端使用 FastAPI、LangGraph 和 SQLAlchemy；学习数据保存在 SQLite，知识向量保存在 ChromaDB。知识树画布使用 React Flow 和 ELK。

进一步的实现说明：

- [学习路径知识树](docs/focus-curriculum.md)
- [教学方法和过程 Skill](docs/procedure-skills.md)
- [云端检索配置](docs/cloud-retrieval.md)
- [静态前端部署](frontend/deploy/README.md)

## 开发与检查

```powershell
# 在 backend 目录
.venv/Scripts/python.exe -m pytest

# 在 frontend 目录
npm test
npm run lint
npm run build
```

`npm run build` 生成静态前端。需要本地查看构建结果时，再运行 `npm start`。模型和语音的真实效果取决于所用服务，模拟接口的测试不能代替实际使用检查。

欢迎提交问题和改进。报告问题时，写清操作步骤、预期结果和实际结果；附上日志前，请先去掉密钥和个人信息。

## 协议

仓库自身的代码采用 [MIT 协议](LICENSE)，可以学习、修改和商用，使用时保留版权与协议声明。第三方依赖、字体、图标和音效按各自附带的协议使用。
