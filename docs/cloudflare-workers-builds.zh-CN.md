# Cloudflare Workers Builds

## 配置

使用[在线部署文档](deploy-cloudflare-button.zh-CN.md)中的构建命令和部署命令，仓库根目录为 `/`，生产分支为 `main`。

授权：

1. 为部署仓库授权 **Cloudflare Workers & Pages** GitHub App。
2. 如果 Agent 集成需要 Cloudflare API Token，使用限制到目标账号的 User API Token。
3. 部署 API Token 在 Cloudflare **Worker -> Settings -> Builds -> API token** 中配置。

`EDGE_EVER_AUTH_PASSWORD` 应配置在 Worker 的 **Settings -> Variables and Secrets** 中，作为运行时 Secret；不要把密码复制到 Builds 的构建变量。`deploy:cloudflare-builds` 会复用该 Secret，并在部署后验证它是否存在。

## 更新与排错

- `main` 推送会自动构建、执行 D1 migration、部署并验证。
- **Update deployed EdgeEver** 把部署用 Fork 当作上游的 **部署镜像** 来维护：
  - 默认 `stable` 通道跟随最新正式 Release tag。
  - 设置 GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` 后跟随上游 `main`。
  - 只读 Fork（未改应用代码）会用一个新的线性提交应用目标版本的产品代码快照，不安装依赖，也不执行项目测试套件。
  - 只有显式设置 `EDGE_EVER_PRESERVE_FORK_CHANGES=true` 的 Fork 才会合并产品代码。定制合并会在 push 前执行本地 migration、完整非 E2E 测试、类型检查和生产构建；任一步失败都会保持 `main` 与线上版本不变。
  - 正式 Release 会在准备 Draft 资产前，由官方 Ubuntu Job 执行同一套完整非 E2E 测试，确保 stable 通道的上游基线本身为绿色；定制 Fork 若失败，应代表合并集成问题，而不是 Release 自带的测试已经失败。
  - 下游完整的 `.github/workflows/**` 目录和两个更新辅助脚本会作为稳定的本地引导层原样保留。官方打包、签名、测试与 Release 工作流不参与产品代码自动更新，因此 `GITHUB_TOKEN` 无需取得改写 Actions 工作流的权限。
  - 每次运行都会写 Job **Summary**：通道、目标版本、判定原因、是否 push。若 Summary 写明 *Already on upstream target* / 已对齐，绿色成功表示「已是目标版本」，不是静默故障。
  - 请优先用本工作流，而不是 GitHub **Sync fork**。Sync fork 跟的是上游 `main` 历史，可能让下一次 stable 运行合理变为 no-op。
- 可选：仓库 Secret `EDGE_EVER_CLOUDFLARE_DEPLOY_HOOK_URL`，在成功 push 后触发 Cloudflare Deploy Hook（Git 集成偶发未构建时有用）。
- 可选：Git 已是最新但 Cloudflare 需要再构建时，手动运行工作流并勾选 **force_redeploy**（会推送空 commit）。
- 构建失败：查看 Worker **Deployments** 日志，确认部署 commit SHA 与 Fork `main` 一致。
- 定时任务从不运行：公共 Fork 需在 **Actions** 中启用 **Update deployed EdgeEver**（Fork 上 schedule 默认禁用，长期不活跃也可能被暂停）。
- 更新 push 被 `without workflows permission` 拒绝：说明 Fork 仍在使用旧版更新器。请用仓库所有者权限执行一次 GitHub **Sync fork**，再重新运行 **Update deployed EdgeEver**；完成这次引导后，日常产品更新不再需要 **Sync fork**。
