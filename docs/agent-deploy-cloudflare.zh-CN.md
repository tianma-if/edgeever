# AI Agent 在线部署 EdgeEver 约定

本文档为 AI Agent（以及自动化部署工具）在 Cloudflare 上在线部署 EdgeEver 的标准操作规范与约定。

> 💡 **核心原则**：纯 Serverless 架构部署，基于 Cloudflare 免费配额运行，无需购买 VPS 或配置 Docker/SSL 证书。

---

## 自动化部署标准步骤

1. **Fork 仓库**
   - Fork `tianma-if/edgeever` 到目标 GitHub 账户。

2. **创建 Cloudflare 资源**
   - 创建名称严格为 `edgeever` 的 D1 数据库。
   - 创建名称严格为 `edgeever-resources` 的 R2 存储桶。

3. **Cloudflare 项目导入**
   - 登录 Cloudflare **Workers & Pages** 控制台，导入该 Fork 仓库。
   - 配置项目使用仓库根目录、生产环境 `main` 分支，并读取仓库根目录下的 `wrangler.toml`。

4. **配置登录凭据与实例参数**
   - **Worker Secret**：添加密钥 `EDGE_EVER_AUTH_PASSWORD`，值为初始管理员登录密码；建议使用至少 32 个字符且仅用于此实例的强密码。
   - 该密码只配置为 Worker 运行时 Secret，不要复制到 Workers Builds 构建变量；标准部署入口会复用并验证已存在的 Secret。
   - 不要修改 `wrangler.toml`，也不要在控制台重复添加 binding。部署命令会根据标准资源名称生成 `DB` 与 `RESOURCES` binding。
   - 对按旧版文档部署的已有 Worker，不要要求用户重命名或重新配置自定义 R2 存储桶。没有显式覆盖时，部署会自动保留线上 `RESOURCES` binding 与管理员用户名。

5. **配置 Workers Builds 命令**
   - 在 Cloudflare 项目的构建设置中，填入以下标准命令：

     ```text
     Build command: bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
     Deploy command: bun run deploy:cloudflare-builds
     ```

   - 部署命令会根据 `edgeever` 数据库名称自动查询 D1 UUID，并把所有实例参数仅写入临时生成的 Wrangler 配置。受版本控制的 `wrangler.toml` 必须保持不变；若把实例专属配置提交到该文件，部署会直接拒绝，避免 Fork 因基础设施配置产生分叉。
   - 请确保 Workers Builds API Token 具有 D1 读取和编辑权限。高级非敏感自定义参数应放在 `EDGE_EVER_*` Workers Builds 构建变量中。如使用其他数据库名称，设置 `EDGE_EVER_D1_DATABASE_NAME`；仅在无法自动查询 UUID 时设置 `EDGE_EVER_D1_DATABASE_ID`。密码始终属于运行时 Secret。

6. **启动首次构建与服务验证**
   - 触发启动首次构建，待构建部署完成后，进行如下自动化验证：
     - 检查 `https://<你的 Worker 域名>/api/health` 返回 `200` 状态码且 JSON 内容为 `{"ok": true}`。
     - 检查 `https://<你的 Worker 域名>/api/openapi.json` 能够正常加载 OpenAPI 规范。
     - 使用用户名 `admin` 和 `EDGE_EVER_AUTH_PASSWORD` 验证登录 API。

7. **验证上游更新通道**
   - 在 Fork 仓库的 **Actions** 标签页中启用 **Update deployed EdgeEver**（公共 Fork 上定时任务默认关闭，必须手动启用）。
   - 普通 Fork 默认作为部署镜像，无需配置任何更新变量：工作流会把所选上游 Release 的产品代码快照应用到 `main`，再触发 Cloudflare。
   - 更新器会把 Fork 自己的完整 `.github/workflows/**` 目录及两个更新辅助脚本作为稳定的本地引导层保留。官方打包、签名、测试与 Release 工作流继续通过 `tianma-if/edgeever` 仓库门禁限制执行，也不会被下游产品更新改写。
   - 只有明确维护了应用代码修改的 Fork，才应创建 Actions 仓库变量 `EDGE_EVER_PRESERVE_FORK_CHANGES=true`。启用后改为 merge，并由仓库所有者处理未来冲突；普通部署无需设置。
   - 在 Fork 的 **Actions** 中手动运行一次 **Update deployed EdgeEver**。即使 Fork 已对齐，手动运行也会重新发布所选版本，确保 Cloudflare 收到新的构建事件。
   - 打开 Job **Summary**，确认 Fork mode 为 `mirror`，并显示上游目标（stable Release 或 edge `main`），以及「已发布更新」或明确的「已对齐」结果。
   - 若发生了 push，确认 Cloudflare **Deployments** 构建的是对应的 `main` commit。
   - 普通部署 Fork 不应修改部署文件，日常升级也不要依赖 GitHub **Sync fork**；本工作流就是唯一需要的同步路径。只有旧 Fork 必须取得新版更新工作流本身时，才使用一次 **Sync fork**，之后继续使用 **Update deployed EdgeEver**。

## 可选：自定义初始管理员用户名

普通部署直接使用默认用户名 `admin`，不要主动询问用户是否需要修改。仅当用户明确要求自定义管理员用户名时，才在首次构建前通过 Workers Builds 构建变量设置 `EDGE_EVER_AUTH_USERNAME`，并在登录验证时使用该用户名。管理员账号已创建后，仅修改该变量不会重命名现有账号。
