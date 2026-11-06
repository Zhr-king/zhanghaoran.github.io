# Schedule 连接本机 Codex

第一阶段接入「真实连接验证 + 自然语言任务提取」。后端调用本机 Codex CLI，复用已保存的登录；前端不读取凭据，也不保存 API Key。七天排程建议和冲突检查仍由现有本地算法完成。

## 使用

1. 安装支持 `exec --ignore-user-config --ephemeral --output-schema` 的 Codex CLI（本次验证版本为 0.154.0）。运行 `codex login` 完成登录，用 `codex login status` 检查。
2. 运行 `npm start` 或双击 `ForgeOS.vbs`。已有服务需重启以加载新增后端。
3. 打开 `http://127.0.0.1:8787/planner/`，点击「连接 Codex」。按钮实际发起一次简短推理；成功后将 Codex 设为当前浏览器的默认智能体。
4. 用自己的话输入任务，点击「识别任务信息」，无需套模板。例如「想抽半小时把课堂笔记整理一下」，Codex 会理解任务名称和 30 分钟时长，没提及的其他信息留空。
5. 核对名称、时长、截止时间、开始时间、地点与备注，补齐缺失项，再添加任务或同步 Google 日历。

账号页也可以验证 Codex 并单独保存默认选择。取消默认后，识别按钮会提示连接 Codex，不再回退到本地规则；仍可手动填写任务。移除浏览器里的 Codex 选择不会注销本机 CLI。其他提供商仍为演示。旧版 Codex 演示登录不会当作真实连接。

只有本地 Node 服务能调用本机 CLI；GitHub Pages、静态预览服务不提供此能力，但仍可手动填写、保存任务和生成本地排程建议。

## 配置

可在被 Git 忽略的 `server/.env` 中设置以下可选项，然后重启服务：

| 变量 | 用途 |
| --- | --- |
| `FORGEOS_CODEX_BIN` | CLI 可执行文件的绝对路径，或 npm 安装目录中的 `bin/codex.js`。Windows 自动查找 PATH 和 Codex 桌面程序的标准目录；不通过 shell 执行 `.cmd`、`.bat` 或 `.ps1`。 |
| `FORGEOS_CODEX_MODEL` | 账号可用的模型名称；未设置时使用 CLI 默认模型。 |
| `FORGEOS_CODEX_PROXY_URL` | 默认 `auto`，沿用代理环境变量或 Windows 系统代理。可显式设为可信 HTTP 代理地址或 `direct`。只影响子进程，不修改系统设置。 |

每次提取在独立临时目录中以只读、非交互模式执行，不加载个人 `config.toml`，关闭 shell、联网搜索、Apps、Plugins 和多智能体功能；登录仍由 CLI 管理。个人模型配置不会自动带入，指定模型请使用上述环境变量。任务通过 stdin 传入，最终 JSON 经后端校验后才返回表单。临时 schema 在完成后删除，调用使用 `--ephemeral`。

缺失或不明确的任务名称、日期、时间、时长、优先级、地点和备注保持空白；只有日期时不会自动补成当天结束。优先级未提及时显示「未指定」，保存、刷新或编辑也不会变成「普通」。Codex 须为填写的字段返回原文依据；后端将无原文依据的值置空，格式校验不代替 AI 理解。模型输出仍需人工核对。识别本身不会创建任务或日历事件。请求失败不会改用本地规则，表单和描述会保留。请求期间修改表单，迟到的结果不会覆盖修改。

服务仅绑定 `127.0.0.1`，Codex 路由使用独立会话和 CSRF 校验，不要求 Google 授权。每次最多一个推理请求，CLI 超时上限为 120 秒。连接验证和提取会使用当前 Codex 账号的额度。

## 验证

- `npm run test:codex`：进程输入、输出校验、超时、重试、并发和 HTTP 会话。
- `npm run test:codex-browser`：Chrome 中测试连接、旧演示状态迁移、自动填表、缺失字段、失败保留、重复点击、编辑保护和中英文布局；推理使用测试替身。
- `npm run test:calendar`、`npm run test:calendar-browser`、`npm run test:planner`：现有日历与排程回归。

2026-11-04 已通过本机真实 ChatGPT 登录调用 Codex，返回任务名称、45 分钟时长、次日 14:00 开始与 17:00 截止、高优先级和地点。真实调用使用测试描述，没有写入 Google 日历。

官方接口依据：[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)。
