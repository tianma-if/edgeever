import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type {
  BlobObjectAdapter,
  BlobMultipartUploadAdapter,
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

const localMultipartUpload = (
  rootDirectory: string,
  objectKey: string,
  uploadId: string,
): BlobMultipartUploadAdapter => {
  const uploadDirectory = safeObjectPath(rootDirectory, `.uploads/${uploadId}`);
  const partPath = (partNumber: number) => resolve(uploadDirectory, `${partNumber}.part`);

  return {
    uploadId,
    async uploadPart(partNumber, value) {
      await mkdir(uploadDirectory, { recursive: true });
      const bytes = value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : value instanceof Blob
          ? new Uint8Array(await value.arrayBuffer())
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      await writeFile(partPath(partNumber), bytes);
      return { partNumber, etag: `local-${partNumber}-${bytes.byteLength}` };
    },
    async complete(parts) {
      const target = safeObjectPath(rootDirectory, objectKey);
      const temporaryTarget = `${target}.upload-${uploadId}`;
      await mkdir(dirname(target), { recursive: true });
      const output = await open(temporaryTarget, "w");
      try {
        for (const part of [...parts].sort((left, right) => left.partNumber - right.partNumber)) {
          const source = partPath(part.partNumber);
          const info = await stat(source);
          if (part.etag !== `local-${part.partNumber}-${info.size}`) {
            throw new Error(`Multipart upload part ${part.partNumber} does not match its recorded ETag.`);
          }
          const input = await open(source, "r");
          try {
            for await (const chunk of input.createReadStream()) {
              await output.write(chunk);
            }
          } finally {
            await input.close();
          }
        }
      } catch (error) {
        await output.close();
        await rm(temporaryTarget, { force: true });
        throw error;
      }
      await output.close();
      await rename(temporaryTarget, target);
      await rm(uploadDirectory, { recursive: true, force: true });
    },
    async abort() {
      await rm(uploadDirectory, { recursive: true, force: true });
    },
  };
};

const createLocalBlobStore = (rootDirectory: string): BlobStoreAdapter => ({
  async get(objectKey, options): Promise<BlobObjectAdapter | null> {
    const target = safeObjectPath(rootDirectory, objectKey);

    try {
      const { size } = await stat(target);
      const requestedRange = options?.range;
      const rangeLength = requestedRange
        ? Math.max(0, Math.min(requestedRange.length, size - requestedRange.offset))
        : size;
      const nodeStream = createReadStream(target, requestedRange
        ? {
            start: requestedRange.offset,
            end: requestedRange.offset + rangeLength - 1,
          }
        : undefined);
      const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
      return {
        body,
        size,
        ...(requestedRange
          ? { range: { offset: requestedRange.offset, length: rangeLength } }
          : {}),
        writeHttpMetadata: (headers) => {
          headers.set("Content-Length", String(rangeLength));
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

  async createMultipartUpload(objectKey) {
    return localMultipartUpload(rootDirectory, objectKey, crypto.randomUUID());
  },

  resumeMultipartUpload(objectKey, uploadId) {
    return localMultipartUpload(rootDirectory, objectKey, uploadId);
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
