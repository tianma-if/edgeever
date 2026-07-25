# Cloudflare Workers Builds

## 配置

使用[在线部署文档](deploy-cloudflare-button.zh-CN.md)中的构建命令和部署命令，仓库根目录为 `/`，生产分支为 `main`。

授权：

1. 为部署仓库授权 **Cloudflare Workers & Pages** GitHub App。
2. 如果 Agent 集成需要 Cloudflare API Token，使用限制到目标账号的 User API Token。
3. 部署 API Token 在 Cloudflare **Worker -> Settings -> Builds -> API token** 中配置。

## 更新与排错

- `main` 推送会自动构建、执行 D1 migration、部署并验证。
- **Update deployed EdgeEver** 工作流每天检查上游正式 Release。
- 设置 GitHub Repository Variable `EDGE_EVER_UPDATE_CHANNEL=edge` 后跟随上游 `main`。
- 构建失败：查看 Worker 的 **Deployments** 日志。
- 定时更新失败：在 Fork 的 **Actions** 中启用并手动运行工作流。

旧的 Cloudflare 创建仓库如果只有 `source repo import` 提交，第一次更新会自动建立上游历史。已经修改过应用代码的仓库不要直接使用该初始化流程。
