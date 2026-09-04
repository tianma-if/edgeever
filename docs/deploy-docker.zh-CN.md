# 使用 Docker 部署 EdgeEver

EdgeEver 在 Cloudflare 与 Docker 中共用同一套 Web 应用、Hono 路由、业务服务、
鉴权、OpenAPI、MCP 实现和只增不改的 migration。两种部署仅有薄运行入口和基础
设施适配器不同：Docker 使用 Bun + SQLite + 本地文件（或 S3 兼容对象存储），
Cloudflare 使用 Workers + D1 + R2。

## 环境要求

- Docker Engine 24 或更高版本，包含 Docker Compose v2。
- `amd64` 或 `arm64` Linux 主机。
- 实例离开可信局域网时，必须使用带 HTTPS 的反向代理。

## 一键安装

已安装 Docker Compose v2 的主机可直接执行：

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

脚本会创建 `~/edgeever`、生成管理员密码、拉取 `latest`、启动容器并等待健康
检查通过。安装脚本和 Compose 配置使用官方 GHCR 镜像。再次执行同一命令即可
升级，已有密码和 `/data` 卷保持不变。

EdgeEver 官方容器镜像托管于 GitHub Container Registry（GHCR）。部分中国大陆
网络环境可能出现连接缓慢或超时。如果无法正常拉取，请在部署前自行配置可用的
网络代理或可信的镜像加速服务。第三方网络及镜像服务的可用性和安全性由
用户自行评估。

默认情况下，脚本会通过当前用户的 crontab 设置每日自动更新，于服务器本地时间
04:17 执行 `~/edgeever/update.sh`。更新程序会刷新 Compose 配置、拉取已配置的
镜像标签、按需重建服务并验证容器健康状态，运行记录追加到
`~/edgeever/update.log`。默认的 `latest` 标签会自动获得新版本；通过 `--version`
指定的版本保持固定。使用 `--no-auto-update` 或
`EDGE_EVER_AUTO_UPDATE=false` 可关闭自动更新。如果系统没有 `crontab`，安装脚本
会保留 `update.sh`，并提示通过 NAS 的任务计划程序执行。

按需使用 `--version vX.Y.Z`、`--port PORT` 或 `--install-dir DIR`；执行以下命令
可查看全部参数：

```sh
curl -fsSL https://edgeever.org/install.sh | bash -s -- --help
```

## 手动使用 Compose

下载 `compose.yaml`，选择要运行的正式版本，并设置高强度实例密码：

```sh
export EDGE_EVER_VERSION=vX.Y.Z
export EDGE_EVER_AUTH_PASSWORD='请替换为足够长的随机密码'
docker compose up -d
docker compose ps
```

打开 `http://localhost:8787`。只有共享的 `/api/health` 确认鉴权、SQLite 和对象
存储均已就绪后，容器才会进入 healthy 状态。

### 镜像地址

官方镜像为 `ghcr.io/tianma-if/edgeever`，支持 `linux/amd64` 与 `linux/arm64`。
生产环境应通过 `EDGE_EVER_VERSION` 固定正式版本标签。

Compose 会创建一个命名卷。所有需要在容器替换后保留的数据都位于 `/data`：

```text
/data/edgeever.sqlite       SQLite 数据库
/data/resources/            本地图片与附件
```

镜像以非 root 的 `bun` 用户运行（UID/GID 均为 `1000`）。如果 NAS 必须使用主机
目录绑定而不是命名卷，请先创建目录，并为 UID/GID `1000` 授予读写权限。
安装或自动更新失败时，脚本会对 `/data` 执行实际写入测试，输出挂载类型、来源、
容器用户和目录状态。确认是权限问题后，还会根据 Docker 命名卷或 NAS 目录绑定
给出对应的修复命令；脚本不会擅自修改现有数据的权限。

## 配置

常用环境变量：

| 变量                                   | 默认值   | 用途                                      |
| -------------------------------------- | -------- | ----------------------------------------- |
| `EDGE_EVER_AUTH_USERNAME`              | `admin`  | 初始管理员用户名                          |
| `EDGE_EVER_AUTH_PASSWORD`              | 无       | 初始密码；新数据库必须提供                |
| `EDGE_EVER_AUTH_PASSWORD_HASH`         | 无       | 可替代明文引导密码的 PBKDF2 hash          |
| `EDGE_EVER_SESSION_TTL_DAYS`           | `400`    | 登录会话有效期                            |
| `EDGE_EVER_IDLE_TIMEOUT_SECONDS`       | `120`    | Bun 流式响应空闲超时，可设为 10 到 255 秒 |
| `EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY` | 自动派生 | 可选的独立 AI 凭据加密密钥                |

Secret 可在受支持的变量名后追加 `_FILE`，并指向 Docker secret，例如
`EDGE_EVER_AUTH_PASSWORD_FILE=/run/secrets/auth_password`。密码/hash 和 S3
访问凭据均支持这种形式。同一个 Secret 不得同时设置直接变量与
对应的 `_FILE` 变量。

`EDGE_EVER_ALLOW_UNAUTHENTICATED=true` 仅用于隔离的开发环境，严禁将未鉴权
实例暴露到网络。

## 使用 S3 兼容附件存储

SQLite 仍保存在 `/data`，新附件可以写入 MinIO、AWS S3、阿里云 OSS、腾讯云
COS、R2 或其他兼容服务：

```yaml
environment:
  EDGE_EVER_STORAGE_BACKEND: s3
  EDGE_EVER_S3_ENDPOINT: https://s3.example.com
  EDGE_EVER_S3_REGION: us-east-1
  EDGE_EVER_S3_BUCKET: edgeever
  EDGE_EVER_S3_ACCESS_KEY_ID_FILE: /run/secrets/s3_access_key
  EDGE_EVER_S3_SECRET_ACCESS_KEY_FILE: /run/secrets/s3_secret_key
  EDGE_EVER_S3_FORCE_PATH_STYLE: "true"
```

切换默认后端不会迁移历史附件。在完成导出或迁移前，必须保持旧后端可用。

## HTTPS 与网络暴露

容器在 `8787` 端口提供 HTTP。请使用维护活跃的 Caddy、Traefik 或 Nginx 终止
HTTPS，并转发原始 Host 和客户端地址。严禁公开 SQLite、`/data` 或对象存储的
管理端口。

## 备份与恢复

可使用 EdgeEver ZIP 导出制作跨环境内容备份，同时应冷备份 `/data` 卷以支持
完整实例恢复：

1. 执行 `docker compose stop edgeever`，等待日志出现 shutdown complete。
   EdgeEver 会在优雅停机时 checkpoint SQLite WAL。
2. 完整复制或快照命名卷，包括 SQLite 文件与 `resources` 目录。
3. 执行 `docker compose start edgeever` 恢复服务。

请单独备份实例认证 Secret，以及显式配置的
`EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY`。EdgeEver 会从认证 Secret 派生不同用途
的凭据密钥，缺少它时卷备份无法解密已保存的凭据。使用 S3 时还需独立备份存储桶。

只能在 EdgeEver 停止时恢复到空卷，并同时恢复匹配的 Secret。应定期在独立
实例中验证备份。

## 升级与回滚

生产环境应使用不可变的正式版本标签，不要依赖 `latest`：

```sh
export EDGE_EVER_VERSION=vX.Y.Z
docker compose pull
docker compose up -d
docker compose ps
```

容器会在接收流量前应用与 D1 共用的 `migrations/*.sql`。升级前必须先备份。
回退应用镜像不会逆向撤销数据库 migration；需要回退数据时，应恢复升级前的
卷备份。

在 Cloudflare 与 Docker 之间迁移时，请使用 EdgeEver 的完整备份/导出与恢复
流程。不要复制在线 D1 数据库文件，也不要改写 migration 历史。

## 从源码构建

```sh
docker build --tag edgeever:local .
docker run --rm -p 8787:8787 \
  -e EDGE_EVER_AUTH_PASSWORD='请替换为足够长的随机密码' \
  -v edgeever-data:/data \
  edgeever:local
```

Docker 首发版本不支持 PostgreSQL。它仍是未来的存储适配器，不会形成另一套
业务代码分支。
