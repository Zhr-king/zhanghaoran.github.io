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

## 自动检测本地代理 / VPN

默认 `GOOGLE_PROXY_URL=auto`。启动服务、发起授权和访问 Google 时，后台会检查本机可用线路；连接结果缓存 60 秒，失败后下次操作重新检测。主页面日历连接区域显示检测结果，「检测网络」按钮可以立即重新检查。

Windows 下读取本地 HTTP(S) 代理环境变量、已运行的 UniClash / Clash / Mihomo / v2ray / xray / sing-box / Hiddify / Shadowsocks 进程监听端口，以及启用的系统代理设置。只检查这些来源中的本机端口，不扫描局域网；不修改系统代理或 VPN 设置，不自动启动 VPN，也不执行 PAC 脚本。进程信息不可读取时，仍尝试本地代理环境变量和系统网络。

候选代理必须通过 Google token、userinfo 和 Calendar 三个 HTTPS 端点的无凭据连通测试。有效 HTTP / Mixed 端口使用 HTTP CONNECT 隧道，保持 HTTPS 证书验证。如果没有可用代理，会验证系统网络；已开启 TUN 的 VPN 可以通过系统网络生效。页面显示「系统网络可访问 Google」只说明连通，不能据此判断是哪种 VPN。

```dotenv
# 推荐：自动检测，无需填写端口
GOOGLE_PROXY_URL=auto
# 可选：手动固定为自己的 HTTP / Mixed 代理端口
# GOOGLE_PROXY_URL=http://127.0.0.1:7993
# 可选：只使用系统网络
# GOOGLE_PROXY_URL=direct
```

代理或 VPN 需由你开启。改变端口后无需修改 auto 配置，点击「检测网络」即可重新选择。未找到可用线路时会明确提示；授权前先检查网络，避免点完 Allow 才发现后台无法访问 Google。网络探测本身不会登录账号、写入日程或发送密钥。真实业务请求失败后不会自动换线路重发写入，保持已有的请求去重与回读核对流程。

如果 Allow 后仍未连接，查看页面提示：网络问题先开启代理并检测；客户端凭据被拒绝时检查本地 OAuth 配置；会话过期时从页面重新开始授权。不要刷新旧回调 URL，授权码只能使用一次。

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
| GET `/api/calendar/status` | 配置、连接状态和 CSRF token |
| POST `/api/calendar/network/check` | 重新检测本地线路并验证 Google 连通性 |
| POST `/api/calendar/auth/start` | state + PKCE 开始授权 |
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
