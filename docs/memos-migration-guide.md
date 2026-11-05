# Memos 笔记极简迁移指引

[简体中文](note-migration-guide.md) | [English](note-migration-guide.en-US.md)

> 💡 **提示**：第三方笔记迁入教程现已全面升级并合并至统一指引：
> 👉 **[第三方笔记平滑迁入 EdgeEver 完整指南](note-migration-guide.md)**（全面覆盖原生一键导入与 AI Agent / MCP 迁入）。

由于 EdgeEver 原生支持 AI Agent (Model Context Protocol, MCP) 接入，你甚至不需要导出任何数据文件，可以直接利用 AI 助手作为桥梁，同时挂载 **Memos MCP** 和 **EdgeEver MCP** 两个服务，实现全自动的云对云笔记搬家。

---

### 迁移步骤

#### 步骤 1：在 AI 助手中安装并启用两个 MCP 服务

1. **配置 Memos MCP 服务**：
   将你的旧 Memos 实例的 MCP 服务（可以使用 Memos 官方或社区提供的 MCP 插件）配置到你的 AI 助手（如 Claude Code/Cursor/WorkBuddy 等）中。
   
2. **配置 EdgeEver MCP 服务**：
   - 登录你的 EdgeEver 实例，点击左下角的 **个人中心** -> **MCP 设置**。
   - 生成 API Token 并点击 **复制完整 MCP 配置**。
   - 将此配置粘贴发送并安装到你的 AI 助手中。

确保你的 AI 助手在运行中能够同时访问并调用这两个 MCP 服务。

#### 步骤 2：给 AI 助手发送指令开始搬家

复制以下 Prompt 直接发送给已经挂载好两个 MCP 的 AI 助手：

```text
你是我的 AI 助手。现在你同时连接了我的旧 Memos MCP 服务和新 EdgeEver MCP 服务。
请帮我把旧 Memos 里的所有笔记迁移到新 EdgeEver 中：
1. 首先调用 Memos MCP 的读取/获取接口，分批次读取出我所有的旧 Memos 笔记（包含文本、创建时间、标签等信息）。
2. 然后调用 EdgeEver MCP 的创建/写入接口，将这些读取到的笔记批量写入到我的 EdgeEver 实例中。
请在全量迁移完成后，告诉我总共成功同步导入了多少条笔记。
```

AI 助手将全自动调用 Memos 接口读取数据，并同时调用 EdgeEver 接口写入，实现全自动的“双 MCP 数据桥接”迁移。

#### 步骤 3：在网页端验证
回到 EdgeEver 网页端刷新，确认所有的 Memos 笔记已成功录入，时间戳和标签也都已完美同步。
