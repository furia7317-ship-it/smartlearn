# 学枢前端

这里包含 Next.js 界面和 Electron 桌面壳。完整项目的安装、服务配置和功能介绍见 [根目录 README](../README.md)。

## 开发

使用 Node.js 24。在本目录执行：

```bash
npm ci
npm run dev
```

应用入口是 `http://127.0.0.1:3000/desktop/`。默认连接同一主机的 8000 端口；后端的安装和启动步骤见根目录 README。需要使用其他接口地址时，通过 `NEXT_PUBLIC_API_BASE` 配置。

桌面主导航包括首页、学习路径、实训中心、资源中心和发现。智能教师在不同页面间共用同一个窗口；学习内容、练习和考试记录通过后端保存。

## 构建与检查

```bash
npm test
npm run lint
npm run build
npm start
```

构建结果放在 `out/`，`npm start` 用于本地查看静态前端。网页部署示例见 [deploy/README.md](deploy/README.md)。

## Windows 安装包

```powershell
npm run app:dist
```

构建流程会准备桌面端需要的运行资源，并用 electron-builder 生成安装包，产物放在 `dist-electron/`。Electron 自带 Chromium，无需额外依赖 WebView2。

普通打包配置不携带用户数据库或服务密钥。私有演示发行使用另一份配置，说明见 [desktop-demo-build.md](../docs/desktop-demo-build.md)。

## 主要目录

- `app/`：路由和页面入口。
- `components/`：界面、资源查看器和智能教师组件。
- `hooks/`：会话、事件和页面状态。
- `lib/`：接口、数据类型和前端业务逻辑。
- `electron/`：主进程、预加载脚本和桌面启动逻辑。
- `public/`：界面图片、字体、音效和浏览器运行资源。
- `tests/`：逻辑测试与页面约定检查。

本项目代码采用 [MIT 协议](../LICENSE)，第三方资源保留各自的授权说明。
