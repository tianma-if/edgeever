# flomo 笔记迁移指引

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **提示**：第三方笔记迁入教程现已全面升级并合并至统一指引：
> 👉 **[第三方笔记平滑迁入 EdgeEver 完整指南](note-migration-guide.md)**（全面覆盖原生一键导入与 AI Agent / MCP 迁入）。

### 步骤 1：导出 flomo

在 flomo 网页版或桌面客户端中，点击左上角用户名及会员标识右侧的小下拉箭头，在账户菜单中进入 **设置 → 账号详情**，然后滚动账号详情内容区到页面最下方，点击全局导出并下载 HTML 导出 ZIP。

### 步骤 2：配置 EdgeEver MCP

在 EdgeEver 的 **设置 → API & MCP 授权** 中生成具有笔记、笔记本和资源读写权限的 Token，点击 **复制完整 MCP 配置**，并将其配置到 Codex、Claude Code、Cursor、WorkBuddy 等 AI Agent 中。

### 步骤 3：发送一条 Prompt 完成导入

把下面的 `/path/to/flomo-export.zip` 替换成真实路径，然后将整段 Prompt 发送给已经连接 EdgeEver MCP 的 Agent：

```text
请通过已配置的 EdgeEver MCP，将 `/path/to/flomo-export.zip` 中的全部笔记迁移到 `flomo` 笔记本，完整保留正文、标签、创建时间、图片和附件。迁移完成后校验完整性并报告结果。
```

确认迁移完整前，请保留原始 flomo ZIP。
