# 聚焦笔记标题与正文的快捷键

[English](2026-11-02-focus-title-body-shortcuts.md)

关联 Issue：#759

## 问题与结果

切换笔记或搜索后，要把光标移到当前笔记的标题或正文只能用鼠标。在现有快捷键体系中新增两个可配置操作：**聚焦笔记标题**和**聚焦笔记正文**，出现在“设置 → 快捷键”中，可以像其他操作一样重新录制。

## 行为

1. 默认键：标题为 `⌘⌥T`（macOS）、`Ctrl+Alt+T`（Windows）和 `Ctrl+Alt+Shift+T`（Linux 与 ChromeOS，那里 `Ctrl+Alt+T` 会打开终端）；正文为 `⌘⌥B` / `Ctrl+Alt+B`。平台默认值来自 `getDefaultShortcutSettings`，“恢复默认”也使用它。它们不与现有 EdgeEver 默认快捷键或 Tiptap/CodeMirror 键位冲突（`Mod-Shift-B` 引用块、`Mod-Alt-1…6` 标题、`Mod-Alt-C` 代码块）。
2. 打开文本笔记时，两个操作在工作区任何位置都可用，包括搜索框和笔记列表。标题操作把光标放在标题末尾；正文操作根据当前模式聚焦富文本编辑器（Tiptap 恢复之前的光标位置）或 Markdown 源码编辑器，移动端纯文本编辑器同样处理。
3. 只读笔记（回收站、阅读保护）、打开会屏蔽编辑器快捷键的对话框或未选中笔记时不执行任何操作。表格、图表、海报和信息图笔记忽略这两个操作。
4. 桌面端独立笔记窗口支持相同操作。
5. Apple 键盘上 Option 会改变上报的按键（`⌘⌥T` 上报 `†`），因此按住 Option 时改用 `event.code` 中的物理字母匹配，与快捷键录制器现有做法一致。其他平台继续按产生的字符匹配，使用 AltGr（`Ctrl+Alt`）输入字符的键盘布局仍能正常输入。

## 边界、风险与恢复

本次只改客户端：快捷键设置仍保存在现有本地偏好 `edgeever.shortcutSettings` 中，旧设置通过现有补全逻辑获得新默认值。不涉及服务端、数据库、迁移、同步、安装器或更新。

风险：浏览器或系统仍可能占用其中某个组合，用户可在设置中改绑。已把这些组合录制给其他操作的用户保持原操作，因为排在前面的操作优先匹配。回滚只需撤销本次改动，旧版本会忽略多出的存储键。

## 验证

- Playwright（`tests/e2e/note-focus-shortcuts.spec.ts`，在现有浏览器 CI 任务中运行）分别使用 Windows、macOS 与 Linux 平台默认键：验证获得焦点的元素及标题光标位于末尾（从搜索框和 Markdown 编辑器内触发）、富文本与 Markdown 正文、阅读保护下及快速切换对话框打开时焦点不变，并确认笔记标题和正文未被修改。去掉只读判断后该用例会失败。
- 单元测试覆盖默认值、Windows/Linux/macOS 匹配（含 macOS Option 字符）、AltGr 字符不触发、旧设置补全以及设置列表顺序。
- 在本地自托管构建上用浏览器验证（Chrome、macOS）：从搜索框聚焦标题，富文本与 Markdown 模式聚焦正文，在 Markdown 编辑器内聚焦标题，阅读保护下不执行，两个操作出现在“设置 → 快捷键”中。
- `bun run typecheck`、`bun run typecheck:mobile`、`bun run lint`、`bun run build:web` 和 `bun run test` 通过。
- 未手动验证 Windows/Linux 实体键盘和打包后的桌面笔记窗口。
