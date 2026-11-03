# 桌面端本机 Agent 新增 CodeBuddy

[English](2026-11-02-desktop-codebuddy-agent.md)

关联 Issue：#758

## 问题与目标

WorkBuddy 与 CodeBuddy 共用账号和额度，但桌面端接入 WorkBuddy 依赖其应用内置 CLI 的私有实现（lite-wb 精简包、`--serve`、凭据加密模块等），WorkBuddy 升级后容易连接失败（如 #584、#600）。新增独立的 **CodeBuddy** 选项，直接调用用户自行安装的官方 CLI（`@tencent-ai/codebuddy-code`）的标准 stdio ACP，WorkBuddy 用户可改用该选项。

## 允许变更与验收

1. 只新增一个 CodeBuddy 选项，不区分国内版与国际版；区域由 CLI 按用户选择的登录方式决定。启动时清除继承的 `CODEBUDDY_INTERNET_ENVIRONMENT` 与 `CODEBUDDY_INTERNET_ENVIROMENT`，避免端点与登录状态不一致。
2. 只使用独立安装的官方 CLI：不使用 WorkBuddy 内置 CLI（排除 `app.asar` 路径并校验包名），不使用 `--serve`、凭据桥接或网关登录。以 `node <包>/bin/codebuddy --acp` 启动：POSIX 依次检查 PATH 与桌面工具目录中的每个 `codebuddy`：符号链接解析到官方入口；asdf、mise、Volta 的 shim 交给对应管理器的 `which` 解析真实入口（按 shim 缓存 30 秒）；某个候选无效时继续检查后续候选，不会遮蔽后面的有效安装。nvm 的默认别名支持完整或部分版本号（如 `22`）、`node`/`stable`、`lts/*` 及自定义别名；Windows 通过 npm 的 `codebuddy.cmd` 定位同目录 `node_modules` 中的入口，不执行 `.cmd`、不使用 `shell: true`。优先使用安装该 CLI 的 npm 前缀中的 Node，其次是 shim 所在目录，找不到时报告 `node_missing`。
3. 登录走 ACP 标准 `authenticate`，复用现有 5 分钟登录超时。CLI 会自行打开浏览器，EdgeEver 不再自动打开；仅在用户发起的 CodeBuddy 登录期间接收 `_codebuddy.ai/authUrl`，校验后只保存在主进程，供用户手动“重新打开登录页”（3 秒内重复点击不生效）。白名单仅含已验证的 `copilot.tencent.com`（微信）与 `codebuddy.ai`（Google / GitHub）及其子域；拒绝非 https、带用户信息或非默认端口的链接，不包含企业域名。被拒绝的链接只记录固定诊断码，不记录完整 URL 或查询参数。
4. `_codebuddy.ai/getUserInfo` 缺少 `userInfo` 或 token 一律视为未登录；token 不跨 IPC、不写日志。`authenticate` 返回后还需新启动一个 CLI 进程恢复登录，才报告登录成功。
5. 取消贯通界面、IPC 与进程生命周期：取消会结束 CLI 进程并清理临时工作区；切换到其他 Agent 或离开设置页也会取消进行中的登录。结果区分已取消、超时与失败；关闭浏览器页面不视为取消。
6. 前端：Agent 列表、AI 侧边栏、官方 Logo（来源记录于 `sources.json`）和五种语言文案。登录方式只为已验证的微信登录标注“国内”，其他方式沿用 CLI 返回的名称。未安装时提示 `npm i -g @tencent-ai/codebuddy-code`。

## 边界、风险与恢复

- 改动集中在新的 `codebuddy-cli.mjs` 与 `acp-host.mjs` 中 CodeBuddy 分支（登录流程、取消与重新打开登录页的 IPC）。共享的 `connect` 增加了账号校验参数与 `authUrl` 回调，WorkBuddy 的原有校验逻辑保持不变，但属于共享路径的改动，需对其他 Agent 回归。
- 不涉及 EdgeEver 自身账号、数据存储或迁移；回滚撤回本次提交即可，用户的 CodeBuddy 登录保存在 CLI 自己的配置目录中，不受影响。
- iOA、企业域名登录不在白名单内：CLI 仍会自行打开浏览器，但 EdgeEver 的“重新打开登录页”不可用。

## 实现与验收结论

- 单元测试：命令解析与未安装（POSIX、Windows `.cmd`、nvm Node、非官方包、WorkBuddy 内置副本、缺少 Node；asdf、mise、Volta shim；无效候选不遮蔽后续安装；nvm 的 `22`、`lts/*`、`node` 与自定义别名，以及最小 PATH 下经 `lts/*` 找到 CLI 的真实文件系统回归）、清除区域变量、链接白名单、仅登录上下文处理 `authUrl`、重复通知与重新打开节流、超时与取消（含进程退出）、缺少凭据、登录后新进程校验、IPC 权限。
- macOS 真机（CodeBuddy CLI 2.164.0，Homebrew 安装）：在仿 Finder 启动的最小 PATH 下解析到 `/opt/homebrew/bin/node` 与官方入口；设置 `CODEBUDDY_INTERNET_ENVIRONMENT=selfhosted` 后检查连接仍为可用，真实对话回复 “OK”；隔离的空配置目录中检查为需要登录、列出 CLI 的 4 种登录方式；微信登录收到 `copilot.tencent.com` 链接，重新打开节流生效，取消后约 1 秒结束为“已取消”且无残留进程；不完成登录时按超时结束；诊断中不含登录链接参数。此前已用同一 CLI 验证微信登录、重启后保持登录及与 WorkBuddy 账号互不影响（见 #758）。
- macOS 桌面端界面（开发版 Electron + 官方 v2.16.1 sidecar，隔离的应用配置）：已登录 CLI 检查为“会话可用”，Logo 与登录按钮文案正确（“微信登录（国内）”，其他方式沿用 CLI 名称）；空 CLI 配置下显示“请登录 CodeBuddy”；点击微信登录后显示进行中提示、“重新打开登录页”与“取消登录”；取消后显示“已取消登录”且无残留进程；登录进行中切换到 Codex 会结束 CLI 进程。
- `bun run typecheck`、`bun run typecheck:mobile`、`bun run build:web`、`bun run lint` 通过；完整非 E2E 测试中唯一失败的 `tests/deployment-entrypoints.test.ts` 在未改动的 `main` 上同样失败，与本次无关。
- 未签名测试安装包（fork 上的临时工作流编译）：
  - Linux arm64（Ubuntu 24.04，AppImage 解压运行）：Node 22 与 CodeBuddy CLI 2.179.2 装在 `~/.local`，桌面会话 PATH 不含 `~/.local/bin`，系统 Node 为不满足 CLI 要求的 v18.19.1。从应用菜单启动后仍找到 CLI 与同目录 Node 22；检查连接显示需要登录；微信登录时浏览器自动打开登录页；取消正常；扫码登录后重启应用仍保持登录；真实对话回复 “OK”；日志中无登录链接或 token。
  - macOS arm64（DMG，本机临时签名）：从启动台打开，检查连接为会话可用，真实对话回复 “OK”。
  - Windows x64（NSIS 安装包，npm 安装的 CLI）：人工测试检查连接、登录与对话正常。
- 未验证：iOA 与企业域名登录；Google / GitHub 完整登录流程；token 过期与刷新；其他 Agent 的真机回归（仅单元测试）；nvm、asdf、mise、Volta 安装的真机场景（仅单元测试）。
