# EdgeEver 手动在线部署指南

通过 GitHub 和 Cloudflare 在浏览器中部署 EdgeEver，无需本地安装代码或配置服务器。

---

## 前置准备

- **GitHub 账户**（用于 Fork 仓库及配置自动更新）
- **Cloudflare 账户**（用于托管 Worker 逻辑、SQLite 数据库及文件存储）

---

## 首次部署

请严格按以下步骤顺序操作。

### 步骤 1：Fork 仓库

1. 访问 EdgeEver 官方仓库：`https://github.com/tianma-if/edgeever`。
2. 点击右上角 **Fork** 按钮，将仓库 Fork 到您的个人 GitHub 账户下。

---

### 步骤 2：在 Cloudflare 创建存储与数据库资源

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)；入口变化时参考官方的 [D1](https://developers.cloudflare.com/d1/get-started/) 和 [R2](https://developers.cloudflare.com/r2/get-started/) 指南：

1. **创建 D1 数据库**：
   - 在 **Storage & databases** 中打开 **D1 SQL Database**，点击 **Create database**。
   - 数据库名称严格填入：`edgeever`，点击 **Create**。
2. **创建 R2 存储桶**（用于存储笔记附件与图片）：
   - 在 **Storage & databases** 中打开 **R2** -> **Overview**。如尚未开通 R2，先按页面提示完成订阅；然后点击 **Create bucket**。
   - 存储桶名称严格填入：`edgeever-resources`，点击 **Create bucket**。

---

### 步骤 3：创建 Worker

1. 打开 **Workers & Pages** → **Create application** → **Start with Hello World!**，将 Worker 名称严格设为 `edgeever` 并点击 **Deploy**。

---

### 步骤 4：设置管理员密码

1. 进入该 Worker 的 **Settings** → **Variables and Secrets**，点击 **Add**，添加下列运行时 Secret，再点击 **Deploy**：

| 类型 (Type) | 名称 (Name) | 值 (Value) | 说明 |
| :--- | :--- | :--- | :--- |
| **Secret** | `EDGE_EVER_AUTH_PASSWORD` | 建议至少 32 个字符的强密码 | 管理员登录密码 |

`EDGE_EVER_AUTH_PASSWORD` 是变量名，值是管理员登录密码。它属于 Worker 运行时 Secret，不是 Workers Builds 构建变量。

确认 Secret 名称已出现在列表中，再继续下一步。此时 Worker 显示 Hello World 占位页面，仓库构建完成后才会替换为 EdgeEver；不要在占位页面输入密码。

---

### 步骤 5：连接 Fork

1. 在**已有的** `edgeever` Worker 中打开 **Settings** → **Builds** → **Connect**，授权 GitHub 访问您的 Fork，并选中该仓库。入口变化时参考 [Cloudflare 连接已有 Worker 的步骤](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker)。
2. 配置 Workers Builds：
   - **Production branch**：`main`
   - **Root directory**：保持留空，使用仓库根目录
   - Deploy command: npx wrangler deploy（保留默认值，由 Cloudflare 在线执行）

Worker 名称必须与仓库 `wrangler.toml` 中的 `edgeever` 一致。部署命令会自动生成 `DB` 与 `RESOURCES` binding，并查询 D1 UUID。不要修改 Fork 中的文件，也不要在控制台重复添加 binding。

---

### 步骤 6：配置部署权限

**API token**：选择或创建限定到目标账户、具备 D1 读取与编辑权限的 User API Token；选择 **Create new token** 时，Cloudflare 会自动生成部署 Token，但默认权限可能不含 D1。可到[个人资料 → API Tokens](https://dash.cloudflare.com/profile/api-tokens) 编辑该 Token，为目标账户补充 D1 权限，再在 Worker 的 **Settings → Builds → API token** 中选用；保留其原有部署权限。在该 Worker 的 **Settings → Builds → API token** 中选用该 Token 并保存构建设置。后续 Cloudflare Workers Builds 会使用它执行数据库迁移和 Worker 部署。

---

### 步骤 7：构建并验证登录

管理员用户名默认为 `admin`。如需自定义，请在启动首次构建前设置 Workers Builds 构建变量 `EDGE_EVER_AUTH_USERNAME`。

在 Fork 的 GitHub 仓库中进入 **Actions → Update deployed EdgeEver**，按提示启用工作流，选择 `main` 分支并点击 **Run workflow**。该工作流会重新发布所选上游版本，即使 Fork 已对齐也会触发新的部署事件。返回 Cloudflare 的 **Deployments** 查看对应构建。确认构建成功、部署完成后，再进行以下验证：

1. 打开 Cloudflare 为该 Worker 分配的二级域名（如 `https://edgeever.your-subdomain.workers.dev`）。您也可以在 Worker 的 **Settings → Domains & Routes** 中绑定自己的自定义域名（强烈建议绑定自定义域名以保障国内直连稳定性并提升访问速度）。
2. 在浏览器打开该域名下的健康检查接口：`https://你的域名/api/health`，确认返回 `200` 及 JSON：
   ```json
   { "ok": true }
   ```
3. 打开主站首页，输入您配置的管理员用户名（默认是 `admin`）和密码（`EDGE_EVER_AUTH_PASSWORD`）测试登录并开始使用。


后续由该工作流自动同步正式版本，持续获得功能更新和问题修复。

---

## 高级配置：更新通道设置

默认情况下，**Update deployed EdgeEver** 跟随官方正式 Release（稳定版）。若希望跟随上游 `main`（Edge 预览版），请在 Fork 仓库设置 **GitHub Repository Variable**（**Settings → Secrets and variables → Actions → Variables**）：

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

手动运行工作流时也可以直接选择 `stable` / `edge`。

## 高级配置：实例参数

自定义实例时，在 Worker 的 **Settings → Build → Build variables and secrets** 中添加非敏感构建变量：

| 构建变量 | 用途 |
| :--- | :--- |
| `EDGE_EVER_AUTH_USERNAME` | 管理员用户名，默认为 `admin` |
| `EDGE_EVER_WORKER_NAME` | Worker 名称 |
| `EDGE_EVER_D1_DATABASE_NAME` | D1 数据库名称，UUID 会自动查询 |
| `EDGE_EVER_D1_DATABASE_ID` | 自动查询不可用时的可选 UUID 兜底值 |
| `EDGE_EVER_R2_BUCKET_NAME` | 可选的生产 R2 存储桶显式覆盖；升级时默认沿用线上 binding |
| `EDGE_EVER_R2_PREVIEW_BUCKET_NAME` | 预览环境 R2 存储桶名称 |
| `EDGE_EVER_WORKERS_DEV` | 启用或禁用 `workers.dev` 路由 |
| `EDGE_EVER_CUSTOM_DOMAIN` / `EDGE_EVER_ROUTE_PATTERN` | 自定义路由 |

自定义管理员用户名须在启动首次构建前设置；账号创建后修改该变量不会重命名账号。

旧部署的自定义 R2 存储桶无需迁移；不设置覆盖变量时，升级会沿用线上 `RESOURCES` binding。已有项目的显式构建命令也可继续使用，详见 [Workers Builds 配置](cloudflare-workers-builds.zh-CN.md)。

---

## 常见问题与排错

- **缺少管理员 Secret**：在连接 Fork 的同一个 Worker 中，按步骤 4 添加并部署运行时 Secret，再重试失败的构建；缺少配置不是首次部署的必经步骤。
- **仍显示 Hello World**：创建 Worker、部署 Secret 都不代表 EdgeEver 已部署。请完成步骤 7，并确认成功的生产构建对应 Fork 的 `main` commit。
- **首次构建失败**：请检查 Cloudflare 控制台中 Worker 的 **Deployments** 构建日志，确认日志包含“routing it through EdgeEver's validated deployment pipeline”，标准资源名称严格为 `edgeever` 与 `edgeever-resources`，并确认 Workers Builds API Token 具有 D1 读取和编辑权限。如有意使用其他 D1 数据库，请设置 `EDGE_EVER_D1_DATABASE_NAME`；仅在自动查询 UUID 不可用时再添加 `EDGE_EVER_D1_DATABASE_ID`。
- **无法同步上游更新**：
  1. 打开 Fork 的 **Actions**，启用 **Update deployed EdgeEver**（公共 Fork 上定时任务默认关闭）。
  2. 手动 **Run workflow** 一次，打开中英双语 Job **Summary**：会分别展示上游目标、Git 发布结果、部署触发状态，以及线上部署是否已经验证。
  3. 若定时运行绿色成功且 Summary 为 *Already on upstream target* / 已对齐，表示 Git 已是该通道目标版本，不是静默故障。手动运行在已对齐时会自动重新发布所选版本；若此后网站仍旧，请对照 Cloudflare **Deployments** 的 commit SHA。
  4. 日常升级请优先用本工作流，而不是 GitHub **Sync fork**。
  5. 若旧版更新器报错 `without workflows permission`，请使用仓库所有者身份执行一次 **Sync fork**，然后重新运行 **Update deployed EdgeEver**。新版更新器会保留 `.github/workflows/**`，后续产品更新不会再触发这项权限限制。
- **Git 已 push 但网站没变**：确认 Workers Builds 是否针对新的 `main` SHA 构建。可选：添加仓库 Secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL`，让工作流在 publish 后调用 Deploy Hook。
- **Android 或 iOS App 提示登录被 Cloudflare 或安全策略拦截**：
  1. 重试一次并记录 App 显示的诊断代码、Ray ID 和大致时间。在 Cloudflare 中打开 **Security → Analytics → Events**，找到对应请求并确认其 **Service**、**Action** 和规则 ID，再决定调整哪项防护。
  2. 原生 App 会直接调用 `/api/*`，无法完成交互式浏览器验证。不要尝试在 App 中嵌入该验证。请继续启用 EdgeEver 身份认证及应用层登录限流，但要确保合法 API 流量收到机器可解析的响应，而不是 Managed Challenge 或 Interactive Challenge。
  3. 如果是自定义 WAF 规则发起验证，请缩小规则范围，不要验证 App 所需的 `/api/*` 请求。如果是 Managed Rules 或 Super Bot Fight Mode 误判，请创建范围尽可能小的 [Skip 规则或例外](https://developers.cloudflare.com/waf/custom-rules/skip/)，不要笼统关闭无关的安全防护。
  4. Cloudflare 免费版 Bot Fight Mode 无法通过 WAF Skip 规则绕过。如果 Security Events 显示由 Bot Fight Mode 拦截，请按 Cloudflare 的[误报处理指引](https://developers.cloudflare.com/bots/troubleshooting/false-positives/)关闭该功能，或改用支持精确例外的防护模式。
- **需要重置或手动恢复部署**：请参阅 [手动部署指南](manual-deploy.zh-CN.md)。
