# MCP 服务器地址、发现请求响应与客户端路径编码

[English](2026-11-05-mcp-endpoint-addressing.md)

关联 Issue：#798

## 问题与结果

- **桌面端 MCP 配置**：API / MCP 中的「复制配置」和「示例配置」此前使用页面来源。桌面端页面来源是 `edgeever-app://app`，复制出的地址是 `edgeever-app://app/mcp`，任何 MCP 客户端都无法连接。现在桌面端使用已配置的实例地址（去掉末尾斜杠）；未配置服务器时显示 `https://your-edgeever-server/mcp`。浏览器仍使用页面来源。
- **OAuth 发现**：`/.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server` 与 `/.well-known/openid-configuration`（含任意后缀）以及 `/mcp/*` 现在由应用返回 JSON 404，而不是 Web 应用页面。探测 OAuth 的 MCP 客户端会得知未提供 OAuth，而不是因解析 HTML 失败。Cloudflare 在 `run_worker_first` 中列出这些路径（同步更新 `wrangler.toml` 校验哈希）；Docker 使用 `apps/api/src/app-paths.ts` 中共享的 `isEdgeEverAppPath`。
- **MCP 401**：未携带 Bearer 令牌时，错误信息说明如何发送令牌；令牌被拒绝时返回 `WWW-Authenticate: Bearer realm="EdgeEver MCP", error="invalid_token"`（RFC 6750），并说明令牌无效或已撤销。
- **API 客户端**：路径中的 ID（会话、用户、笔记本、API 令牌、模板、笔记、分享、修订）与其他方法一致，使用 `encodeURIComponent` 编码。
- **测试**：多模型提供商测试不再依赖两个模型恰好在不同毫秒创建。

## 不变边界、风险与恢复

- 不改变存储、迁移、登录或令牌格式。有效令牌行为不变，401 状态码与 JSON-RPC 错误码 `-32001` 不变；仅错误文本和被拒令牌的 `error` 属性为新增。
- `wrangler.toml` 只新增 `run_worker_first` 规则。Worker 对这些路径返回已有的 JSON 404，其他页面仍由静态资源处理。回滚：还原本次修改与校验哈希。
- 在 Cloudflare 上，手动输入的双斜杠地址（如 `https://host//mcp`）仍由静态资源处理；应用本身不再生成此类地址。
- 未验证：桌面安装包和 Cloudflare 部署。桌面端逻辑由单元测试覆盖；路由已在本地自托管服务器上检查。
