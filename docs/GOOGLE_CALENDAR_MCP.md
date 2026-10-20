# Schedule × Google Calendar MCP

当前先实现 **连接 Google 日历 → 填写事件和时间 → 录入日程**。发生时间重叠也会创建，新事件在 Google 日历中使用红色，并在页面列出重叠日程。本次没有新增动态调节或自动重排代码；原有本地规划页保留。

## 本地启动

需要 Node.js 22.19 或更新版本。

```powershell
npm ci
Copy-Item server/.env.example server/.env
# 在 server/.env 中填写 GOOGLE_CLIENT_ID 和 GOOGLE_CLIENT_SECRET
npm start
```

打开 **http://127.0.0.1:8787/planner/calendar.html**。也可以在 VS Code 运行 **Schedule + Google Calendar** 任务。Schedule 页面右上角有 Google Calendar 入口。

5500 / Live Server 仅提供静态预览，不支持真实登录或日历读写。本服务只监听 127.0.0.1，请使用这个地址。

## 首次连接 Google

截至 2026-10-19，[Google 官方 Calendar MCP](https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server) 仍需要 **Google Workspace Developer Preview Program** 资格。没有资格时，即使普通 Google 日历能用，也不能调用这个官方 MCP 服务。本版本尚未接入社区 MCP。

1. 使用具备预览资格的 Google Cloud 项目，启用 **Google Calendar API**（`calendar-json.googleapis.com`）和 **Google Calendar MCP API**（`calendarmcp.googleapis.com`）。
2. 在 Google Auth Platform 设置应用信息、受众和测试用户。
3. 创建 **Web application** 类型的 OAuth 客户端，启用 **Use this client for an AI-powered agent**。
4. 注册精确回调地址：`http://127.0.0.1:8787/api/calendar/oauth/callback`。
5. 配置权限：`openid`、`email`、`https://www.googleapis.com/auth/calendar.calendarlist.readonly`、`https://www.googleapis.com/auth/calendar.events`。
6. 把 Client ID 和 Client Secret 填入本机 `server/.env`，重启 `npm start`。密钥不需要发到聊天，也不要写进 HTML 或提交 Git。
7. 在页面点击「连接 Google 日历」，完成 Google 授权并选择日历。

这个网站使用独立的 OAuth 授权，不会继承 ChatGPT / IDE 内已连接的 Google 账号。当前代码已经实现真实连接流程，**尚未用真实 Google 账号验证**；自动化测试均使用模拟账号与日历。

## 第一版使用方式

1. 选择一个要写入的 Google 日历；重叠检查也在这个日历内进行。
2. 填写事件名称、开始和结束时间，以及地点、会议链接或备注。时间采用浏览器当前时区。
3. 点击「添加到 Google 日历」。后台读取这个时间段，再调用 MCP 创建事件。
4. 没有重叠：按填写的时间录入，保持日历默认颜色。
5. 有重叠：仍按填写的时间录入，并用 `colorId: "11"`（Tomato）把**新事件**标红；页面显示相关日程和时间。原有事件不被修改。
6. 可在右侧查看所选日期起的一周日程，或打开 Google 日历里的具体事件。

本版用结构化表单提交。智能体账号页依然是演示，**尚未连接真实模型，也没有自然语言理解功能**；下一步可以让 agent 解析文本后调用同一个事件录入服务。当前没有邀请参会人、创建重复系列、移动或删除已有事件的功能。

## 实现与接口

浏览器 → 本地 Node.js 服务 → Google OAuth / Google Calendar MCP → Google Calendar。

服务使用官方 MCP SDK，连接固定地址 `https://calendarmcp.googleapis.com/mcp/v1`，发现并调用 `list_calendars`、`list_events`、`create_event`、`get_event`。如果 MCP 返回未展开的重复系列，服务用相同 OAuth 授权调用 Google 官方 Calendar REST `events.list(singleEvents=true)`，由 Google 展开实际实例及例外日期。创建事件仍通过 MCP。

| 本地接口 | 用途 |
| --- | --- |
| GET `/api/calendar/status` | 连接、配置、会话状态和 CSRF token |
| POST `/api/calendar/auth/start` | 通过 state + PKCE 开始 Google OAuth |
| GET `/api/calendar/oauth/callback` | 服务端交换授权码 |
| POST `/api/calendar/calendars` | 列出可用日历 |
| POST `/api/calendar/read` | 分页读取一个日历的指定时间段，最多 32 天 |
| POST `/api/calendar/events` | 检查重叠、创建事件、回读验证；不会自动改时间 |
| POST `/api/calendar/disconnect` | 结束本地会话 |

录入接口接收 `calendarId`、`title`、`startTime`、`endTime`、`timeZone`、`description`、`location`、`requestId`。`startTime/endTime` 必须是带时区的 ISO 时间；`requestId` 是 UUID，重试同一次提交时保持不变。返回 `event`、`overlap`、`conflicts`。请求需带当前会话 Cookie、同源 Origin 和 `X-ForgeOS-CSRF`。

## 数据与失败处理

- OAuth access / refresh token 仅保存在服务内存。重启服务或会话满八小时后重新登录。断开连接不删除日程，也不撤销 Google 中的全部授权。
- 浏览器只保存日历选择和用于重试的请求 ID / 内容摘要；不会保存 Google token 或日历列表内容。输入草稿仅留在当前页面。
- 写入记录保存在网站目录外的 `~/.forgeos/calendar`，可用 `FORGEOS_DATA_DIR` 指定其他项目外目录。其中有事件标识、写入结果及重叠事件信息，没有 OAuth token。记录用于避免超时后重复创建，不要随意删除。
- 快速重复点击不会额外创建事件。网络中断后重试相同请求，服务先查找已经创建的事件；无法核实的请求不会被盲目重发。若 Google 明确未创建但记录仍不确定，需要核对 Google 日历后重新打开页面填写一笔新请求。
- 全天事件按日历时区和不包含结束日期计算，支持跨天与夏令时。标为空闲、已取消、自己已拒绝的事件不算时间重叠；时间首尾相接也不算重叠。
- 创建前读取最新日历；读取失败时保留表单并报错，不假定没有重叠。读取与创建之间仍有外部并发变更的短暂窗口；目前不会后台追踪日后产生或消失的冲突，也不会自动取消红色标记。
- 当前面向本机单用户，带 HttpOnly / SameSite Cookie、Origin / CSRF / Host 校验和静态文件白名单。GitHub Pages 无法运行 Node 服务，线上接入需要另外部署后端。

## 验证

```powershell
npm run test:calendar
npm run test:calendar-browser
```

浏览器测试需要本机 Chrome，可用 `CHROME_PATH` 指定位置。测试覆盖 MCP 协议调用、OAuth、真实本地 HTTP 路由、重叠仍录入、Google 事件颜色字段、重复点击及超时恢复、全天与跨日事件、只读和失败情况、中英文、明暗主题及手机布局，不访问真实 Google 日历。

参考：[MCP 工具](https://developers.google.com/workspace/calendar/api/v3/reference/mcp)、[创建事件和颜色](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/create_event)、[重复事件展开](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)、[Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。
