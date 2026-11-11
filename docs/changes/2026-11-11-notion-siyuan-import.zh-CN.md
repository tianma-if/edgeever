# Notion 与思源 Markdown 导入

[English](2026-11-11-notion-siyuan-import.md)

关联 #794，沿用 #834 flomo 使用的统一导入框架：来源选择、Worker/索引、预检、目标位置、分片上传、进度、取消与重试共用现有实现。不新增导入接口、数据库迁移或独立入口。

## 范围与行为

- Notion：官方 Markdown & CSV ZIP 或解压目录。开头标题作为笔记标题，Front Matter 优先；仅显示名称去除末尾 Notion ID，保留原路径身份，避免同名目录混淆。CSV 原始内容作为附件，没有正文引用的 CSV 创建附件笔记。不重建数据库关联、公式或视图。
- 思源：包含 assets 的官方 Markdown ZIP 或解压目录。沿祖先目录寻找最近的 `assets/`；assets 内的 Markdown 文件作为附件。HTML 图片、音视频通过共享的不可执行 HTML 转换器处理，跳过代码示例和 Front Matter。
- 页面链接和思源块引用保留原文并提示。缺失附件、未引用的嵌套 ZIP/.sy 文件阻止预检；其他未导入文件有警告。仅使用受支持元数据中存在的时间，缺失时间沿用框架的导入时间行为。
- 新任务新增笔记，同任务重试复用身份并补齐失败上传。CSV 可下载且字节不变。不接入来源账号，也不由服务器抓取导出包。

## 风险与回滚

导入可能无法保留来源特有语义，必须明确展示警告和边界。共享会话改动可能导致旧来源回归。回滚代码停止新导入能力，但不会删除已导入数据；不得覆盖既有导入记录。本次不发布生产。

## 验证

本地 Git 网络不可用，使用 GitHub 连接器获取并核对 SHA 的上游 `94813fe7e7685eae94b662414248f72be8a307fa` 文本快照。

- `bun test packages/shared/src/note-import apps/web/src/lib/note-import tests/markdown-export-import.integration.test.mjs`：49 项通过。使用真实 API 处理器、临时 SQLite 和本地附件，覆盖 ZIP、CSV 字节一致性、HTML 媒体、缺失附件预检、旧服务端拒绝、上传失败恢复、同任务不重复、新任务新增。
- 原有 `tests/note-import.integration.test.mjs` 的 78 项用例：使用临时进程内传输适配后全部通过，覆盖旧来源及仓库中的真实导出 fixtures。只替换监听 HTTP 服务与 Content-Length 传输处理。当前环境不能监听本地端口，原 HTTP 测试未通过运行；进程内结果不能替代浏览器或网络验收。
- `bun run typecheck`、`bun run typecheck:mobile` 通过。
- `bun run build:web` 被本地快照缺失上游 `apps/web/src/assets/import-logos/flomo.png` 阻断。连接器不能获取该二进制，本地网络不可用；PR 不修改或删除该素材。
- 未验证：浏览器交互与生产 Worker 构建、真实 Notion/思源账号导出、远端吞吐和任意大包。补齐前保留草稿 PR。

官方格式依据：[Notion 导出](https://www.notion.com/help/export-your-content)、[思源附件结构](https://github.com/siyuan-note/siyuan/blob/master/docs/WORKSPACE.md)、[思源 API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)。
