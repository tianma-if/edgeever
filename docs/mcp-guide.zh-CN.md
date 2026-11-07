# 在 MCP 客户端与 AI Agent 中使用 EdgeEver

[English](mcp-guide.md)

## 1. 连接客户端

在 **个人中心** → **API / MCP** 中为每个客户端单独创建 Token，然后点击 **复制 MCP 配置**。搜索和总结选 **只读访问**，需要新建或修改笔记时选 **完全访问**。如果 Token 泄露，在这里删除它并创建新的 Token。

远程客户端通过 Streamable HTTP 连接。使用实例地址加 `/mcp`，例如 `https://notes.example.com/mcp`，并发送 `Authorization: Bearer <token>`。请确认复制的地址指向你的 EdgeEver 实例。

### Cursor 等支持 `mcpServers` 的客户端

将 **复制 MCP 配置** 得到的 JSON 粘贴到客户端的 MCP 设置中。下面是 `mcpServers` 示例。请把真实 Token 留在本地，避免提交到仓库。

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

### Claude Code

```bash
claude mcp add --scope user --transport http edgeever https://notes.example.com/mcp \
  --header "Authorization: Bearer <token>"
claude mcp get edgeever   # 应显示 "Connected"
```

省略 `--scope user` 可将配置限制在当前项目。

### VS Code

在 `.vscode/mcp.json` 或用户级 `mcp.json` 中使用 `servers` 和 `type: "http"`。以下示例会提示输入 Token，也可以改用环境变量 `${env:EDGEEVER_TOKEN}`。

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

### 仅支持 stdio 的客户端

安装 Bun，在仓库根目录保存连接配置，再让客户端启动桥接脚本。将示例路径替换为脚本的实际绝对路径。

```bash
# 一次性：在 ~/.edgeever/config.json 中保存配置
bun run cli -- profile set personal --url https://notes.example.com --token "<token>"

# 在客户端中运行：
bun /path/to/edgeever/scripts/edgeever-mcp-stdio.mjs --profile personal
```

也可以用 `EDGEEVER_URL` 和 `EDGEEVER_TOKEN` 环境变量代替 `--profile`。只支持 OAuth 的连接器无法直接连接。如果客户端能启动本地命令，可使用此桥接。

## 2. 验证连接

让 Agent 调用 `get_current_user`，核对返回的账号、工作区和 Token 权限。再让它调用 `list_notebooks`，确认能读取笔记本。

可以在客户端自定义指令、`AGENTS.md` 或 `CLAUDE.md` 中加一条规则。例如「新笔记放进『Agent 笔记』，先搜索同主题笔记。删除或合并前先征得我的同意。」

使用 `get_memo` 读取普通笔记，或在 `list_memos` 中设置 `includeContent: true` 获取全文时，响应会提供笔记元数据和一份 `contentMarkdown` 正文。已有集成如果读取 `contentJson` 或 `contentText`，请传入 `format: "all"` 以保留原有响应。

使用 `search_memos` 进行关键词搜索时，如果能在正文中定位查询词或其中的词项，结果还会包含最多 200 个字符的 `snippet` 命中片段，并保留原有 `excerpt` 摘要。无法定位正文命中的结果（包括仅标题或标签命中）沿用现有摘要。如果答案涉及片段外的上下文，请继续读取笔记全文。

## 3. 排障

| 现象 | 原因与处理 |
|---|---|
| `401`，提示 "Authentication required" | 客户端没有发送凭据。检查是否设置了 `Authorization` 请求头，包括请求头名称和 `Bearer ` 前缀。 |
| `401`，且 `WWW-Authenticate` 响应头包含 `error="invalid_token"` | Token 已发送但被拒绝。确认它属于当前实例；如果已被删除或替换，创建新 Token 并更新客户端。 |
| `403` "Origin is not allowed" | 基于浏览器的客户端发送了外部 `Origin`。请在浏览器外运行客户端，或使用 stdio 桥接。 |
| 客户端报告 JSON 无效或收到 HTML 页面 | URL 没有指向服务器上的 `/mcp`（例如拼写错误、`//mcp` 或桌面应用地址）。 |
| 修改数据的工具被拒绝 | Token 为只读。确实需要写入时，再为该客户端创建 **完全访问** Token。 |

较旧的实例可能对缺少凭据和 Token 被拒绝返回相同的通用 `401`。先核对实例地址、请求头和 Token。
