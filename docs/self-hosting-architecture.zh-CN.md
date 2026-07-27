# 自托管与 Docker 架构预留

EdgeEver 计划支持 VPS、NAS 和家庭服务器上的 Docker 自托管，但当前版本
还没有提供受支持的 Docker 发行版。

## 当前边界

API 的业务逻辑和路由逻辑应依赖
`apps/api/src/storage-contract.ts` 中的存储契约，而不是直接依赖
Cloudflare SDK 类型。目前的具体实现位于
`apps/api/src/cloudflare-storage-adapter.ts`：

- `DatabaseAdapter`：SQL 语句与批处理。
- `BlobStoreAdapter`：附件的 `get`、`put` 和 `delete` 操作。

目前生产环境仍使用 Cloudflare D1 和 R2，现有 Worker 部署方式不变；未来
自托管适配器可以在这个边界上替换，而不需要整体重写业务层。

共享的自托管配置结构也已定义为 `SelfHostedStorageConfig`，包含统一的应用
数据目录、SQLite 数据库文件和附件目录。

PostgreSQL 已通过与驱动无关的 `RelationalDatabaseAdapter` 和
`PostgreSQLStorageConfig` 契约预留为第二种关系数据库后端，但当前尚未实现。
SQLite 仍是自托管默认数据库；未来 PostgreSQL 更适合较大团队、更高写入并发
以及独立数据库运维场景。

## 计划中的 Docker 形态

第一版正式支持的容器部署应为单容器应用，并挂载两个持久化目录：

```text
EdgeEver 容器
├── SQLite 数据库       -> /data/edgeever.sqlite
└── 附件存储             -> /data/resources
```

自托管适配器继续复用现有 SQLite 结构和 `migrations/*.sql`；附件继续使用
`resources.object_key` 中保存的不透明对象键。目前的实验性运行入口已经支持
本地文件系统和 S3 兼容对象存储两种后端。

未来实现 PostgreSQL 时，必须明确处理 SQL 方言以及 PostgreSQL 专用的全文搜索
和事务行为，并提供独立迁移策略，不能让现有 SQLite/D1 migration 文件产生歧义。

## 兼容性要求

- 保持 `/api/*`、`/mcp`、`/api/openapi.json` 和 `/api/health` 不变。
- 继续追加 `migrations/*.sql`，禁止为 Docker 分叉数据库结构。
- 密钥必须通过环境变量或 Docker secrets 注入，不能写入镜像或数据库挂载卷。
- 将 `/data` 作为唯一必需的应用持久化路径，方便 NAS 用户备份一个卷。
- 容器入口需要支持 `EDGE_EVER_AUTH_USERNAME`、`EDGE_EVER_AUTH_PASSWORD` 和
  会话配置，同时不能把 Cloudflare 专有配置当作前置条件。
- 登录暴力破解防护必须使用应用层的 SQLite/D1 兼容存储实现；Cloudflare
  Rate Limiting 和 WAF 只能作为部署层的可选增强，不能作为运行前提。
- 健康检查应区分进程可用、数据库就绪和附件存储就绪。

本文档用于预留架构边界，不是 Docker 部署指南。在自托管适配器以及备份、
升级流程经过实际验证前，Cloudflare 部署仍是唯一受支持的生产部署方式。

当前已提供用于开发适配器的实验性本地运行入口：

```sh
bun run build:web
EDGE_EVER_AUTH_PASSWORD='<强密码>' bun run start:self-hosted
```

可通过 `EDGE_EVER_DATA_DIR` 指定需要由 Docker 或 NAS 卷持久化的目录。该入口
目前仍不是正式支持的发行物。

同一个入口也可以使用 S3 兼容对象存储：

```sh
EDGE_EVER_STORAGE_BACKEND=s3 \
EDGE_EVER_S3_ENDPOINT='http://minio:9000' \
EDGE_EVER_S3_REGION='us-east-1' \
EDGE_EVER_S3_BUCKET='edgeever' \
EDGE_EVER_S3_ACCESS_KEY_ID='<access-key>' \
EDGE_EVER_S3_SECRET_ACCESS_KEY='<secret-key>' \
bun run start:self-hosted
```

实现使用 `@aws-sdk/client-s3`，Cloudflare Worker 入口不会加载该 SDK。
