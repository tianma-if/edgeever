# Cloudflare Workers Builds

## 配置

首次部署时，先通过 **Start with Hello World!** 创建 `edgeever` Worker，添加并部署运行时 Secret `EDGE_EVER_AUTH_PASSWORD`，再从已有 Worker 的 **Settings → Builds → Connect** 连接 Fork。按[在线部署文档](deploy-cloudflare-button.zh-CN.md)选择仓库根目录和 `main` 分支，保留默认部署命令 `npx wrangler deploy`。已有项目可继续使用原来的显式构建命令和 `bun run deploy:cloudflare-builds`。

授权：

1. 为部署仓库授权 **Cloudflare Workers & Pages** GitHub App。
2. 如果 Agent 集成需要 Cloudflare API Token，使用限制到目标账号的 User API Token。
3. 部署 API Token 在 Cloudflare **Worker -> Settings -> Build -> API token** 中配置。默认自动生成的 token 可能没有 D1 权限；部署前应确认其具备目标账户的 D1 读取与编辑权限。在该 Worker 的 **Settings → Builds → API token** 中选用该 Token 并保存构建设置。后续 Cloudflare Workers Builds 会使用它执行数据库迁移和 Worker 部署。

在 Worker 的 **Settings → Variables and Secrets** 中设置运行时 Secret `EDGE_EVER_AUTH_PASSWORD`，不要放入 Builds 构建变量。

普通部署使用 D1 `edgeever`、R2 `edgeever-resources` 和用户名 `admin`。可选的非敏感实例参数放在 **Settings → Build → Build variables and secrets**；这些变量仅供构建使用，部署命令会据此生成临时 Wrangler 配置。不要修改仓库中的 `wrangler.toml`。

未显式覆盖时，旧部署会保留当前的 R2 存储桶和管理员用户名。

## 更新与排错

- `main` 推送会自动构建、执行 D1 migration、部署并验证。
- **Update deployed EdgeEver** 把部署用 Fork 当作上游的 **部署镜像** 来维护：
  - 默认 `stable` 通道跟随最新正式 Release tag。
  - 设置 GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` 后跟随上游 `main`。
  - 只读 Fork（未改应用代码）会用一个新的线性提交应用目标版本的产品代码快照，不安装依赖，也不执行项目测试套件。
  - 只有显式设置 `EDGE_EVER_PRESERVE_FORK_CHANGES=true` 的 Fork 才会合并产品代码。定制合并会在 push 前执行本地 migration、完整非 E2E 测试、类型检查和生产构建；任一步失败都会保持 `main` 与线上版本不变。
  - 更新会保留 Fork 中的 `.github/workflows/**` 和更新辅助脚本，无需授予 `GITHUB_TOKEN` 改写工作流的权限。
  - Job **Summary** 会显示 Git 和部署状态。*Already on upstream target* / 已对齐表示定时运行未请求部署；push 成功后仍需在 Cloudflare 中确认部署。
  - 请优先用本工作流，而不是 GitHub **Sync fork**。Sync fork 跟的是上游 `main` 历史，可能让下一次 stable 运行合理变为 no-op。
- 可选：仓库 Secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL`，在成功 push 后触发 Cloudflare Deploy Hook（Git 集成偶发未构建时有用）。
- 手动运行工作流会重新触发 Cloudflare 构建，即使 Git 已是最新。
- 构建失败：查看 Worker **Deployments** 日志，确认部署 commit SHA 与 Fork `main` 一致。
- 定时任务从不运行：公共 Fork 需在 **Actions** 中启用 **Update deployed EdgeEver**（Fork 上 schedule 默认禁用，长期不活跃也可能被暂停）。
- 更新 push 被 `without workflows permission` 拒绝：说明 Fork 仍在使用旧版更新器。请用仓库所有者权限执行一次 GitHub **Sync fork**，再重新运行 **Update deployed EdgeEver**；完成这次引导后，日常产品更新不再需要 **Sync fork**。
