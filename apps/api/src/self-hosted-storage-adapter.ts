import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type {
  BlobObjectAdapter,
  BlobStoreAdapter,
  DatabaseAdapter,
  DatabaseQueryResult,
  PreparedStatementAdapter,
  RelationalDatabaseDialect,
  StorageAdapter,
} from "./storage-contract";

/** Small subset of Bun's SQLite API needed by the D1-compatible adapter. */
export type SqliteDatabaseLike = {
  query: (sql: string) => {
    all: (...bindings: unknown[]) => unknown[];
    get: (...bindings: unknown[]) => unknown;
    run: (...bindings: unknown[]) => unknown;
  };
  transaction: (callback: () => void) => () => unknown;
};

export const SELF_HOSTED_DATABASE_DIALECT: RelationalDatabaseDialect = "sqlite";

const sqliteResultMeta = (result: unknown): Record<string, unknown> =>
  result && typeof result === "object" ? { ...result as Record<string, unknown> } : {};

class SqlitePreparedStatement implements PreparedStatementAdapter {
  constructor(
    private readonly sqlite: SqliteDatabaseLike,
    readonly sql: string,
    readonly bindings: unknown[] = [],
  ) {}

  bind(...bindings: unknown[]) {
    return new SqlitePreparedStatement(this.sqlite, this.sql, bindings);
  }

  async all<T = Record<string, unknown>>(): Promise<DatabaseQueryResult<T>> {
    return {
      results: this.sqlite.query(this.sql).all(...this.bindings) as T[],
      success: true,
      meta: {},
    };
  }

  async first<T = unknown>(columnName: string): Promise<T | null>;
  async first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.sqlite.query(this.sql).get(...this.bindings);
    if (row === null || row === undefined) return null;
    if (columnName === undefined) return row as T;
    if (typeof row !== "object" || !(columnName in row)) return null;
    return (row as Record<string, unknown>)[columnName] as T;
  }

  async run<T = Record<string, unknown>>(): Promise<DatabaseQueryResult<T>> {
    const result = this.sqlite.query(this.sql).run(...this.bindings);
    return { results: [], success: true, meta: sqliteResultMeta(result) };
  }
}

class SqliteDatabaseAdapter implements DatabaseAdapter {
  constructor(private readonly sqlite: SqliteDatabaseLike) {}

  prepare(sql: string) {
    return new SqlitePreparedStatement(this.sqlite, sql);
  }

  async batch<T = unknown>(
    statements: PreparedStatementAdapter[],
  ): Promise<DatabaseQueryResult<T>[]> {
    const results: DatabaseQueryResult<T>[] = [];
    this.sqlite.transaction(() => {
      for (const statement of statements) {
        if (!(statement instanceof SqlitePreparedStatement)) {
          throw new TypeError("SQLite batches can only execute statements prepared by the same adapter");
        }
        const result = this.sqlite.query(statement.sql).run(...statement.bindings);
        results.push({ results: [], success: true, meta: sqliteResultMeta(result) });
      }
    })();
    return results;
  }
}

const safeObjectPath = (rootDirectory: string, objectKey: string) => {
  const root = resolve(rootDirectory);
  const target = resolve(root, objectKey);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Invalid resource object key");
  }

  return target;
};

const createLocalBlobStore = (rootDirectory: string): BlobStoreAdapter => ({
  async get(objectKey, options): Promise<BlobObjectAdapter | null> {
    const target = safeObjectPath(rootDirectory, objectKey);

    try {
      if (options?.range) {
        const handle = await open(target, "r");
        try {
          const { size } = await handle.stat();
          const bytes = new Uint8Array(options.range.length);
          const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, options.range.offset);
          const bodyBytes = bytes.subarray(0, bytesRead);
          return {
            body: new Response(bodyBytes).body as ReadableStream<Uint8Array>,
            size,
            range: { offset: options.range.offset, length: bytesRead },
            writeHttpMetadata: (headers) => {
              headers.set("Content-Length", String(bytesRead));
            },
          };
        } finally {
          await handle.close();
        }
      }

      const bytes = await readFile(target);
      return {
        body: new Response(bytes).body as ReadableStream<Uint8Array>,
        size: bytes.byteLength,
        writeHttpMetadata: (headers) => {
          headers.set("Content-Length", String(bytes.byteLength));
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  },

  async put(objectKey, value) {
    const target = safeObjectPath(rootDirectory, objectKey);
    await mkdir(dirname(target), { recursive: true });

    if (value instanceof Uint8Array) {
      await writeFile(target, value);
      return;
    }

    if (value instanceof ArrayBuffer) {
      await writeFile(target, new Uint8Array(value));
      return;
    }

    if (value instanceof Blob) {
      await writeFile(target, new Uint8Array(await value.arrayBuffer()));
      return;
    }

    throw new Error("Unsupported local resource payload");
  },

  async delete(objectKeys) {
    const keys = Array.isArray(objectKeys) ? objectKeys : [objectKeys];
    await Promise.all(keys.map(async (objectKey) => {
      try {
        await unlink(safeObjectPath(rootDirectory, objectKey));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }));
  },
});

/**
 * Creates the first self-hosted adapter: SQLite-compatible database plus a
 * filesystem-backed attachment store. The caller owns SQLite initialization
 * and migration execution so Bun is not imported into the Worker bundle.
 */
export const createSelfHostedStorageAdapter = (
  sqlite: SqliteDatabaseLike,
  resourcesDirectory: string,
): StorageAdapter => ({
  db: new SqliteDatabaseAdapter(sqlite),
  resources: createLocalBlobStore(resourcesDirectory),
  diagnostics: {
    database: "sqlite",
    resources: "filesystem",
    migrationTable: "_edgeever_migrations",
  },
});
