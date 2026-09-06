# EdgeEver 手动在线部署指南

本文档为在线部署 EdgeEver 的详细图文操作指南。整个部署流程在浏览器中即可完成，**不需要本地安装任何代码或配置本地环境**。

> 💡 **零成本自托管**：部署完全使用 Cloudflare 免费配额，**无需购买 VPS / 云服务器，也不需要折腾域名证书或 Docker**。

---

## 前置准备

- **GitHub 账户**（用于 Fork 仓库及配置自动更新）
- **Cloudflare 账户**（用于托管 Worker 逻辑、SQLite 数据库及文件存储）

---

## 首次部署图文指南

### 步骤 1：Fork 仓库

1. 访问 EdgeEver 官方仓库：`https://github.com/tianma-if/edgeever`。
2. 点击右上角 **Fork** 按钮，将仓库 Fork 到您的个人 GitHub 账户下。

---

### 步骤 2：在 Cloudflare 创建存储与数据库资源

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) 控制台：

1. **创建 D1 数据库**：
   - 导航至 **Workers & Pages** -> **D1**，点击 **Create database**。
   - 数据库名称严格填入：`edgeever`，点击 **Create**。
2. **创建 R2 存储桶**（用于存储笔记附件与图片）：
   - 导航至 **Workers & Pages** -> **R2**，点击 **Create bucket**。
   - 存储桶名称严格填入：`edgeever-resources`，点击 **Create bucket**。

---

### 步骤 3：导入项目

1. 在 Cloudflare 控制台中，进入 **Workers & Pages** -> **Overview**，点击 **Create application** -> **Pages** / **Workers** (选择导入 Git 仓库)。
2. 选择 **Connect to Git**，授权并选中您刚才 Fork 的 `edgeever` 仓库。
3. 在项目设置中：
   - **Production branch**：选择 `main`
   - **Root directory**：保持留空或默认 `/`

仓库中的部署命令会根据标准资源名称生成 `DB` 与 `RESOURCES` binding。不要修改 `wrangler.toml`，也不要在控制台中重复添加 binding。

按旧版文档创建过自定义 R2 存储桶的已有部署，不需要改名或迁移数据。未显式设置 Builds 变量时，部署命令会读取线上 Worker 当前的 `RESOURCES` binding，并自动继续使用原存储桶。

---

### 步骤 4：设置管理员密码

在 Worker 的 **Settings** -> **Variables and Secrets** 中添加以下 Secret：

| 类型 (Type) | 名称 (Name) | 值 (Value) | 说明 |
| :--- | :--- | :--- | :--- |
| **Secret** | `EDGE_EVER_AUTH_PASSWORD` | 建议至少 32 个字符且仅用于此实例的强密码 | 管理员登录密码 |

`EDGE_EVER_AUTH_PASSWORD` 是变量名，Secret 的值才是您自行设置的管理员登录密码。它属于 Worker 运行时 Secret，不是 Workers Builds 构建变量；无需、也不应把密码重复填写到构建变量中。

---

### 步骤 5：启动构建

保留 Cloudflare 自动填写的默认部署命令：

```text
Deploy command: npx wrangler deploy
```

点击 **Save and Deploy** 启动首次构建部署。仓库提供的 Wrangler 兼容入口会识别 Workers Builds，并自动将默认命令接入 EdgeEver 的完整构建、数据库迁移、部署及线上验证流水线。因此无需复制自定义命令，也不会把 `wrangler.toml` 中的 D1 占位符提交给 Cloudflare。

部署流水线会根据 `edgeever` 数据库名称自动查询 D1 UUID。受版本控制的 `wrangler.toml` 必须保持不变；若把实例专属配置提交到该文件，部署会直接拒绝。Workers Builds API Token 必须具有 D1 读取和编辑权限。

已有项目继续使用下列显式命令也受支持，无需修改：

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

发布完成后，CI 部署会记录 Wrangler 返回的实际公网入口，并请求该入口的 `/api/health`。如果线上 Worker 缺少 `DB` 或 `RESOURCES` binding、绑定了未初始化的 D1，或没有返回健康状态，构建会直接失败。

---

### 步骤 6：验证部署、登录与自动更新

1. 构建完成后，Cloudflare 会为您生成一个二级域名（如 `https://edgeever.your-subdomain.workers.dev`）。
2. 在浏览器打开该域名下的健康检查接口：`https://你的域名/api/health`，确认返回 `200` 及 JSON：
   ```json
   { "ok": true }
   ```
3. 打开主站首页，输入您配置的管理员用户名（默认是 `admin`）和密码（`EDGE_EVER_AUTH_PASSWORD`）测试登录并开始使用。
4. 返回 Fork 的 GitHub 仓库 **Actions** 页面，点击 **I understand my workflows, go ahead and enable them** 启用工作流。
5. 手动运行一次 **Update deployed EdgeEver**，确保未来可自动跟进上游更新，并确认 Cloudflare 收到这次构建事件。

---

## 高级配置：更新通道设置

默认情况下，**Update deployed EdgeEver** 跟随官方正式 Release（稳定版）。若希望跟随上游 `main`（Edge 预览版），请在 Fork 仓库设置 **GitHub Repository Variable**（**Settings → Secrets and variables → Actions → Variables**）：

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

手动运行工作流时也可以直接选择 `stable` / `edge`。

## 高级配置：实例参数

普通部署不需要配置以下参数。如需自定义实例，请在 **Settings -> Builds -> Variables and secrets** 中添加非敏感构建变量，不要修改仓库文件：

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

如需自定义初始管理员用户名，请在首次构建前设置 `EDGE_EVER_AUTH_USERNAME`。普通部署无需配置，直接使用默认用户名 `admin` 即可；管理员账号已创建后，仅修改该变量不会重命名现有账号。

密码及其他凭据始终属于 Worker 运行时 Secret，绝不能放入 Builds 构建变量。高级本地部署也可以使用被 Git 忽略的 `.env.local`，或仓库外部的 `WRANGLER_CONFIG` 文件。

---

## 常见问题与排错

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
