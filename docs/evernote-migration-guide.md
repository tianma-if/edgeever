# 印象笔记（Evernote）极简迁移指引

[简体中文](evernote-migration-guide.md) | [English](evernote-migration-guide.en-US.md)

我们强烈推荐使用 AI 编程助手（如 Codex、Antigravity、Claude Code、Cursor、OpenClaw、Hermes Agent 等）自动执行迁移。该方案已完成内存流式优化与空文本预处理，能安全应对数 GB 级别超大笔记库，完整保留创建/修改时间与嵌套笔记本目录层级。

---

### 步骤 1：配置并安装 EdgeEver MCP 服务

1. 点击网页端左下角的 **设置（Settings）** 图标。
2. 在 **API & MCP 授权** 卡片生成 Token 后，点击 **复制完整 MCP 配置** 按钮。
3. 把复制的 JSON 配置直接粘贴发送给你的 AI 编程助手（如 Codex, Antigravity, Claude Code, Cursor, OpenClaw, Hermes Agent 等），让它帮你自动在当前的 AI 客户端中安装配置好该 MCP 服务：

```sh
你是 AI 编程助手。这是我的 EdgeEver MCP 服务配置 JSON。请帮我把这个 MCP 服务直接配置到我当前使用的 AI 编辑器/客户端（如 Codex, Claude Code, Cursor, Cline 等）的 MCP 服务器配置文件中：

<在此处粘贴刚才复制 of JSON 配置内容>
```

---

### 步骤 2：让 AI 助手自动导入和迁移笔记

当 AI 助手配置好 MCP 之后，请复制以下 Prompt 发送给它，让它全自动拉取印象笔记数据并导入：

```sh
你是 AI 编程助手。请帮我把本地的印象笔记全量迁移到我当前部署的 EdgeEver 实例中：
1. 检查并使用 `pipx install evernote-backup` 自动安装备份工具。
2. 提示我输入印象笔记的用户名和密码并初始化数据库（指定 china 后端），随后同步数据并导出到 `./evernote-export` 目录。
3. 从 GitHub 下载最新版迁移脚本：`https://raw.githubusercontent.com/tianma-if/edgeever/main/scripts/import-evernote-enex-via-mcp.mjs` 到本地。
4. 安装脚本所需的本地图片压缩库 `sharp` 和 `fast-xml-parser` 依赖。
5. 使用先前配置的 URL 和 Token 运行该脚本完成迁移（脚本会自动进行 WebP 图片转换）：
   - 全量迁移：`bun import-evernote-enex-via-mcp.mjs --input "./evernote-export" --yes`
   - 指定迁移某些笔记本：追加 `--include "笔记本A,笔记本B"` 参数。

请告诉我你需要什么信息（如账号密码），收到后直接并发自动执行上述步骤。
```

> 💡 **手动模式备用**：如果您不使用 AI 助手，也可以手动前往 GitHub 仓库 [EdgeEver GitHub](https://github.com/tianma-if/edgeever) 下载 \`scripts/import-evernote-enex-via-mcp.mjs\` 脚本并按其头部注释执行。

---

### 步骤 3：在网页端验证结果

1. 导入完成后，回到 EdgeEver 网页端刷新页面。
2. 检查左侧栏，确认印象笔记原有的「笔记本组（堆叠）」层级结构已完美还原。
3. 打开几篇包含多张图片的笔记，验证其中的图片是否已成功在编辑器中加载并能清晰显示。
