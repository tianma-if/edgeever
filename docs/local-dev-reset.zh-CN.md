# 将本地 DEV 恢复为干净的 Demo 数据

在仓库目录执行：

```sh
bun run dev:reset
```

命令会将 `.wrangler/state` 中的笔记、笔记本、附件、修订历史、搜索文档和 API 令牌替换为仓库当前版本的标准 Demo 种子数据，保留账号、登录会话和 AI 服务商／模型配置。完成后刷新 Web 页面；工作区同步标识会变化，使客户端重新加载干净快照。原有 API 令牌需要重新创建。

本地 DEV 正在运行或已经停止时均可执行。服务停止时，使用 `bun run dev` 启动 Web 与 API。命令不会将 DEV 切换为免认证 Demo 模式、修改 `.env.local`、执行部署或重置公开 Demo。默认不自动备份；有重要笔记时请先导出。重置期间不要编辑笔记或运行写入测试。

脚本直接使用 Wrangler 的本地 D1/R2 绑定，不开放服务端口。目标固定为当前仓库的 `.wrangler/state`，拒绝额外参数、远程绑定、带符号链接的数据目录和外部对象存储配置。写入前核对数据库身份，完成后核对笔记／笔记本 ID 与种子是否完全一致。沿用现有 Demo 重置锁及冷却时间；提示等待时，冷却结束后重跑。中断后先修复报错再重跑；仅在确认没有重置进程后，才可删除 `.wrangler/local-demo-reset.lock`。

`bun run dev:demo:reset` 继续用于独立的本地 Demo 环境。`bun run demo:sync` 会部署并重置**公开** Demo，不能替代本命令。

回归检查：

```sh
bun test scripts/reset-local-demo.test.mjs scripts/local-dev.test.mjs
```
