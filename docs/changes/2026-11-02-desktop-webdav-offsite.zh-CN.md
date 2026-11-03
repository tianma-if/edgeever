# 桌面定时备份：可选的 WebDAV 异地副本

[English](2026-11-02-desktop-webdav-offsite.md)

关联 Issue：#723（备份方案 P2；延续 #61 与 #650）

## 问题与结果

桌面定时备份只写入本地文件夹。没有网盘客户端、或希望把备份放到 NAS / WebDAV 服务的用户，缺少自动的异地副本。现在每次本地备份完成后，桌面端可以把归档复制到 WebDAV 服务器（Nextcloud、群晖/威联通、Hetzner Storage Box、Koofr、pCloud、坚果云、Alist 等）。设计见[定时备份设计第 12 节](../desktop-scheduled-backup-design.zh-CN.md)。

## 范围

- 桌面主进程：新增 `backup-offsite.mjs`；`backup-manager.mjs` 报告异地副本状态、发布后排队上传、在每小时检查时重试、切换账号时取消；新增三个 IPC 操作（`offsite-save`、`offsite-test`、`offsite-upload`）；因为主进程不打包，`webdav` 加入桌面应用依赖。
- 设置 → 导入与导出 → 备份与恢复：可折叠的“异地副本（WebDAV）”区域，以及带“立即上传”的独立状态行。
- 共享 IPC 类型与五种语言的翻译。
- 不变：归档格式、本地备份结果、API、Cloudflare/Docker 运行时、数据库与迁移、同步、Web 端 WebDAV 卡片。

## 风险与恢复

- **密码泄露。** 只通过 Electron `safeStorage` 保存在绑定范围的 `.secret` 文件中；不会出现在状态、渲染进程状态、日志、归档或 EdgeEver 服务端。没有明文回退。已保存的密码绑定地址和用户名，修改其中任何一项或测试其他服务器时都必须重新输入。除局域网地址外必须使用 `https://`。
- **误删有效的远程副本。** 远程保留只删除本备份集记录为已上传到同一目标的文件，并且只在更新的副本上传成功之后删除。
- **阻塞本地备份。** 上传在本地备份队列之外运行，不改变本地备份结果。
- **回滚。** 关闭选项即停止上传，本地和远程文件均保留。旧版本会忽略 `<scope>.offsite.json` 和异地副本的 `.secret` 文件（见下方验证）。

## 验证

- 单元测试（`backup-offsite.test.mjs`，15 项，模拟 WebDAV）：经 `.part` 上传并移动、大小核对、`.part` 清理、取消、上传中切换账号、停滞超时、保留归属、重试最新归档、密码处理、明确的 `Content-Length`。
- 集成测试（`bun run test:webdav`，真实 `rclone serve webdav` 1.69，分别在 Bun 和 Node 下运行）：正确/错误密码的连接测试、普通与加密归档逐字节一致且无残留 `.part`、保留策略不删除他人文件、保存的密码错误、HTTP 413 大小限制提示“文件过大”且无 `.part`、服务器不可达。本地 Docker Desktop 不可用，因此直接运行 rclone，并用 64 KiB 代理模拟大小限制，未使用 `tests/webdav/compose.yml` 中的 nginx 容器。
- macOS 桌面端（Electron 未打包，本地自托管服务端）：连接测试；普通备份上传后从 WebDAV 下载，删除笔记后恢复成功；加密备份原样上传（`EDGB` 头、无明文），用密码恢复成功；WebDAV 密码错误时只有副本失败、本地备份成功，“立即上传”可恢复；状态和所有状态文件中都不含密码；设置界面正确显示该区域与状态行。
- 升级：由当前 `main` 构建创建、含加密本地备份的配置目录，用新构建打开后设置、密码和历史均保留；异地副本默认关闭，启用后上传了旧版本创建的备份。再用旧构建打开该目录，可正常执行新的本地备份。
- 验证中发现并修复：在请求体上统计进度会丢失较大文件开头的数据块；`webdav` 库以分块方式发送流，部分服务器不接受。现在改为在转换流中计数，并发送明确的 `Content-Length`。
- 评审后修复：连接测试与上传只读取启动时所属账号的密码，账号切换后停止；关闭选项会取消正在进行的上传；创建文件夹、`MOVE`、核对大小、清理、保留策略和连接测试都受停滞超时限制，即使请求不响应取消。六项回归测试覆盖这些情况，并在旧版本上失败。
- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`、`bun run build:web`、`bun run test`。
- 未验证：Windows 与 Linux 运行时（无本地设备，CI 不运行此流程）、打包构建、Nextcloud 及无测试账号的商业服务。
