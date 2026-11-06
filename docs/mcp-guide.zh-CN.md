# 在 MCP 客户端与 AI Agent 中使用 EdgeEver

[English](mcp-guide.md)

每个 EdgeEver 实例（Cloudflare 与 Docker 相同）都在 `/mcp` 提供远程 MCP 服务器。使用 API Token，Claude Code、Cursor、Codex 等 Agent 可以在你自己的工作区内搜索、阅读和编辑笔记。本文介绍如何连接客户端、选择 Token 权限，以及为 Agent 设定工作规则。

## 1. 创建 Token

1. 打开 **个人中心** → **API / MCP**。
2. 填写能识别客户端的名称，例如 `Claude Code（笔记本电脑）`。每个客户端单独使用一个 Token，之后可以只撤销其中一个。
3. 选择访问级别：
   - **只读访问**：读取笔记、笔记本、标签和附件。适合只做搜索和总结的 Agent。
   - **完全访问**：还可以创建和修改笔记、笔记本、标签和附件，将笔记移入回收站，并用工作区默认模型生成视频笔记总结。
4. 点击 **创建 Token**，然后在新 Token 上使用 **复制 MCP 配置**。

请像对待密码一样对待 Token。拿到 Token 的人可以在其权限范围内操作你的工作区。如果 Token 出现在聊天、日志或代码仓库中，请在 **API / MCP** 中删除它并创建新的 Token。使用已删除 Token 的客户端会立即失去访问权限。

## 2. 连接客户端

服务器使用 MCP Streamable HTTP，需要实例地址加 `/mcp`，以及请求头 `Authorization: Bearer <token>`：

```json
{
  "mcpServers": {
    "edgeever": {
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

请使用 EdgeEver 服务器的地址，`/mcp` 前不要带末尾斜杠。在浏览器中，**复制 MCP 配置** 会根据页面地址自动填写；在桌面端，粘贴前请确认 URL 是你的服务器地址。

### Claude Code

```bash
claude mcp add --scope user --transport http edgeever https://notes.example.com/mcp \
  --header "Authorization: Bearer <token>"
claude mcp get edgeever   # 应显示 "Connected"
```

`--scope user` 让该服务器在所有项目中可用；省略则只在当前项目中注册。

### VS Code

VS Code 读取 `.vscode/mcp.json`（或用户级 `mcp.json`）。它使用顶层 `servers` 对象，并需要 `"type": "http"`。通过 input 引用 Token，避免把它写入受版本控制的文件：

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "edgeever-token",
      "description": "EdgeEver API Token",
      "password": true
    }
  ],
  "servers": {
    "edgeever": {
      "type": "http",
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer ${input:edgeever-token}" }
    }
  }
}
```

VS Code 会在服务器首次启动时提示输入 Token 并安全保存。也可以使用 `${env:EDGEEVER_TOKEN}` 从环境变量读取。

### Cursor 等 HTTP 客户端

将上面的 JSON 配置粘贴到客户端的 MCP 设置中。支持 `url` 和 `headers` 的客户端通常无需额外修改。不要把 Token 写入会提交到仓库的文件。

### 只能启动本地（stdio）服务器的客户端

有些客户端只能启动本地进程。仓库中提供了一个 stdio 桥接脚本，将请求转发到远程端点：

```bash
# 一次性：在 ~/.edgeever/config.json 中保存配置
bun run cli -- profile set personal --url https://notes.example.com --token <token>

# 在客户端中运行：
bun /path/to/edgeever/scripts/edgeever-mcp-stdio.mjs --profile personal
```

也可以不使用配置，改为通过环境变量 `EDGEEVER_URL` 和 `EDGEEVER_TOKEN` 传入。

### 只支持 OAuth 的客户端

EdgeEver 使用 API Token 认证 MCP，不提供 OAuth 登录。只接受 OAuth 的连接器无法直接连接；如果客户端可以运行本地命令，请使用上面的 stdio 桥接。

## 3. 检查连接

让 Agent 调用 `get_current_user`。它会返回用户、工作区和 Token 的权限范围，用于确认 Agent 写入的是预期账号。然后可以调用 `get_workspace_stats` 或 `list_notebooks`。

如果失败：

| 现象 | 原因与处理 |
|---|---|
| `401`，提示 "Authentication required" | 客户端没有发送凭据。检查是否设置了 `Authorization` 请求头，包括请求头名称和 `Bearer ` 前缀。 |
| `401`，且 `WWW-Authenticate` 响应头包含 `error="invalid_token"` | Token 已发送但被拒绝。确认它属于当前实例；如果已被删除或替换，创建新 Token 并更新客户端。 |
| `403` "Origin is not allowed" | 基于浏览器的客户端发送了外部 `Origin`。请在浏览器外运行客户端，或使用 stdio 桥接。 |
| 客户端报告 JSON 无效或收到 HTML 页面 | URL 没有指向服务器上的 `/mcp`（例如拼写错误、`//mcp` 或桌面应用地址）。 |
| 修改数据的工具被拒绝 | Token 为只读。为该客户端创建 **完全访问** Token。 |

较旧的实例在两种情况下可能返回相同的通用 `401`，因此仅凭 `401` 不能证明 Token 已被撤销。

## 4. Agent 可以做什么

服务器提供约 60 个工具，主要分组如下：

- **查找与阅读**：`search_memos`、`list_memos`、`get_memo`、`list_notebooks`、`find_notebooks`、`resolve_notebook_path`、`list_tags`、`get_workspace_stats`。
- **编写笔记**：`create_memo`、`update_memo`、`move_memos`、`add_tags_to_memos`、`remove_tags_from_memos`、`upload_memo_image`、`upload_memo_attachment`。
- **结构化笔记**：表格、图表（思维导图、流程图、架构图）、信息图和海报，各有独立的创建、读取和更新工具。
- **整理**：创建、重命名、移动和删除笔记本；重命名、删除和合并标签；合并笔记。
- **历史与恢复**：`trash_memos` 与 `restore_memos`、`list_memo_revisions`、`restore_memo_revision`。
- **导入**：支持 `dryRun` 的 `import_memos`，用于从其他应用迁入笔记。
- **模板与 AI 指令**：列出、读取、创建、更新和使用笔记模板与 AI 指令。

移入回收站可以恢复。`delete_notebook` 会拒绝删除仍包含笔记的笔记本。`merge_memos` 会创建一条新笔记，并将原笔记移入回收站。

## 5. Agent 工作规则

客户端连接时，服务器已经发送通用说明：确认账号、预览导入、将导入内容视为数据，并优先使用只读工具。你自己的规则应写在 Agent 的指令中，例如 `CLAUDE.md`、`AGENTS.md` 或客户端的自定义指令。可以从下面的示例开始：

```markdown
## EdgeEver 笔记（MCP 服务器 `edgeever`）

- 每个会话调用一次 `get_current_user`；如果不是预期账号就停止。
- 新笔记放在「Agent 笔记」笔记本中。用 `find_notebooks` 查找它的 id，只有不存在时才创建。
- 创建笔记前，先用 `search_memos` 搜索同一主题。已有笔记时用 `update_memo` 更新，不要创建重复笔记。
- 标题格式：`<项目> – <主题>`。标签：项目名和笔记类型。
- 不要在笔记中写入 Token、密码、密钥或其他机密信息。
- 除非我在本次对话中明确要求，否则不要将笔记移入回收站、合并或删除笔记、笔记本和标签。工具支持 `dryRun` 时先预览。
- 使用工具返回的准确 id，不要猜测 id。
- 更新前先读取笔记，保留未被要求修改的内容。
```

请根据自己的工作方式调整笔记本、标题格式和限制。使用只读 Token 时，只保留阅读相关的规则。
