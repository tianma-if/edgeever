# EdgeEver 手动在线部署指南

本文档为在线部署 EdgeEver 的详细图文操作指南。整个部署流程在浏览器中即可完成，**不需要本地安装任何代码或配置本地环境**。

> 💡 **零成本自托管**：部署完全使用 Cloudflare 免费配额，**无需购买 VPS / 云服务器，也不需要折腾域名证书或 Docker**。

---

## 前置准备

- **GitHub 账户**（用于 Fork 仓库及配置自动更新）
- **Cloudflare 账户**（用于托管 Worker 逻辑、SQLite 数据库及文件存储）

---

## 首次部署图文指南

### 步骤 1：Fork 仓库并开启 Actions

1. 访问 EdgeEver 官方仓库：`https://github.com/tianma-if/edgeever`。
2. 点击右上角 **Fork** 按钮，将仓库 Fork 到您的个人 GitHub 账户下。
3. 进入您 Fork 后的仓库，切换到 **Actions** 标签页，点击 **"I understand my workflows, go ahead and enable them"** 启用自动化工作流。

---

### 步骤 2：在 Cloudflare 创建存储与数据库资源

登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) 控制台：

1. **创建 D1 数据库**：
   - 导航至 **Workers & Pages** -> **D1**，点击 **Create database**。
   - 数据库名称严格填入：`edgeever`，点击 **Create**。
2. **创建 R2 存储桶**（用于存储笔记附件与图片）：
   - 导航至 **Workers & Pages** -> **R2**，点击 **Create bucket**。
   - 填入自定义存储桶名称（全局唯一，如 `my-edgeever-resources`），点击 **Create bucket**。

---

### 步骤 3：导入项目并配置资源绑定 (Bindings & Secrets)

1. 在 Cloudflare 控制台中，进入 **Workers & Pages** -> **Overview**，点击 **Create application** -> **Pages** / **Workers** (选择导入 Git 仓库)。
2. 选择 **Connect to Git**，授权并选中您刚才 Fork 的 `edgeever` 仓库。
3. 在项目设置中：
   - **Production branch**：选择 `main`
   - **Root directory**：保持留空或默认 `/`
4. **配置环境变量与资源绑定**（在 **Settings** -> **Variables and Bindings**）：

| 类型 (Type) | 名称 (Binding / Variable Name) | 值 / 绑定的资源 (Value / Resource) | 说明 |
| :--- | :--- | :--- | :--- |
| **D1 Database Binding** | `DB` | 选择 `edgeever` 数据库 | 存放笔记与结构化数据 |
| **R2 Bucket Binding** | `RESOURCES` | 选择您创建的 R2 Bucket | 存放图片与图片附件 |
| **Environment Variable** | `EDGE_EVER_AUTH_USERNAME` | `admin`（可改为自定义用户名） | 管理员登录用户名 |
| **Environment Variable (Secret)** | `EDGE_EVER_AUTH_PASSWORD` | 设置您的管理员登录密码 | 初始登录凭据 |

> `EDGE_EVER_AUTH_USERNAME` 默认预填为 `admin`。普通用户可以直接使用这个值；如果希望使用其他管理员用户名，可在这里修改。请记住部署时填写的用户名，登录时需要同时输入用户名和密码。

> `EDGE_EVER_AUTH_PASSWORD` 是 Worker 运行时 Secret，不是 Workers Builds 构建变量。标准部署命令会复用并验证这个 Secret；无需、也不应把密码重复填写到构建变量中。

---

### 步骤 4：设置构建命令并启动构建

在 Cloudflare 项目的 **Build settings**（构建设置）中配置：

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

点击 **Save and Deploy** 启动首次构建部署。

部署命令会根据 `edgeever` 数据库名称自动查询 D1 UUID。无需修改 `wrangler.toml`，也无需手工复制 D1 ID。Workers Builds API Token 必须具有 D1 读取和编辑权限。

发布完成后，CI 部署会记录 Wrangler 返回的实际公网入口，并请求该入口的 `/api/health`。如果线上 Worker 缺少 `DB` binding、绑定了未初始化的 D1，或没有返回健康状态，构建会直接失败。

---

### 步骤 5：验证部署与登录

1. 构建完成后，Cloudflare 会为您生成一个二级域名（如 `https://edgeever.your-subdomain.workers.dev`）。
2. 在浏览器打开该域名下的健康检查接口：`https://你的域名/api/health`，确认返回 `200` 及 JSON：
   ```json
   { "ok": true }
   ```
3. 打开主站首页，输入您配置的管理员用户名（默认是 `admin`）和密码（`EDGE_EVER_AUTH_PASSWORD`）测试登录并开始使用。
4. 返回 Fork 的 GitHub 仓库 **Actions** 页面，手动触发运行一次 **Update deployed EdgeEver** 工作流，确保未来可自动跟进上游更新。

---

## 高级配置：更新通道设置

默认情况下，**Update deployed EdgeEver** 跟随官方正式 Release（稳定版）。若希望跟随上游 `main`（Edge 预览版），请在 Fork 仓库设置 **GitHub Repository Variable**（**Settings → Secrets and variables → Actions → Variables**）：

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

手动运行工作流时也可以直接选择 `stable` / `edge`。

---

## 常见问题与排错

- **首次构建失败**：请检查 Cloudflare 控制台中 Worker 的 **Deployments** 构建日志，确认 D1 Binding 为 `DB`、数据库名称严格为 `edgeever`、R2 Binding 为 `RESOURCES`，并确认 Workers Builds API Token 具有 D1 读取和编辑权限。如有意使用其他 D1 数据库，请添加构建变量 `EDGE_EVER_D1_DATABASE_ID` 并填入其 UUID。
- **无法同步上游更新**：
  1. 打开 Fork 的 **Actions**，启用 **Update deployed EdgeEver**（公共 Fork 上定时任务默认关闭）。
  2. 手动 **Run workflow** 一次，打开 Job **Summary**：会写明上游目标版本，以及本次是「已更新」「已对齐」还是失败。
  3. 若绿色成功且 Summary 为 *Already on upstream target* / 已对齐，表示 Git 已是该通道目标版本，不是静默故障。若网站仍旧，请对照 Cloudflare **Deployments** 的 commit SHA，或勾选 **force_redeploy** 再跑一次。
  4. 日常升级请优先用本工作流，而不是 GitHub **Sync fork**。
  5. 若旧版更新器报错 `without workflows permission`，请使用仓库所有者身份执行一次 **Sync fork**，然后重新运行 **Update deployed EdgeEver**。新版更新器会保留 `.github/workflows/**`，后续产品更新不会再触发这项权限限制。
- **Git 已 push 但网站没变**：确认 Workers Builds 是否针对新的 `main` SHA 构建。可选：添加仓库 Secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL`，让工作流在 publish 后调用 Deploy Hook。
- **需要重置或手动恢复部署**：请参阅 [手动部署指南](manual-deploy.zh-CN.md)。
