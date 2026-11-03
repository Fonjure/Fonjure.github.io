# 凑一局总站

[fonjure.github.io](https://fonjure.github.io/) 是凑一局的固定入口。它显示最新服务器的公开连接状态、手动进入游戏的按钮，以及作者疯不觉的小红书名片。页面不会自动跳转；旧域名的提示页引导玩家回到本站，避免更换服务器后收藏失效。

当前游戏服务器是[香港主站](https://hk.couyiju-fonjure.dns.army/)。游戏源码与部署流程保存在另一个私有仓库 `Fonjure/couyiju`；此公开仓库只有门户静态文件，不含游戏源码、题库、账号、会话、记录、密钥或数据库。

## 文件结构

- `index.html`：门户页面，默认提供可点击的服务器入口；不依赖 JavaScript 也能手动进入游戏。
- `404.html`：与首页相同的门户，支持从旧的深路径邀请进入；修改门户后应同步此文件。
- `assets/site.css`：无外部依赖的响应式样式，米白背景、简洁排版，兼容手机。
- `assets/site.js`：读取公开配置、检查 `/health`、手动重试及复制小红书号。不会连接游戏 WebSocket 或调用账号、会话接口，不写浏览器账号存储。
- `assets/xiaohongshu.jpg`：用户提供的小红书名片原图，按原字节复制。不要裁剪、重绘、压缩或重新生成二维码；页面可打开原图和保存图片。小红书号为 `841618732`。
- `site-config.json`：公开的服务器与维护配置；**不要放任何密码、API Token、SSH 密钥或个人游戏数据**。
- `.nojekyll`：让 GitHub Pages 直接发布静态文件。

## 服务器与维护配置

一般换服或维护只需编辑 `site-config.json`：

```json
{
  "serverOrigin": "https://hk.couyiju-fonjure.dns.army",
  "serverName": "香港服务器",
  "maintenance": false,
  "maintenanceMessage": "服务器正在维护，请稍后再来。"
}
```

`serverOrigin` 必须是 HTTPS 纯来源地址，不含用户名、密码、路径、查询参数或片段；末尾斜杠可省略。`serverName`、`maintenanceMessage` 是可选展示文案；可额外保留 `updatedAt` 供维护者记录更新时间，页面不依赖它。`maintenance` 只有布尔值 `true` 表示主动维护，此时不请求健康接口，并暂停进入游戏的按钮；恢复为 `false` 后重新检测服务器。

换服还需要同步 `index.html`、`404.html` 的默认链接和 `assets/site.js` 的 `DEFAULT_ORIGIN`，供 JavaScript 加载失败、配置不可读或禁用脚本时使用。新后端必须允许来自 `https://fonjure.github.io` 的 CORS 健康检查。门户不需要后端密钥，也不应携带玩家 Authorization 或 Cookie。

进入按钮保留原来的路径、查询参数和 URL 片段，例如 `/?room=ABC123#join` 会带到所配置服务器。`/index.html`、`/404.html` 自身会归一为服务器首页。查询参数里的 `next` 等值不会改变目标来源，因此不构成开放重定向。

## 状态含义

打开页面时检测一次，也可点击“重新检测”；不会持续轮询。配置与健康检查共用约 7 秒超时，且不使用浏览器请求缓存。

- **服务器运行正常**：HTTP 成功，且 JSON 中 `service=couyiju-server`、`protocol=1`、`runtime=node`，`status`、`storage`、`database`、`rooms` 均为 `ok`。
- **维护中**：本站主动维护开关开启，或健康响应明确包含 `maintenance: true` / `status: maintenance`。按钮暂停使用。
- **服务暂不可用**：服务器已返回 HTTP 错误（包括没有明确维护声明的 503），或正确的 Node 健康响应表明组件暂未恢复。不能据此宣称正在计划维护。
- **连接失败 / 请连接梯子**：网络、超时、CORS、配置读取失败或无法识别健康响应。它只表示当前访问者无法确认状态，**不等于全服维护**；仍可手动尝试进入游戏。JavaScript 未加载时也保留此默认提示和原始入口。

健康状态只反映本次检查，不保证之后的每一次游戏连接成功。本站不检测或修改访问者的代理设置。

## 编辑、预览和发布

这是独立的公开仓库 `Fonjure/Fonjure.github.io`，仅发布 `main` 分支根目录，不能把私有游戏仓库覆盖推送到这里。没有 npm 构建、CDN 字体、跟踪脚本或 Sites 项目依赖。

Windows PowerShell 中可用已安装的静态 HTTP 服务预览此目录；不要直接用 `file://`，否则浏览器无法读取配置。预览时的健康请求来源是本地地址，真实香港后端可能拒绝本地 CORS；可用浏览器测试拦截公开 `/health`，不要为预览临时开放生产账号接口。

发布前检查 JSON、脚本语法、手机布局、无 JavaScript 回退、健康/维护/连接失败状态和邀请链接保留。将所需文件提交并推送到本仓库 `main`，等待 GitHub Pages 部署成功；再检查线上总站没有自动跳走、图片与手动进入按钮正常。

小红书名片替换时应保留原始二维码。更新 HTML/CSS/JS 后，必要时更新 HTML 中的 `?v=portal-1` 静态资源版本；`404.html` 与 `index.html` 保持一致。
