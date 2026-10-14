# 静态前端部署

`npm run build` 会生成 `out/` 目录。这个目录可以由 Nginx 等静态文件服务器提供，后端单独运行。

## 配置与构建

在 `frontend` 目录中设置接口前缀后构建：

```powershell
$env:NEXT_PUBLIC_API_BASE='/backend'
npm ci
npm run build
```

示例配置 [nginx.tencent.conf](nginx.tencent.conf) 使用 `/backend/` 转发到 `http://smartlearn-backend:8000/`，静态文件目录为 `/usr/share/nginx/html`。使用前请按自己的容器服务名和路径修改。

配置中的 HTTPS 跳转域名 `furia7317.art` 是项目演示站的域名。部署到其他域名时，需要改成自己的域名，并配置对应的 HTTPS 证书。网站有备案号时，可通过 `NEXT_PUBLIC_ICP_NUMBER` 设置页脚展示；没有时留空。

这些变量参与前端构建。改变它们以后需要重新构建，不能只修改静态服务器的运行环境。

## 缓存和接口

- `/_next/static/` 的文件名包含内容哈希，可以长期缓存。
- `/brand/`、`/audio/`、`/voice-assets/` 的图片和音频使用一小时缓存；替换资源时可以换文件名。
- HTML 使用 `no-cache`，接口使用 `no-store`。
- 流式回答和 WebSocket 需要保留代理配置。不要给接口开启缓存或响应缓冲。
- 静态资源不存在时返回 404。

发布新前端时，保留上一版的哈希文件一段时间，便于已经打开的页面继续加载。前端更新通常不需要迁移后端数据；回退界面版本也不应回退用户数据库。

改了访问域名以后，需要重新登录，原域名的会话 Cookie 不会迁移到新域名。服务密钥放在后端配置中，不放进前端构建变量。
