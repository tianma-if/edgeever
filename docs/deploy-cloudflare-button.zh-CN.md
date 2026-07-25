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
   - 数据库名称填入：`edgeever`，点击 **Create**。
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
| **Environment Variable (Secret)** | `EDGE_EVER_AUTH_PASSWORD` | 设置您的管理员登录密码 | 初始登录凭据 |

---

### 步骤 4：设置构建命令并启动构建

在 Cloudflare 项目的 **Build settings**（构建设置）中配置：

```text
Build command:  bun install --frozen-lockfile && EDGE_EVER_DEPLOYMENT_TRIGGER=main_push EDGE_EVER_DEPLOYMENT_METHOD=cloudflare_workers_builds bun run build:cloudflare
Deploy command: bun run deploy:cloudflare-builds
```

点击 **Save and Deploy** 启动首次构建部署。

---

### 步骤 5：验证部署与登录

1. 构建完成后，Cloudflare 会为您生成一个二级域名（如 `https://edgeever.your-subdomain.workers.dev`）。
2. 在浏览器打开该域名下的健康检查接口：`https://你的域名/api/health`，确认返回 `200` 及 JSON：
   ```json
   { "ok": true }
   ```
3. 打开主站首页，输入您配置的密码（`EDGE_EVER_AUTH_PASSWORD`）测试登录并开始使用。
4. 返回 Fork 的 GitHub 仓库 **Actions** 页面，手动触发运行一次 **Update deployed EdgeEver** 工作流，确保未来可自动跟进上游更新。

---

## 高级配置：更新通道设置

部署默认自动跟随官方正式 Releases（稳定版）。若希望跟进最前沿的 `main` 分支（Edge 预览版），可前往 Cloudflare 的 **Settings** -> **Variables and Bindings** 添加如下环境变量：

```text
EDGE_EVER_UPDATE_CHANNEL=edge
```

---

## 常见问题与排错

- **首次构建失败**：请检查 Cloudflare 控制台中 Worker 的 **Deployments** 构建日志，确认 D1 (`DB`) 和 R2 (`RESOURCES`) Binding 名称大小写是否正确。
- **无法同步上游更新**：打开您 Fork 仓库的 **Actions** 标签页，确认 **Update deployed EdgeEver** 工作流是否处于已启用状态，并尝试手动点击 **Run workflow**。
- **需要重置或手动恢复部署**：请参阅 [手动部署指南](manual-deploy.zh-CN.md)。
