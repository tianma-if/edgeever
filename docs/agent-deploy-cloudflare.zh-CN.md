# AI Agent 在线部署 EdgeEver 约定

本文档为 AI Agent（以及自动化部署工具）在 Cloudflare 上在线部署 EdgeEver 的标准操作规范与约定。

> 💡 **核心原则**：纯 Serverless 架构部署，基于 Cloudflare 免费配额运行，无需购买 VPS 或配置 Docker/SSL 证书。

---

## 自动化部署标准步骤

1. **Fork 仓库**
   - Fork `tianma-if/edgeever` 到目标 GitHub 账户。

2. **启用工作流**
   - 在 Fork 仓库的 **Actions** 标签页中，启用 **Update deployed EdgeEver** 自动更新工作流。

3. **Cloudflare 项目导入**
   - 登录 Cloudflare **Workers & Pages** 控制台，导入该 Fork 仓库。
   - 配置项目使用仓库根目录、生产环境 `main` 分支，并读取仓库根目录下的 `wrangler.toml`。

4. **绑定资源与凭据 (Bindings & Secrets)**
   - **D1 数据库绑定**：Binding 名称填 `DB`，关联数据库名称为 `edgeever`。
   - **R2 存储桶绑定**：Binding 名称填 `RESOURCES`，关联全局唯一的 R2 Bucket。
   - **Worker Secret**：添加密钥 `EDGE_EVER_AUTH_PASSWORD`，值为初始管理员登录密码。

5. **配置 Workers Builds 命令**
   - 在 Cloudflare 项目的构建设置中，填入以下标准命令：

     ```text
     Build command: bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
     Deploy command: bun run deploy:cloudflare-builds
     ```

6. **启动首次构建与服务验证**
   - 触发启动首次构建，待构建部署完成后，进行如下自动化验证：
     - 检查 `https://<你的 Worker 域名>/api/health` 返回 `200` 状态码且 JSON 内容为 `{"ok": true}`。
     - 检查 `https://<你的 Worker 域名>/api/openapi.json` 能够正常加载 OpenAPI 规范。
     - 使用之前配置的 `EDGE_EVER_AUTH_PASSWORD` 验证登录 API 是否可用。

7. **验证上游更新通道**
   - 在 Fork 的 **Actions** 中手动运行一次 **Update deployed EdgeEver**，确认上游同步与构建更新流程畅通。
