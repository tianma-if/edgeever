# Self-hosting and Docker architecture

Docker-based self-hosting supports VPS, NAS, and home servers without creating
a second product implementation. Cloudflare and Docker execute the same Hono
application and differ only at thin runtime and infrastructure adapter seams.

## Current boundary

The API's business and route logic must depend on the storage contracts in
`apps/api/src/storage-contract.ts`, not on a Cloudflare SDK type directly. The
current concrete implementation lives in
`apps/api/src/cloudflare-storage-adapter.ts`:

- `DatabaseAdapter`: SQL statements and batches.
- `BlobStoreAdapter`: attachment `get`, `put`, and `delete` operations.

Cloudflare injects the D1/R2 adapter into `fetchEdgeEverApp`; the Bun entrypoint
injects the SQLite/filesystem or SQLite/S3 adapter into that same function.
Neither entrypoint owns route or business decisions.

The shared self-hosted configuration shape is defined as
`SelfHostedStorageConfig`, with one application data directory, one SQLite
database file, and one attachment directory.

PostgreSQL is reserved as a second relational backend through the
driver-neutral `RelationalDatabaseAdapter` and `PostgreSQLStorageConfig`
contracts. It is intentionally not implemented yet. SQLite remains the
default self-hosted database; PostgreSQL will be useful for larger teams,
higher write concurrency, and external database operations.

## Docker shape

The supported container deployment is a single application container with one
persistent `/data` mount:

```text
EdgeEver container
├── SQLite database       -> /data/edgeever.sqlite
└── attachment store      -> /data/resources
```

The self-hosted adapter preserves the existing SQLite schema and
`migrations/*.sql` files. Attachments are addressed by the same opaque object
keys stored in `resources.object_key`; the runtime supports both a local
filesystem backend and an S3-compatible backend.

When PostgreSQL is implemented, it must introduce an explicit SQL dialect and
migration set for PostgreSQL-specific full-text search and transaction
behavior. It must not make the current SQLite/D1 migration files silently
ambiguous.

## Compatibility requirements

- Keep `/api/*`, `/mcp`, `/api/openapi.json`, and `/api/health` unchanged.
- Keep the current migration files append-only; do not fork the schema for
  Docker.
- Keep root secrets in environment variables or Docker secrets, never in the
  image or database. Object-storage secrets and personal AI model API keys use
  separate purpose-specific keys derived from the existing instance
  authentication secret. An optional `EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY`
  can override the AI credential key for advanced rotation.
  Stored credentials must remain AES-GCM ciphertext.
- Make `/data` the only required persistent application path so NAS users can
  back up one volume.
- Support `EDGE_EVER_AUTH_USERNAME`, `EDGE_EVER_AUTH_PASSWORD`, and session
  settings without Cloudflare-specific naming assumptions in the container
  entrypoint.
- Keep login brute-force protection in the application layer with SQLite/D1-
  compatible storage; Cloudflare Rate Limiting and WAF may be optional
  deployment-level enhancements, but must not be required.
- Expose a health check that distinguishes process availability from database
  readiness and attachment-store readiness.

Operational instructions, including secrets, HTTPS, backups, upgrades, and NAS
permissions, live in [Deploy EdgeEver with Docker](deploy-docker.md).

The Docker image and local development use the same Bun runtime:

```sh
bun run build:web
EDGE_EVER_AUTH_PASSWORD='<strong-password>' bun run start:self-hosted
```

Set `EDGE_EVER_DATA_DIR` to the directory that should be persisted by Docker
or a NAS volume.
Long-running streaming responses use a 120-second idle timeout by default. Set
`EDGE_EVER_IDLE_TIMEOUT_SECONDS` to a value from 10 to 255 to override it.

The same runtime can use an S3-compatible object store:

```sh
EDGE_EVER_STORAGE_BACKEND=s3 \
EDGE_EVER_S3_ENDPOINT='http://minio:9000' \
EDGE_EVER_S3_REGION='us-east-1' \
EDGE_EVER_S3_BUCKET='edgeever' \
EDGE_EVER_S3_ACCESS_KEY_ID='<access-key>' \
EDGE_EVER_S3_SECRET_ACCESS_KEY='<secret-key>' \
bun run start:self-hosted
```

The implementation uses `@aws-sdk/client-s3` and does not load that SDK in the
Cloudflare Worker entrypoint.
