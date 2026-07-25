# Self-hosting and Docker architecture

Docker-based self-hosting is planned for VPS, NAS, and home servers. It is not
available as a supported release yet.

## Current boundary

The API's business and route logic must depend on the storage contracts in
`apps/api/src/storage-contract.ts`, not on a Cloudflare SDK type directly. The
current concrete implementation lives in
`apps/api/src/cloudflare-storage-adapter.ts`:

- `DatabaseAdapter`: SQL statements and batches.
- `BlobStoreAdapter`: attachment `get`, `put`, and `delete` operations.

Cloudflare D1 and R2 remain the production adapter today. This keeps the
existing Worker deployment unchanged while reserving a stable replacement
point for a self-hosted adapter.

The shared self-hosted configuration shape is also defined as
`SelfHostedStorageConfig`, with one application data directory, one SQLite
database file, and one attachment directory.

PostgreSQL is reserved as a second relational backend through the
driver-neutral `RelationalDatabaseAdapter` and `PostgreSQLStorageConfig`
contracts. It is intentionally not implemented yet. SQLite remains the
default self-hosted database; PostgreSQL will be useful for larger teams,
higher write concurrency, and external database operations.

## Intended Docker shape

The first supported container deployment should be a single application
container with two persistent mounts:

```text
EdgeEver container
├── SQLite database       -> /data/edgeever.sqlite
└── attachment store      -> /data/resources
```

The initial self-hosted adapter preserves the existing SQLite schema and
`migrations/*.sql` files. Attachments are addressed by the same opaque object
keys currently stored in `resources.object_key`; the experimental runtime
already supports both a local filesystem backend and an S3-compatible backend.

When PostgreSQL is implemented, it must introduce an explicit SQL dialect and
migration set for PostgreSQL-specific full-text search and transaction
behavior. It must not make the current SQLite/D1 migration files silently
ambiguous.

## Compatibility requirements

- Keep `/api/*`, `/mcp`, `/api/openapi.json`, and `/api/health` unchanged.
- Keep the current migration files append-only; do not fork the schema for
  Docker.
- Store secrets in environment variables or Docker secrets, never in the
  image or a mounted database.
- Make `/data` the only required persistent application path so NAS users can
  back up one volume.
- Support `EDGE_EVER_AUTH_USERNAME`, `EDGE_EVER_AUTH_PASSWORD`, and session
  settings without Cloudflare-specific naming assumptions in the container
  entrypoint.
- Expose a health check that distinguishes process availability from database
  readiness and attachment-store readiness.

This document is an architecture reservation, not a Docker deployment guide.
Until a self-hosted adapter and backup/upgrade procedure are tested, the
Cloudflare deployment remains the only supported production deployment.

An experimental local runtime is available for adapter development:

```sh
bun run build:web
EDGE_EVER_AUTH_PASSWORD='<strong-password>' bun run start:self-hosted
```

Set `EDGE_EVER_DATA_DIR` to the directory that should be persisted by Docker
or a NAS volume. This runtime is not yet a supported release artifact.

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
