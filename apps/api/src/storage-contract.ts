/**
 * Platform-neutral storage seams used by the API layer.
 *
 * The current production adapter is Cloudflare D1/R2, so these contracts are
 * intentionally compatible with the Workers runtime types. A future
 * self-hosted adapter can implement the same operations with SQLite and a
 * filesystem or S3-compatible object store without changing route logic.
 */
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export type DatabaseAdapter = Pick<D1Database, "prepare" | "batch">;
export type PreparedStatementAdapter = D1PreparedStatement;

export type BlobRange = {
  offset: number;
  length: number;
};

export type BlobGetOptions = {
  range?: BlobRange;
};

/** The subset of an object store response needed by the HTTP resource route. */
export type BlobObjectAdapter = {
  body: ReadableStream<Uint8Array>;
  /** Total object size, even when body contains only a requested range. */
  size: number;
  range?: BlobRange;
  writeHttpMetadata: (headers: Headers) => void;
};

/**
 * Deliberately uses unknown for provider-specific upload metadata. The API
 * passes through metadata such as content type and cache control, while a
 * self-hosted adapter can map it to filesystem sidecars or S3 metadata.
 */
export type BlobStoreAdapter = {
  get: (key: string, options?: BlobGetOptions) => Promise<BlobObjectAdapter | null>;
  put: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
  delete: (keys: string | string[]) => Promise<void>;
};

/** The complete persistence surface consumed by the API. */
export type StorageAdapter = {
  db: DatabaseAdapter;
  resources: BlobStoreAdapter;
};

/** Database engines that a self-hosted deployment may select. */
export type RelationalDatabaseDialect = "sqlite" | "postgresql";

/**
 * Future driver-neutral relational contract. The current API still consumes
 * the D1-compatible DatabaseAdapter above; this contract prevents a future
 * PostgreSQL implementation from leaking driver-specific calls into routes.
 */
export type RelationalDatabaseAdapter = {
  readonly dialect: RelationalDatabaseDialect;
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
  transaction<T>(callback: (database: RelationalDatabaseAdapter) => Promise<T>): Promise<T>;
};

/** Cloudflare's native Worker bindings, used only by the platform adapter. */
export type CloudflareStorageBindings = {
  DB: DatabaseAdapter;
  RESOURCES: BlobStoreAdapter;
};

export type StorageAdapterKind = "cloudflare" | "self_hosted";

/** Configuration shared by the future SQLite/filesystem implementation. */
export type SelfHostedStorageConfig = {
  dataDirectory: string;
  databaseFile: string;
  resourcesDirectory: string;
  databaseDialect?: RelationalDatabaseDialect;
};

/** Configuration reserved for a future PostgreSQL-backed deployment. */
export type PostgreSQLStorageConfig = {
  databaseUrl: string;
  schema?: string;
  poolSize?: number;
};
