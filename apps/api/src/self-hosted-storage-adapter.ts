import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type {
  BlobObjectAdapter,
  BlobStoreAdapter,
  DatabaseAdapter,
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

class SqlitePreparedStatement {
  constructor(
    private readonly sqlite: SqliteDatabaseLike,
    readonly sql: string,
    readonly bindings: unknown[] = [],
  ) {}

  bind(...bindings: unknown[]) {
    return new SqlitePreparedStatement(this.sqlite, this.sql, bindings);
  }

  async all() {
    return {
      results: this.sqlite.query(this.sql).all(...this.bindings),
      success: true,
      meta: {},
    };
  }

  async first<T = Record<string, unknown>>() {
    return (this.sqlite.query(this.sql).get(...this.bindings) as T | null | undefined) ?? null;
  }

  async run() {
    this.sqlite.query(this.sql).run(...this.bindings);
    return { success: true, meta: {} };
  }
}

class SqliteDatabaseAdapter {
  constructor(private readonly sqlite: SqliteDatabaseLike) {}

  prepare(sql: string) {
    return new SqlitePreparedStatement(this.sqlite, sql);
  }

  async batch(statements: SqlitePreparedStatement[]) {
    const results: unknown[] = [];
    this.sqlite.transaction(() => {
      for (const statement of statements) {
        results.push(this.sqlite.query(statement.sql).run(...statement.bindings));
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
  db: new SqliteDatabaseAdapter(sqlite) as unknown as DatabaseAdapter,
  resources: createLocalBlobStore(resourcesDirectory),
});
