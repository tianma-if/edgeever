# 桌面附件回存验收

[English](README.md) · [变更范围](../../2026-11-04-attachment-writeback.zh-CN.md)

## 已验证的流程

使用隔离的 macOS Electron profile、真实 Rust sidecar、共享 API、SQLite 和本地对象存储。使用合成 TXT 附件；系统打开/显示操作只记录目标路径，外部保存用真实文件写入和替换模拟，断网由测试传输模拟。

- 从附件卡片打开 → 保存 → 原资源 ID 下读取到新内容 → 本机附件缓存和卡片大小更新 → 再次打开得到新内容 → “显示本地文件”定位对应副本。
- 网络不可用时保存 → 待上传快照落盘 → 真正关闭并重启 Electron → 自动回存，重新挂载的卡片显示新文件大小。
- 独立 HTTP 客户端先修改原附件 → 本地再修改 → 提示冲突，两边内容保留；点击“重试”不会强制覆盖。

[执行结果](results.json) · [已回存界面](saved.png) · [冲突界面](conflict.png)

## 复现自动化

在仓库根目录执行，使用现有依赖，不接触生产实例或安装在 Applications 中的 EdgeEver：

```sh
bun test apps/desktop/src/main/attachment-open.test.mjs apps/desktop/src/main/attachment-writeback.test.mjs apps/desktop/src/main/attachment-writeback-ipc.test.mjs apps/desktop/src/main/resource-protocol.test.mjs tests/attachment-writeback.integration.test.mjs apps/api/src/resource-routes.test.mjs apps/api/src/resource-service.test.mjs apps/api/src/resource-upload-integration.test.mjs
EDGE_EVER_DESKTOP_BUILD=1 bun run build:web
bun run build:desktop:sidecar
bun apps/desktop/scripts/build-backup-worker.mjs
node tests/desktop-attachment-writeback.integration.mjs
```

桌面自动化使用已支持的 `file:` 渲染入口和独立临时 profile；现有 Web/API 服务不需要停止或换端口。脚本退出时关闭本次测试的应用和 API，并移除临时 profile/数据库。截图和结果保留在本目录。定向回归额外覆盖 Excel 式临时文件替换、上传中继续保存、丢失成功响应、离线附件映射、认证恢复、账户切换、过期清理与既有替换大小限制。

故障恢复回归在独立 Node 进程中对真实文件调用注入故障，不修改产品代码入口：覆盖 DOM `AbortError`、快照读取时替换文件、内部 pending 文件暂时锁定、旧重试状态晚落盘、确认中恢复同账户会话、确认落盘失败和确认后清理失败。每个失败场景均先复现，再验证恢复或保持已确认状态。异步 IPC 回归另覆盖发送者失效与账户变化，状态列表回归确认显示本地序号但上传仍使用原文件名。

## 服务端名称与存储验证

附件打开、回存、IPC、缓存协议、真实 API 加上既有资源路由、服务和上传集成，共 72 项通过；资源请求、URL、语言加载和共享翻译键另有 15 项通过。真实 API 验证 `preserveFilename=true` 能保留显示名称不同、预先改名、上传中并发改名，以及成功响应丢失后重试时的云端名称；省略或关闭参数仍按既有调用替换名称。

连续 12 次保存的对象键长度保持不变，最新内容可读、旧对象已清理；竞争更新失败和对象写入后报错时，未采用的候选被清理，当前成功版本保留。另覆盖数据库切换已提交但响应丢失、后续确认不可用的场景：保留可能已生效的对象，原资源仍可读取，回存重试可重新确认。另在同一 SQLite/文件存储中执行基线 `6be20cfc` 的原版资源 API/服务，验证旧写→新写→旧读写→新写，详见[存储兼容记录](storage-compatibility.json)。这不包含原生安装包升级、线上 Cloudflare 或 S3 验收。

桌面在实际回存前探测服务端能力，写入及丢响应重试使用强制保留名称的专用入口。旧服务端忽略可选参数的缺陷由回归复现：修复后旧服务端/探测后降级均不进入普通替换路由，云端改名及内容保持不变。能力缺失时保留快照、不自动反复探测；服务端升级后手动“重试回存”恢复。

隔离的真实 Electron、Rust sidecar 与本地 API 实测：将能力入口模拟为旧版 404 时，只有 1 次能力请求、0 次写请求，云端仍为原内容，界面提示升级且保留本地修改。切换到新版后点击“重试回存”，累计 2 次能力请求、1 次写请求，云端读到本地修改，界面显示“已回存原附件”。见[能力与界面记录](server-capability-ui.json)。这不是原生安装包升级验收。

缓存回归验证已有当前账户缓存时，502/503 打开缓存且取消错误响应体；401/403/404 不回退。缓存缺失保留 503，不读取其他账户目录；请求中或创建缓存响应后账户切换均拒绝，放弃的文件流被关闭。已有 Range、本地缓存更新和网络异常回退继续通过。

## 真实 macOS WPS 验收

WPS Office **12.1.29182**，使用合成表格、隔离的 Electron profile 和真实本地 API。通过 EdgeEver 的“在外部打开”调用系统文件关联，再在真实 WPS 中编辑并按 `⌘S`；没有模拟打开或保存。完整字段见 [WPS 实测记录](wps-results.json)。

- **XLSX 连续保存**：`B4` 从 100 改为 200，再改为 300；服务端下载的 `B6` 分别为 220、320，公式始终为 `SUM(B4:B5)`，`B8` 保存标记同步更新。关闭后再次从 EdgeEver 打开，WPS 显示 300、320 和第二次保存标记。
- **XLS 原路径保存**：用 WPS 生成真正的 Excel 97–2003 OLE 文件，上传为独立附件，再从 EdgeEver 打开；保存 `B4=400` 后，服务端下载文件与受管理的 WPS 保存文件逐字节相同（19,968 字节）。保存后及关闭重开，WPS 显示公式结果 420、保存标记和原公式。XLS 未使用独立解析器读取。
- **重复打开修复**：原版 WPS 拒绝不同目录中的同名文档。修复后 `WPS-771.xlsx` 与 `WPS-771 (2).xlsx` 可同时打开；在第二份保存 `B4=500` 后，从原资源 ID 下载得到 500、520 和原公式，下载文件名仍为 `WPS-771.xlsx`。再打开的本地副本为 `(3)`，WPS 显示 500。名称回归同时覆盖不同资源并发打开及大小写/Unicode 等价名称。

WPS 截图含有无关用户文档标签，未放入仓库；记录只保留合成表格数据和验收结论。

## 平台验收仍需完成

本机未安装 Microsoft Excel；需在有安装及授权的环境单独实测。Windows 11 上需要真实 Excel/WPS，使用测试附件完成普通保存、连续保存、关闭再打开、断网保存并重启、另一设备先修改后的冲突。旧版本升级需确认已有笔记/附件及旧打开副本仍可访问，旧副本不会自动回存。Linux、实际双设备界面与 Cloudflare 实例尚未验证。

当前服务端内容替换上限为 100 MiB；大附件仍可打开，但超过上限的修改会保留本地并提示失败。“另存为”到其他路径不自动回存。代码回滚不会恢复已经替换的服务端附件内容；降级前应先复制未回存的本地文件，避免旧版临时文件清理。
