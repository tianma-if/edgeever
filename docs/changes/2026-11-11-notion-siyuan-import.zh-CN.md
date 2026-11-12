# Notion 与思源 Markdown 导入

[English](2026-11-11-notion-siyuan-import.md)

关联 #794，沿用 #834 flomo 使用的统一导入框架：来源选择、Worker/索引、预检、目标位置、分片上传、进度、取消与重试共用现有实现。不新增导入接口、数据库迁移或独立入口。

## 范围与行为

- Notion：官方 Markdown & CSV ZIP 或解压目录。开头标题作为笔记标题，Front Matter 优先；仅显示名称去除末尾 Notion ID，保留原路径身份，避免同名目录混淆。CSV 原始内容作为附件，没有正文引用的 CSV 创建附件笔记。不重建数据库关联、公式或视图。
- 思源：包含 assets 的官方 Markdown ZIP 或解压目录。沿祖先目录寻找最近的 `assets/`；assets 内的 Markdown 文件作为附件。HTML 图片、音视频通过共享的不可执行 HTML 转换器处理，跳过代码示例和 Front Matter。
- 页面链接和思源块引用保留原文并提示。普通附件缺失、未引用的非分卷 ZIP 或 .sy 文件阻止预检；其他未导入文件有警告。仅使用受支持元数据中存在的时间，缺失时间沿用框架的导入时间行为。
- 新任务新增笔记，同任务重试复用身份并补齐失败上传。CSV 可下载且字节不变。不接入来源账号，也不由服务器抓取导出包。

## Notion 整包导入

同一公开 Notion 原包的外层和内层 CRC 均正常。外层包含一个 `Export-…-Part-1.zip`，其中 278 篇 Markdown、2 个 CSV 和 1 个索引 HTML 可读。`Home.md` 有 4 个本地 CSV 目标在包内缺失。原有预检先拒绝内层 ZIP，手动解压后又因缺失 CSV 拒绝整批。

- Notion ZIP 根目录的 `Export-<UUID>-Part-N.zip` 或 `ExportBlock-<UUID>-Part-N.zip` 作为来源分卷，在导入 Worker 中展开一层。各分卷的条目共用原始相对路径和统一索引，支持跨分卷精确引用。复用 ZIP 读取器、路径校验、重复路径检查及取消机制。损坏分卷阻止确认。内层分卷需随机读取中央目录，复用任务索引的分块暂存，在读取时按范围取回数据。分卷暂存跨同任务重试保留，任务关闭时随索引清理；暂存失败阻止预检。只暂存分卷 ZIP，逐条读取其中的笔记和附件。
- 对 Notion 正文中通过路径校验、找不到目标的本地 CSV 链接，预检显示来源路径和原目标，允许继续。导入保留原链接，不生成缺失文件，也不猜测替代 CSV。存在的 CSV 保留原字节，其他缺失附件、路径越界和无法唯一定位的引用仍阻止确认。
- 直接在 macOS 浏览器和 `jingwen-mini` Linux Chrome 上传同一个未解压原包。预期预检 4 个笔记本、280 篇笔记、2 个附件、0 项错误，明确列出 4 个缺失 CSV 提醒。确认前无写入，完成后核对 SQLite 新增数、下载的 CSV 字节和 `Home` 原链接。回归覆盖多个分卷、跨分卷引用、损坏分卷、路径重复和普通 ZIP 附件。

## 导入保真与预检

- 根目录条目使用来源名显示，身份与实际同名文件夹分开。验收核对导入后的笔记本 ID 和归属。
- Notion 和思源优先用 Front Matter 的显式标题；未设置时检查正文开头的一层标题。缩进代码不作为标题，ATX 闭合 `#` 不进入标题。Notion 的 `_all.csv` 附件笔记保留 `_all` 标记，省略 Notion ID，附件原文件名和字节保持原样。
- 只转换 Markdown 中的实际 HTML 媒体，成对处理音视频标签。保留相邻 Markdown、引用与列表结构、代码和 Front Matter；原有包裹 HTML 的媒体转换复用共享转换器。
- 思源 `assets` 下的 Markdown 按附件处理，跳过笔记正文扫描；引用缺失的 `assets` Markdown 与缺失图片一样阻止确认。普通页面引用仍保留并提示。
- 复用服务端来源枚举发布能力，移除生成独立附件笔记时重复写入的使用标记。既有来源、预检阻断、取消和同任务重试契约保持一致。

## 风险与回滚

导入可能无法保留来源特有语义，必须明确展示警告和边界。共享会话改动可能导致旧来源回归。回滚代码停止新导入能力，但不会删除已导入数据；不得覆盖既有导入记录。本次不发布生产。

## 验证

- Web 和桌面渲染器共用 `ThirdPartyImportDialog`、`NoteImportController`、`BrowserImportReader`、`NoteImportSession` 和任务级 `BrowserImportIndex`。格式差异集中在来源读取、标题与附件解析、预检提示。确认后由 `executeNoteImport` 统一写入、上传和续跑，经过现有实例及账号上下文检查，桌面沿用同步暂停与刷新。
- macOS ARM64 与 `jingwen-mini` Ubuntu 25.10 x86_64 均通过导入相关 133 项测试、Web 与移动端类型检查及 Web 生产构建。新增回归覆盖跨暂存块的多分卷读取、附件失败重试和索引清理、根目录身份、标题及 HTML 媒体保真、缺失思源 Markdown 附件。
- 思源 `assets/` 前缀使用区分大小写的字符串判断，沿祖先目录查找最近的精确匹配。`bun run lint` 和统一导入的 7 项集成测试通过。
- 同一公开原始 Notion 分卷 ZIP、实际 Notion 数据库 ZIP 和思源官方 3.8.10 ZIP，均在两端从设置入口完成导入，分别新增 280、1,032 和 2 篇。Linux 浏览器网络记录确认预检无导入写入，确认后经相同笔记导入、分片上传、编辑会话与受保护的正文更新接口。两端共用的样本核对中，实际数据库 ZIP 的 1,030 篇 Markdown、公开样本的 `Home` 正文及三个包的 6 个附件均与原件逐字节一致。
- macOS ARM64 打包版和 `jingwen-mini` 的 Linux x64 AppImage 均从桌面设置入口导入上述三个原包。预检无导入写入，新增数量与浏览器一致，全部笔记同步到本地 sidecar，六个附件的 SHA-256 与原件一致。
- 两端桌面包还通过同一份可复现的 1.25 GiB Notion 格式样本，包含两个内层 ZIP 和跨分卷附件引用。预检无导入写入，确认后新增 1 个笔记本、2 篇笔记和 4 个附件，2 篇笔记同步到 sidecar，4 个附件的 SHA-256 与原件一致，关闭导入窗口后 1,282 个暂存块全部清空。 本机 Chrome 连接隔离自托管实例，用同一大包得到相同的预检、写入、附件和暂存清理结果。

官方格式依据：[Notion 导出](https://www.notion.com/help/export-your-content)、[思源附件结构](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md)、[思源 API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)。
