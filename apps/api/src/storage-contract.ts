/**
 * Platform-neutral storage seams used by the API layer.
 *
 * These contracts describe only the operations consumed by application code.
 * Runtime adapters translate D1, SQLite, R2, filesystem, or S3 primitives into
 * these shapes without leaking provider SDK types into routes and services.
 */
export type DatabaseOperationResult = {
  success: true;
  meta: Record<string, unknown>;
};

export type DatabaseQueryResult<T = unknown> = DatabaseOperationResult & {
  results: T[];
};

export type PreparedStatementAdapter = {
  bind: (...values: unknown[]) => PreparedStatementAdapter;
  first: {
    <T = unknown>(columnName: string): Promise<T | null>;
    <T = Record<string, unknown>>(): Promise<T | null>;
  };
  run: <T = Record<string, unknown>>() => Promise<DatabaseQueryResult<T>>;
  all: <T = Record<string, unknown>>() => Promise<DatabaseQueryResult<T>>;
};

export type DatabaseAdapter = {
  prepare: (query: string) => PreparedStatementAdapter;
  batch: <T = unknown>(statements: PreparedStatementAdapter[]) => Promise<DatabaseQueryResult<T>[]>;
};

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
  diagnostics: {
    database: "d1" | "sqlite";
    resources: "r2" | "filesystem" | "s3";
    migrationTable: "d1_migrations" | "_edgeever_migrations";
  };
};

/** Database engines that a self-hosted deployment may select. */
export type RelationalDatabaseDialect = "sqlite" | "postgresql";

/**
 * Future transaction-oriented relational contract. The current API consumes
 * the statement-oriented DatabaseAdapter above; this contract prevents a
 * future PostgreSQL implementation from leaking driver calls into routes.
 */
export type RelationalDatabaseAdapter = {
  readonly dialect: RelationalDatabaseDialect;
  query<T>(sql: string, parameters?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<void>;
  transaction<T>(callback: (database: RelationalDatabaseAdapter) => Promise<T>): Promise<T>;
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
