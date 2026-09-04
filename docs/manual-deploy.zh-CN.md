# Cloudflare 手动部署与恢复

本页只用于高级配置、故障排查和紧急恢复。普通用户请使用[从 Fork 在线部署](deploy-cloudflare-button.zh-CN.md)，AI Agent 请使用[AI Agent 在线部署](agent-deploy-cloudflare.zh-CN.md)。

## 首次手动部署

1. Fork 仓库并克隆到本地。
2. 安装 Node.js 22+ 和 Bun。
3. 初始化配置和 Cloudflare 资源：

   ```sh
   cp .env.local.example .env.local
   bun install
   EDGE_EVER_PASSWORD='<首次登录密码>' bun run deploy:setup
   bun run deploy:doctor
   bun run deploy:manual
   ```

`deploy:setup` 会创建或复用 D1、R2，并将配置写入被 Git 忽略的 `.env.local`。新部署必须提供 `EDGE_EVER_PASSWORD`，生产环境不存在默认密码。

使用本地 CLI 部署时，可在 `.env.local` 中设置 `EDGE_EVER_DEPLOYMENT_URL=https://<你的 Worker 域名>`，让部署验证同时请求线上的 `/api/health`；CI 部署会自动从 Wrangler 输出中识别公网地址。未显式配置地址时，本地验证仍会检查远端 D1 schema 和 Worker Secret，并明确提示已跳过线上健康检查。

部署完成后，确认：

- `/api/health` 返回 `200` 和 `"ok": true`
- `/api/openapi.json` 可以访问
- `admin` 可以使用通过 `EDGE_EVER_PASSWORD` 提供的密码登录

## 手动创建资源

```sh
cp .env.local.example .env.local
bun install
bunx wrangler d1 create edgeever
bunx wrangler r2 bucket create edgeever-resources
```

将返回的 D1 ID 和资源名称写入 `.env.local`：

```text
EDGE_EVER_D1_DATABASE_ID=<database_id>
EDGE_EVER_R2_BUCKET_NAME=edgeever-resources
EDGE_EVER_AUTH_USERNAME=admin
EDGE_EVER_AUTH_PASSWORD=<强密码>
EDGE_EVER_SESSION_TTL_DAYS=400
# 可选的应用层登录防护参数；同样适用于 Docker + SQLite。
EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS=900
EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS=5
EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS=900
EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS=30
EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS=300
```

然后运行：

```sh
bun run deploy:doctor
bun run deploy:manual
```

不要提交 `.env.local`，也不要把密码写入 D1。

## 启用第三方 OSS 设置

在**设置 → 高级设置**中配置兼容 S3 API 的对象存储，并在保存前使用“测试连接”。
EdgeEver 会使用从现有实例认证 Secret 派生的专用密钥加密外部 Secret Access Key，
再将其保存到 D1，无需增加其他加密变量。请保持实例认证 Secret 稳定并安全备份；
丢失或更换它会导致已保存的外部凭据无法使用。

## 故障恢复

- 数据库未就绪：确认 D1 binding 为 `DB`，然后运行 `bun run deploy:manual`。
- 鉴权未配置：在 `.env.local` 设置 `EDGE_EVER_AUTH_PASSWORD`，然后重新部署。
- 忘记管理员密码：

  ```sh
  EDGE_EVER_PASSWORD='<新密码>' bun run auth:reset-password -- --remote --username admin
  ```

## 自动更新

手动部署完成后，按 [Cloudflare Workers Builds](cloudflare-workers-builds.zh-CN.md) 配置自动部署，并在 Fork 的 **Actions** 中启用 **Update deployed EdgeEver**。
