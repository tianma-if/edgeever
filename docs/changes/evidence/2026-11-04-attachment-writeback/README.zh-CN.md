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

## Linux 原生包、保存与恢复

`jingwen-mini-frp`（Ubuntu 25.10 x86_64）使用独立 X11 会话、profile 和从 PR 源码构建的 AppImage，不替换已有应用。初始包 2.21.0 通过内容检查和真实启动；S8 会话修复后重新构建私有测试版 **2.21.1**，官方 **v2.20.0** 的独立副本经现有回环升级入口真实下载、替换并重启为 2.21.1。原正式包按发布校验清单核验并保留；测试版本未发布，仓库产品版本未改。见[包记录](linux-package-results.json)。

真实系统关联启动 Mousepad，从界面编辑并按 `Ctrl+S`：

- 旧 CF 不支持回存时，原云端字节保持不变，快照保留，界面明确提示需升级服务端。
- 临时切到已验证的 CF 候选版本，点击“重试回存”后显示已同步，独立认证网络下载得到 `linux pending before cf upgrade`。
- 连续第二次保存后，云端得到 `linux consecutive save two`，附件卡片显示 27 B；待回存状态清除。
- 终止本次测试进程并以同 profile 重启，不需重新登录。再次外部打开产生 `(2)` 副本，真实编辑器显示第二次保存的内容，原受管理副本保留。

以上操作中安全存储始终明确失败，主进程加密凭据文件未生成；修复前相同环境的附件请求返回 401，修复后认证打开、回存及重启恢复成功。113 项既有会话安全边界、资源请求与 Web API 回归通过。完整字段见[Linux 界面记录](linux-ui-results.json)。

该原生升级自动化使用空 profile；另以同业务 profile 切换版本确认笔记与登录态保留。正式旧包无法在此安全存储失败环境认证打开附件，因此历史打开副本/旧附件缓存的跨版本保留仍有缺口，不能用新版重启结果代替。

## 真实 macOS / Linux 双设备

两台实体机器连接同一 CF 实例和同一合成 TXT 附件。macOS 使用隔离的开发客户端及真实 TextEdit；Linux 使用 2.21.1 AppImage 及真实 Mousepad。

- 两端先打开相同内容。Linux 先保存 `linux wins before mac`；Mac 旧副本再保存则显示冲突，本地 `mac stale edit retained` 与云端 Linux 内容均保留。点击“重试回存”后仍冲突，不强制覆盖。
- Mac 重新打开为 `(2)` 副本，TextEdit 读到 Linux 内容；保存 `mac fresh save after linux` 后界面显示已回存，认证网络下载内容一致，云端名称仍为 `771-cloud-renamed.txt`。
- Linux 已打开的旧副本再保存同样出现冲突，点击重试后仍保留本地和云端两份。重新打开为 `(3)` 副本，真实 Mousepad 显示 Mac 新内容。

两端实际冲突界面已检查；原资源 ID 不变，独立网络下载核对实际云端字节。见[双设备记录](two-device-results.json)。

## 真实 Cloudflare 回存

`edgeever.sivd.dev` 的临时构建使用已部署的 `0fe509f8b701` 基线，仅叠加 PR `887515a3` 的两个资源业务文件；不引入两步验证，不执行迁移。该构建的类型检查、Web/Worker 构建和 23 项资源 API 回归通过。真实 D1/R2 验证两次条件回存均返回 200，旧内容基线返回 409 且当前内容不变；专用入口即使收到 `preserveFilename=false` 仍保留另一端修改的云端名称，资源 ID 不变，网络下载字节正确。

验后恢复原 Worker `16290c02-445a-45fc-8764-f86d01742f9f`：构建回到 `0fe509f8b701`，健康和登录检查通过，迁移保持 `0087`，能力入口回到 404。旧版 Worker 仍能从 R2 读取新回存的字节。见[Cloudflare 记录](cloudflare-results.json)。

### 平台实测发现

- **Linux 会话修复（S8）**：正式 v2.20.0 与原 PR 包在 `safeStorage.encryptString` 明确失败时，渲染器能用既有会话兜底同步，主进程却无会话，附件 GET 无认证头并返回 401。修复在原有长度校验和实例绑定后先更新内存，再串行加密落盘；原错误仍返回，不新增凭据存储或改变密钥环策略。真实 Linux 保存与重启验证见上节。连接正常 GNOME 总线时，锁定密钥环还可能等待授权；本次覆盖明确失败，不改变系统授权等待行为。
- **Web 缓存观察**：已有 `CacheFirst` Service Worker 会用旧缓存响应显式 `no-store` 的资源请求。此次服务端验收采用认证网络读取、绕过 Service Worker，确认 D1/R2 当前字节；未更改 Web 缓存策略，该观察不属于 Web 界面最新内容验收通过。

## 平台验收仍需完成

本机未安装 Microsoft Excel；需在有安装及授权的环境单独实测。Windows 11 上需要真实 Excel/WPS，使用测试附件完成普通保存、连续保存、关闭再打开、断网保存并重启、另一设备先修改后的冲突。旧版本升级需确认旧附件缓存及历史打开副本仍可访问，旧副本不会自动回存；macOS 本次使用开发客户端，不代表 macOS 安装包跨版本升级验收。Linux 通用保存与恢复、真实 macOS/Linux 双设备冲突及 CF 回存已通过上述实测。

当前服务端内容替换上限为 100 MiB；大附件仍可打开，但超过上限的修改会保留本地并提示失败。“另存为”到其他路径不自动回存。代码回滚不会恢复已经替换的服务端附件内容；降级前应先复制未回存的本地文件，避免旧版临时文件清理。
