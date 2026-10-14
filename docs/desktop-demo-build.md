# Windows 演示安装版

这套流程把指定的演示账号和服务配置放进一个私有安装包，适合受控演示。普通的 `app:dist` 不携带这些数据。演示版名称为“学枢演示版”，使用独立的应用 ID、安装目录和 `%APPDATA%/学枢演示版` 数据目录。

导出器从工作数据库的一致性读事务中，把演示账号及其所属记录插入一个全新数据库。它不会删除原数据库的数据，也不会把其他账号的已删除页面或登录会话复制进包。公共知识向量和演示账号的记忆向量也分别筛选导出。发现未知数据表或其他账号引用时，导出会停止，要求先补充归属规则。

密钥来源包括显式指定的环境文件（后指定的非空值优先）和数据库中的模型配置。密钥只进入被 Git 忽略的 `frontend/runtime/private-demo` 和安装产物；不要把该安装包公开上传。

在 PowerShell 7 中执行，按本机实际路径调整运行工具与环境文件参数：

```powershell
cd frontend
npm run prepare:python-runtime
npm run prepare:knowledge-seed
npm run prepare:remotion-runtime
node scripts/prepare-desktop-tools.mjs --ffmpeg-root 'C:/Tools/ffmpeg' --jdk-root 'C:/Tools/jdk'
cd ..
frontend/runtime/python/python.exe backend/scripts/prepare_demo_bundle.py --login furia --env-file frontend/runtime/assets/backend.env --env-file "$env:APPDATA/学枢/backend.env" --env-file backend/.env
cd frontend
npm run build
npm run prepare:electron-app
npx electron-builder --config electron-builder.demo.cjs --win nsis --x64
```

输出位于 `frontend/dist-electron-demo/学枢-演示安装版-0.1.14.exe`。内置前端、FastAPI 后端、Python、Node、Remotion、视频渲染用 Chromium、FFmpeg、C/C++ 编译器与 JDK。AI 模型、搜索、语音识别与合成仍调用云服务，需要联网且服务密钥有效。

首次启动复制演示数据，此后保留用户修改。原账号密码摘要保持不变。安装包不携带登录会话，打开后需使用 `furia` 原有密码登录。`--user-data-dir=<绝对路径>` 可指定独立验证目录，便于检查新安装和二次启动而不触碰现有数据。

资料正文在 SQLite 中；已有代码可视化与视频按文件清单中的账号归属导出，视频路径在首次启动时改为安装电脑上的路径。没有账号归属的临时音频、其他账号的产物不会进入包。未来如果增加 `media_assets` 表管理的文件，导出器会停止，需先补充明确的文件归属清单。
