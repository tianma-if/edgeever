# Deploy EdgeEver with Docker

EdgeEver uses the same web application, Hono routes, services, authentication,
OpenAPI document, MCP implementation, and append-only migrations on Cloudflare
and Docker. Only the thin runtime and infrastructure adapters differ: Docker
uses Bun with SQLite and local files (or S3-compatible object storage), while
Cloudflare uses Workers with D1 and R2.

## Requirements

- Docker Engine 24 or later with Docker Compose v2.
- An `amd64` or `arm64` Linux host.
- A reverse proxy with HTTPS when the instance is reachable outside a trusted
  local network.

## One-command install

With Docker Compose v2 already installed:

```sh
curl -fsSL https://edgeever.org/install.sh | bash
```

Use Tencent Cloud TCR in mainland China:

```sh
curl -fsSL https://edgeever-installer-1256854452.cos.ap-guangzhou.myqcloud.com/install.sh | bash -s -- --mirror tcr
```

The installer creates `~/edgeever`, generates an administrator password, pulls
`latest`, starts the container, and waits for it to become healthy. Run the same
command again to upgrade without replacing the password or `/data` volume. The
mainland command downloads the installer and Compose configuration from Tencent
COS and pulls the image from Tencent TCR.

By default, the installer schedules `~/edgeever/update.sh` with the current
user's crontab at 04:17 server time every day. The updater refreshes the Compose
configuration, pulls the configured image tag, restarts the service when needed,
and verifies container health. Output is appended to `~/edgeever/update.log`.
The default `latest` tag receives new releases automatically; a version supplied
with `--version` remains pinned. Use `--no-auto-update` or
`EDGE_EVER_AUTO_UPDATE=false` to disable the schedule. If `crontab` is unavailable,
the installer keeps `update.sh` and prints instructions for adding it to the NAS
task scheduler.

Use `--version vX.Y.Z`, `--port PORT`, or `--install-dir DIR` when needed. Run
`curl -fsSL https://edgeever.org/install.sh | bash -s -- --help` for all options.

## Manual Compose

Download `compose.yaml`, choose the release you want to run, and provide a
strong instance password:

```sh
export EDGE_EVER_VERSION=vX.Y.Z
export EDGE_EVER_AUTH_PASSWORD='replace-with-a-long-random-password'
docker compose up -d
docker compose ps
```

Open `http://localhost:8787`. The container reports healthy only after the
shared `/api/health` endpoint confirms that authentication, SQLite, and object
storage are ready.

### Image registry

The default image is `ghcr.io/tianma-if/edgeever`. Users in mainland China can
switch to Tencent Cloud TCR:

```sh
export EDGE_EVER_IMAGE=ccr.ccs.tencentyun.com/edgeever/edgeever
export EDGE_EVER_VERSION=vX.Y.Z
docker compose pull
docker compose up -d
```

The public TCR image requires no `docker login` and supports `linux/amd64` and
`linux/arm64`. Formal releases publish the same version tags and `latest` to
GHCR and TCR. TCR is independently built from the same verified Git commit
inside Tencent Cloud, so its registry digest may differ from GHCR. Pin
`EDGE_EVER_VERSION` to a release tag in production.

Compose creates one named volume. Everything that must survive a container
replacement is under `/data`:

```text
/data/edgeever.sqlite       SQLite database
/data/resources/            local images and attachments
```

The image runs as the non-root `bun` user (UID/GID `1000`). If a NAS requires
a host bind mount instead of the named volume, create the directory first and
grant UID/GID `1000` read/write access.
When an installation or automatic update fails, the script performs a real
write test against `/data` and reports the mount type, source, container user,
and directory state. If permissions are the cause, it prints a repair command
tailored to a Docker named volume or NAS bind mount; it never changes existing
data permissions automatically.

## Configuration

Common environment variables:

| Variable                               | Default | Purpose                                                     |
| -------------------------------------- | ------- | ----------------------------------------------------------- |
| `EDGE_EVER_AUTH_USERNAME`              | `admin` | Initial administrator username                              |
| `EDGE_EVER_AUTH_PASSWORD`              | none    | Initial password; required for a new database               |
| `EDGE_EVER_AUTH_PASSWORD_HASH`         | none    | PBKDF2 hash alternative to the plaintext bootstrap password |
| `EDGE_EVER_SESSION_TTL_DAYS`           | `400`   | Login session lifetime                                      |
| `EDGE_EVER_IDLE_TIMEOUT_SECONDS`       | `120`   | Bun streaming idle timeout, from 10 to 255 seconds          |
| `EDGE_EVER_STORAGE_ENCRYPTION_KEY`     | none    | Encrypts saved external object-storage credentials          |
| `EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY` | derived | Optional independent AI credential encryption key           |

For secrets, append `_FILE` to a supported variable and point it at a Docker
secret, for example `EDGE_EVER_AUTH_PASSWORD_FILE=/run/secrets/auth_password`.
The password/hash, storage encryption keys, and S3 access credentials support
this form. Do not set both the direct variable and its `_FILE` counterpart.

`EDGE_EVER_ALLOW_UNAUTHENTICATED=true` is available for isolated development
only. Do not expose an unauthenticated instance to a network.

## S3-compatible attachment storage

SQLite remains in `/data`, while new attachments can be stored in MinIO, AWS
S3, Alibaba Cloud OSS, Tencent COS, R2, or another compatible service:

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

Changing the default backend does not migrate historical attachments. Keep
the old backend available until its resources have been exported or migrated.

## HTTPS and network exposure

The container serves HTTP on port `8787`. Terminate HTTPS in a maintained
reverse proxy such as Caddy, Traefik, or Nginx and forward the original host
and client address headers. Do not publish SQLite, `/data`, or an object-store
administration port.

## Backup and restore

Use EdgeEver's ZIP export for portable content backups. Also make a cold copy
of the `/data` volume for complete instance recovery:

1. Run `docker compose stop edgeever` and wait for the shutdown-complete log.
   EdgeEver checkpoints SQLite's WAL during graceful shutdown.
2. Copy or snapshot the entire named volume, including the SQLite file and
   `resources` directory.
3. Start the service with `docker compose start edgeever`.

Keep `EDGE_EVER_STORAGE_ENCRYPTION_KEY` and any explicitly configured
`EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY` in a separate secret backup. A volume
backup cannot decrypt stored credentials without those keys. When S3 storage
is enabled, back up the bucket separately.

Restore only while EdgeEver is stopped, into an empty volume, and restore the
matching secret keys at the same time. Test backups periodically on a separate
instance.

## Upgrade and rollback

Use immutable release tags instead of `latest` for production:

```sh
export EDGE_EVER_VERSION=vX.Y.Z
docker compose pull
docker compose up -d
docker compose ps
```

The container applies the same append-only `migrations/*.sql` files used by D1
before it starts accepting traffic. Take a backup first. Application rollback
does not reverse a database migration; restore the pre-upgrade volume backup
when a data rollback is required.

To move between Cloudflare and Docker, use EdgeEver's full backup/export and
restore flow. Do not copy a live D1 database file or rewrite migration history.

## Build from source

```sh
docker build --tag edgeever:local .
docker run --rm -p 8787:8787 \
  -e EDGE_EVER_AUTH_PASSWORD='replace-with-a-long-random-password' \
  -v edgeever-data:/data \
  edgeever:local
```

PostgreSQL is not supported in the first Docker release. It remains a future
storage adapter and will not introduce a separate business-code branch.
