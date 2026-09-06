# Cloudflare Workers Builds

## 配置

手动导入仓库时，按[在线部署文档](deploy-cloudflare-button.zh-CN.md)保留 Cloudflare 默认的 `npx wrangler deploy` 命令，仓库根目录为 `/`，生产分支为 `main`。仓库提供的 Wrangler 兼容入口会把该默认命令接入 EdgeEver 的完整部署流水线。已有项目继续使用显式构建命令与 `bun run deploy:cloudflare-builds` 也受支持。

授权：

1. 为部署仓库授权 **Cloudflare Workers & Pages** GitHub App。
2. 如果 Agent 集成需要 Cloudflare API Token，使用限制到目标账号的 User API Token。
3. 部署 API Token 在 Cloudflare **Worker -> Settings -> Builds -> API token** 中配置。

`EDGE_EVER_AUTH_PASSWORD` 应配置在 Worker 的 **Settings -> Variables and Secrets** 中，作为运行时 Secret；不要把密码复制到 Builds 的构建变量。`deploy:cloudflare-builds` 会复用该 Secret，并在部署后验证它是否存在。

受版本控制的 `wrangler.toml` 必须保持不变。普通部署使用 D1 `edgeever`、R2 `edgeever-resources` 和用户名 `admin`。`EDGE_EVER_AUTH_USERNAME`、`EDGE_EVER_WORKER_NAME`、`EDGE_EVER_D1_DATABASE_NAME`、`EDGE_EVER_R2_BUCKET_NAME` 与自定义路由等可选非敏感实例参数，应放在 **Settings -> Builds -> Variables and secrets**。Workers Builds 变量只对构建命令可见，不会直接成为 Worker 运行时变量；部署命令会用它们生成临时 Wrangler 配置。密码及其他凭据始终属于运行时 Secret。

旧版兼容会自动完成：未显式设置 R2 或用户名 Builds 变量时，升级会检查正在承载生产流量的 Worker 版本，并保留其已有的 `RESOURCES` 存储桶和管理员用户名；全新 Worker 才使用标准默认值。

## 更新与排错

- `main` 推送会自动构建、执行 D1 migration、部署并验证。
- **Update deployed EdgeEver** 把部署用 Fork 当作上游的 **部署镜像** 来维护：
  - 默认 `stable` 通道跟随最新正式 Release tag。
  - 设置 GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` 后跟随上游 `main`。
  - 只读 Fork（未改应用代码）会用一个新的线性提交应用目标版本的产品代码快照，不安装依赖，也不执行项目测试套件。
  - 只有显式设置 `EDGE_EVER_PRESERVE_FORK_CHANGES=true` 的 Fork 才会合并产品代码。定制合并会在 push 前执行本地 migration、完整非 E2E 测试、类型检查和生产构建；任一步失败都会保持 `main` 与线上版本不变。
  - 正式 Release 会在准备 Draft 资产前，由官方 Ubuntu Job 执行同一套完整非 E2E 测试，确保 stable 通道的上游基线本身为绿色；定制 Fork 若失败，应代表合并集成问题，而不是 Release 自带的测试已经失败。
  - 下游完整的 `.github/workflows/**` 目录和两个更新辅助脚本会作为稳定的本地引导层原样保留。官方打包、签名、测试与 Release 工作流不参与产品代码自动更新，因此 `GITHUB_TOKEN` 无需取得改写 Actions 工作流的权限。
  - 每次运行都会写中英双语 Job **Summary**，分别展示 Fork 的 Git 状态、部署触发状态和线上验证状态。若定时运行绿色成功并写明 *Already on upstream target* / 已对齐，表示本次未请求部署；push 成功只表示已请求部署，仍需在 Cloudflare 中确认。
  - 请优先用本工作流，而不是 GitHub **Sync fork**。Sync fork 跟的是上游 `main` 历史，可能让下一次 stable 运行合理变为 no-op。
- 可选：仓库 Secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL`，在成功 push 后触发 Cloudflare Deploy Hook（Git 集成偶发未构建时有用）。
- 手动运行工作流时，即使 Git 已是最新，也会推送空 commit 重新触发 Cloudflare 构建；定时检查在已对齐时仍保持 no-op。
- 构建失败：查看 Worker **Deployments** 日志，确认部署 commit SHA 与 Fork `main` 一致。
- 定时任务从不运行：公共 Fork 需在 **Actions** 中启用 **Update deployed EdgeEver**（Fork 上 schedule 默认禁用，长期不活跃也可能被暂停）。
- 更新 push 被 `without workflows permission` 拒绝：说明 Fork 仍在使用旧版更新器。请用仓库所有者权限执行一次 GitHub **Sync fork**，再重新运行 **Update deployed EdgeEver**；完成这次引导后，日常产品更新不再需要 **Sync fork**。
