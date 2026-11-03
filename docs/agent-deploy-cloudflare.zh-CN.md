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

3. **创建 Worker**
   - 在 **Workers & Pages** → **Create application** → **Start with Hello World!** 中创建并部署名称严格为 `edgeever` 的 Worker。
   - 此时只是占位服务，不代表 EdgeEver 已部署。已有 EdgeEver 实例应复用其 Worker 和认证 Secret，不得替换为 Hello World 或重置密码。

4. **连接 Fork 前配置运行时 Secret**
   - 在该 Worker 的 **Settings** → **Variables and Secrets** 中添加 **Secret** 类型的 `EDGE_EVER_AUTH_PASSWORD`，值为初始管理员登录密码（建议至少 32 个字符），并点击 **Deploy**。
   - 确认 Secret 名称已出现在列表中，再连接仓库。密码只保存为 Worker 运行时 Secret，不得写入 Workers Builds 构建变量或 Fork 文件。

5. **连接 Fork**
   - 在这个已有 Worker 的 **Settings** → **Builds** → **Connect** 中授权 GitHub 访问并选择 Fork 的 `main` 分支。参考 [Cloudflare 连接已有 Worker 的步骤](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker)。不要使用 Deploy to Cloudflare 模板入口，也不要创建 Pages 应用。
   - 使用仓库根目录与默认部署命令 `npx wrangler deploy`，由 Cloudflare 在线执行并接入 EdgeEver 的受验证部署流程。已有部署可保留显式的 `bun run build:cloudflare` 与 `bun run deploy:cloudflare-builds` 命令。
   - 不要修改 `wrangler.toml` 或重复添加 binding。部署根据 `edgeever` 自动查询 D1 UUID，并生成临时 `DB` 与 `RESOURCES` binding。其他数据库名称通过 `EDGE_EVER_D1_DATABASE_NAME` 设置；仅无法查询 UUID 时使用 `EDGE_EVER_D1_DATABASE_ID`。非敏感实例参数放入 Workers Builds 构建变量。
   - 已有部署默认沿用线上 `RESOURCES` binding 与管理员用户名，不要求用户重命名或重新配置自定义 R2 存储桶。受版本控制的配置保持不变，确保 Fork 默认作为部署镜像。

6. **配置部署权限**
   - 在 **Settings → Builds → API token** 中选择或创建 Workers Builds 部署应用使用的 Cloudflare API Token。选择 **Create new token** 会自动生成 Token，但默认权限可能不含 D1；到[个人资料 → API Tokens](https://dash.cloudflare.com/profile/api-tokens) 为其补充目标账户的 D1 读取和编辑权限，并保留原有部署权限。在该 Worker 的 **Settings → Builds → API token** 中选用该 Token 并保存构建设置。后续 Cloudflare Workers Builds 会使用它执行数据库迁移和 Worker 部署。

7. **启动首次构建与服务验证**
   - 用户名默认使用 `admin`；仅用户要求自定义时，在启动首次构建前设置 `EDGE_EVER_AUTH_USERNAME`。
   - 在 Fork 的 GitHub 仓库中进入 **Actions → Update deployed EdgeEver**，按提示启用工作流，选择 `main` 分支并点击 **Run workflow**。该工作流会重新发布所选上游版本，即使 Fork 已对齐也会触发新的部署事件。返回 Cloudflare 的 **Deployments** 查看对应构建。
   - 缺少认证配置是需要修正的部署错误，不是预期的首次构建失败。保持认证与部署校验开启。
   - 在 Cloudflare 确认对应构建成功、部署完成后，验证 `/api/health` 返回 HTTP `200` 及 `{"ok": true}`，`/api/openapi.json` 可访问且 JSON 含 `"ok": true`，并使用管理员用户名及密码验证登录 API。Hello World 响应不能通过验收。

   - 后续由该工作流自动同步正式版本，持续获得功能更新和问题修复。

## 上游更新通道说明
   - 普通 Fork 默认作为部署镜像，无需配置任何更新变量：工作流会把所选上游 Release 的产品代码快照应用到 `main`，再触发 Cloudflare。
   - 更新器会把 Fork 自己的完整 `.github/workflows/**` 目录及两个更新辅助脚本作为稳定的本地引导层保留。官方打包、签名、测试与 Release 工作流继续通过 `tianma-if/edgeever` 仓库门禁限制执行，也不会被下游产品更新改写。
   - 只有明确维护了应用代码修改的 Fork，才应创建 Actions 仓库变量 `EDGE_EVER_PRESERVE_FORK_CHANGES=true`。启用后改为 merge，并由仓库所有者处理未来冲突；普通部署无需设置。
   - 打开 Job **Summary**，确认 Fork mode 为 `mirror`，并显示上游目标（stable Release 或 edge `main`），以及「已发布更新」或明确的「已对齐」结果。
   - 若发生了 push，确认 Cloudflare **Deployments** 构建的是对应的 `main` commit。
   - 普通部署 Fork 不应修改部署文件，日常升级也不要依赖 GitHub **Sync fork**；本工作流就是唯一需要的同步路径。只有旧 Fork 必须取得新版更新工作流本身时，才使用一次 **Sync fork**，之后继续使用 **Update deployed EdgeEver**。

## 可选：自定义初始管理员用户名

普通部署直接使用默认用户名 `admin`，不要主动询问用户是否需要修改。仅当用户明确要求自定义管理员用户名时，才在启动首次构建前通过 Workers Builds 构建变量设置 `EDGE_EVER_AUTH_USERNAME`，并在登录验证时使用该用户名。管理员账号已创建后，仅修改该变量不会重命名现有账号。
