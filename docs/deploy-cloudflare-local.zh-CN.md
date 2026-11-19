# 本地 Cloudflare 部署的认证配置

常规部署命令保留已有 Worker 的认证 Secret 和会话期限。`.env.local` 中残留的值（包括实例专属配置）不会替换它们。即使本地 R2 和用户名配置齐全，部署入口也会检查线上活跃版本；读取失败或线上配置冲突时，在上传前停止。

首次部署新 Worker 或尚未配置认证的占位 Worker 仍可使用初始凭据。手动部署的 doctor 检查接受已有运行时 Secret，无需在本地保存密码。线上未设置会话期限时保持未设置，不引入本地值。

有意修改时分别使用命令行参数，从所选实例的配置中读取替换值：

- Secret：`EDGE_EVER_INSTANCE=<实例名> bun run deploy:worker --update-auth-secret`。
- 会话期限：`EDGE_EVER_INSTANCE=<实例名> bun run deploy:worker --update-session-ttl`。

已部署的密码哈希优先于明文密码：替换已有哈希时须提供 `EDGE_EVER_AUTH_PASSWORD_HASH` 或实例专属的对应配置。向已有认证的 Worker 提供 `--secrets-file` 也须带 `--update-auth-secret`。不得将替换参数加入常规部署命令。

`EDGE_EVER_INSTANCE=<实例名> bun run deploy:worker --dry-run` 验证生成的部署内容而不上传。即使显式传入替换参数，dry-run 结束后也不会另行执行 `secret put`。
