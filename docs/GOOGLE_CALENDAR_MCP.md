# Schedule × Google Calendar（个人账号）

使用个人 Google / Gmail 账号即可，无需购买 Google Workspace，也不需要官方 Calendar MCP 开发者预览资格。当前服务直接调用标准 Google Calendar API。Google Cloud 项目用于管理 API 和 OAuth 凭据，不等于订阅 Workspace。

截至 2026-10-20，Google 官方说明标准 Calendar API 用量不额外收费；仍有请求配额，超大用量的政策以[官方用量说明](https://developers.google.com/workspace/calendar/api/guides/quota)为准。本地运行也不需要购买服务器。后续接入 AI 模型的费用与日历 API 分开。

## 首次配置（个人 Gmail）

1. 打开 [Google Cloud 控制台](https://console.cloud.google.com/)，选择或创建自己的项目。在「API 和服务 → 库」启用 **Google Calendar API**（`calendar-json.googleapis.com`）。之前启用的 Calendar MCP API 可以保留，但本版不使用它。
2. 打开「Google Auth Platform」，配置应用名称（例如 ForgeOS）和联系邮箱。**Audience / 受众选择 External / 外部**，保持 Testing / 测试状态，并在 Test users / 测试用户加入自己要授权的 Gmail 地址。个人账号不要选择需要组织的 Internal。
3. 在 Data Access / 数据访问添加：`openid`、`email`、`https://www.googleapis.com/auth/calendar.calendarlist.readonly`、`https://www.googleapis.com/auth/calendar.events`。
4. 在 Clients / 客户端创建 **Web application / Web 应用** OAuth 客户端。当前是用户填写表单的流程，使用普通客户端，无需勾选 AI-powered agent。
5. 在 Authorized redirect URIs / 已获授权的重定向 URI 中填写下面这个完整地址（不要填到 JavaScript 来源）：

   ```text
   http://127.0.0.1:8787/api/calendar/oauth/callback
   ```

6. 首次在项目终端运行：

   ```powershell
   npm ci
   # 已有 server/.env 时不要覆盖，直接编辑即可。
   if (-not (Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
   ```

7. 将 Client ID 和 Client Secret 填入本机 `server/.env` 中对应的 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。保留示例回调地址。密钥不要发到聊天，不要写进 HTML 或提交 Git。
8. 运行 `npm start`（配置修改后需重启），打开 **http://127.0.0.1:8787/planner/**，点击「连接 Google 日历」，选择上述测试账号授权。也可以在 VS Code 运行 **Schedule + Google Calendar** 任务。

需要 Node.js 22.19 或更新版本。5500 / Live Server 只支持静态预览；真实登录和读写使用 8787 本地服务。网站使用独立 Google OAuth，不会继承 ChatGPT 或 IDE 中的 Google 连接。

常见问题：`access_denied` 检查测试用户和授权权限；`redirect_uri_mismatch` 核对完整回调地址；API 未启用时确认启用的是普通 **Google Calendar API**，且项目与 OAuth 客户端一致。

## 跟随现有系统网络

默认 `GOOGLE_PROXY_URL=auto`。服务启动、打开页面和开始授权都不探测 Google，也不枚举代理软件进程、扫描监听端口、调用 VPN 管理接口或修改 VPN / 系统设置。只有实际交换授权码、读取账号信息或访问日历时才发送对应请求。

如果显式设置了 HTTP(S) 代理环境变量，优先使用它并遵循 `NO_PROXY`；否则 Windows 通过系统代理解析器读取当前用户的代理设置，包括手动配置、绕过规则和 PAC。系统选择直连时沿用系统网络，已生效的 TUN 路由也会自然生效。不会为寻找线路在多个代理之间切换。设置读取失败会明确提示，避免静默绕过代理。

代理设置按目标域缓存 5 秒，下次业务操作会读取更新的设置；请求失败后下一次操作立即重读。使用 HTTPS CONNECT，并保持证书校验。网络错误不会自动重放授权码交换或创建日程请求，已有的去重和回读核对仍然有效。

```dotenv
# 默认：跟随既有网络设置，无需填写端口
GOOGLE_PROXY_URL=auto
# 可选：明确指定自己配置的 HTTP(S) 代理
# GOOGLE_PROXY_URL=http://127.0.0.1:7890
# 可选：仅使用系统路由，不读取应用层代理
# GOOGLE_PROXY_URL=direct
```

点击「连接 Google 日历」会打开系统默认浏览器授权。VS Code 集成浏览器中的 ForgeOS 保持原页面，通过本地状态接口等待结果；授权完成后自动显示已连接。回调通过一次性随机 state 和 PKCE 验证，关联原页面会话，不依赖两个浏览器共享 Cookie。系统浏览器只显示完成提示，不获取原页面的会话或 Google 密钥。若无法自动打开浏览器，退回当前页面授权。

连接失败时根据实际操作显示：系统代理未接受连接、请求超时、证书验证失败或 Google 凭据被拒绝等。此时重新点击连接发起新的授权，不要刷新旧的 Google 回调地址。Google 密码和同意授权仍由用户本人完成。

## 在「有什么待办？」直接添加

1. 打开本地 `/planner/` 主页面，在「有什么待办？」顶部连接 Google 日历，并选择目标日历。OAuth 授权后自动返回主页面，保留当前任务草稿。
2. 输入一句话识别任务，或直接填写名称、预计分钟和截止时间。当前识别仍使用本地规则，请核对结果。
3. 默认勾选「同时添加到 Google 日历」。填写日程开始时间、可选地点和备注，结束时间由开始时间加预计分钟计算；开始时间应在未来，结束不晚于截止时间。
4. 点击「添加任务并同步日历」。Google 创建并回读确认后，任务池显示「已同步 Google 日历」，当天日程立即显示该任务。
5. 时间重叠仍录入，新事件在 Google 日历标红，主页面列出重叠日程。失败会保留草稿；相同内容重试、刷新后重试均复用请求 ID，防止重复创建。
6. 取消勾选可只保存本地待办。旧日历专页 `/planner/calendar.html` 仍可使用，但录入任务无需跳转。

已同步任务的时间不会被本地排程建议移动。编辑 Google 事件使用任务旁的「查看 / 编辑 Google 日程」链接；完成或移出本地待办不会删除远端事件。当前是添加时单向写入，尚未自动回传在 Google 中做的编辑。智能体登录页仍是演示，未连接真实模型。

## 服务与数据

浏览器 → 本地 Node.js 服务 → Google OAuth / 标准 Calendar API → Google Calendar。

默认适配器为 `server/google-calendar.mjs`，使用 `calendarList.list`、`events.list`（`singleEvents=true` 展开重复事件）、`events.insert` 和 `events.get`。旧 MCP 适配器保留供以后使用，默认服务不会连接 MCP。

| 本地接口 | 用途 |
| --- | --- |
| GET `/api/calendar/status` | 配置、连接 / 授权等待状态和 CSRF token，不探测 Google |
| POST `/api/calendar/auth/start` | state + PKCE 开始授权，可打开系统浏览器 |
| GET `/api/calendar/oauth/callback` | 后端交换授权码 |
| POST `/api/calendar/calendars` | 列出日历 |
| POST `/api/calendar/read` | 分页读取指定时间段，最多 32 天 |
| POST `/api/calendar/events` | 检查重叠、创建、回读验证 |
| POST `/api/calendar/disconnect` | 结束本地会话 |

录入接收 `calendarId`、`title`、`startTime`、`endTime`、`timeZone`、`description`、`location`、`requestId`。起止时间使用带时区的 ISO 字符串；同一次提交重试保持 UUID `requestId` 不变。返回 `event`、`overlap`、`conflicts`。请求携带会话 Cookie、同源 Origin 和 `X-ForgeOS-CSRF`。

- Google access / refresh token 仅在后端内存，重启或会话满八小时需重新授权。断开连接不删除 Google 日程，也不撤销 Google 中的全部授权。
- 浏览器保存日历选择、本地待办及已同步事件标识，不保存 Google token。主页面的待填表单在 sessionStorage 暂存，用于授权跳转和失败重试；成功保存后清除草稿和重试请求 ID。
- 去重记录在项目目录外的 `~/.forgeos/calendar`（可用 `FORGEOS_DATA_DIR` 修改），包含事件和重叠信息，不包含 OAuth token。不要随意删除，以免丢失超时恢复依据。
- 快速重复点击不会额外创建。写入明确被 Google 拒绝时可修正权限后重试；网络超时、服务器错误或回读失败时先核对已创建事件，不盲目重复创建。
- 全天事件使用日历时区及不包含结束日期的规则，支持夏令时与跨日。空闲、取消或自己已拒绝的日程不计入冲突，首尾相接也不算重叠。
- 读取失败不创建，保留表单。检查与创建之间可能发生外部变更；本版不会持续追踪冲突，也不会自动取消红色标记。
- 本机服务只监听 `127.0.0.1`，有 HttpOnly / SameSite Cookie、Origin / CSRF / Host 校验和静态文件白名单。GitHub Pages 不能运行这个 Node 服务，个人使用可一直在本机运行。

## 验证

```powershell
npm run test:calendar
npm run test:calendar-browser
```

浏览器测试需本机 Chrome，可用 `CHROME_PATH` 指定。测试使用模拟 Google HTTP 响应和账号，覆盖 OAuth、本地接口、REST 请求格式、分页、重叠标红、重复提交与超时恢复、失败处理、中英文、明暗主题及手机布局。**尚未使用真实 Google 账号完成授权和写入验证**。

参考：[账号与 API 要求](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)、[OAuth 配置](https://developers.google.com/workspace/guides/configure-oauth-consent)、[创建事件](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)、[展开重复事件](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)、[Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。文档沿用旧文件名，以保留已有入口。
