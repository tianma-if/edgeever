import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createCloudflareStorageAdapter } from "../apps/api/src/cloudflare-storage-adapter";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter";
import { SELF_HOSTED_DATABASE_DIALECT } from "../apps/api/src/self-hosted-storage-adapter";
import { createS3CompatibleStorageAdapter } from "../apps/api/src/s3-compatible-storage-adapter";

describe("storage adapter", () => {
  test("wraps Cloudflare bindings without changing their identity", () => {
    const db = { prepare: () => undefined, batch: () => undefined };
    const resources = { get: async () => null, put: async () => undefined, delete: async () => undefined };
    const adapter = createCloudflareStorageAdapter({ DB: db, RESOURCES: resources } as never);

    expect(adapter.db).toBe(db);
    expect(adapter.resources).toBe(resources);
    expect(adapter.diagnostics).toEqual({
      database: "d1",
      resources: "r2",
      migrationTable: "d1_migrations",
    });
  });

  test("keeps the self-hosted database dialect explicit", () => {
    expect(SELF_HOSTED_DATABASE_DIALECT).toBe("sqlite");
  });

  test("implements the portable statement result contract without D1 types", async () => {
    const executions: Array<{ sql: string; bindings: unknown[] }> = [];
    const sqlite = {
      query: (sql: string) => ({
        all: (...bindings: unknown[]) => [{ sql, value: bindings[0] }],
        get: (...bindings: unknown[]) => ({ sql, value: bindings[0] }),
        run: (...bindings: unknown[]) => {
          executions.push({ sql, bindings });
          return { changes: 1, lastInsertRowid: 7 };
        },
      }),
      transaction: (callback: () => void) => () => callback(),
    };
    const database = createSelfHostedStorageAdapter(sqlite, ".edgeever-unused-resources").db;
    const statement = database.prepare("SELECT ? AS value").bind("edgeever");

    await expect(statement.all<{ sql: string; value: string }>()).resolves.toMatchObject({
      success: true,
      results: [{ sql: "SELECT ? AS value", value: "edgeever" }],
    });
    await expect(statement.first<string>("value")).resolves.toBe("edgeever");
    await expect(database.prepare("UPDATE notes SET value = ?").bind("updated").run()).resolves.toMatchObject({
      success: true,
      results: [],
      meta: { changes: 1, lastInsertRowid: 7 },
    });
    await expect(database.batch([
      database.prepare("DELETE FROM notes WHERE id = ?").bind("one"),
      database.prepare("DELETE FROM notes WHERE id = ?").bind("two"),
    ])).resolves.toHaveLength(2);
    expect(executions.map(({ bindings }) => bindings)).toEqual([
      ["updated"],
      ["one"],
      ["two"],
    ]);
  });

  test("stores attachments in a persistent filesystem directory", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-storage-`);
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };

    try {
      const adapter = createSelfHostedStorageAdapter(sqlite, directory);
      expect(adapter.diagnostics).toEqual({
        database: "sqlite",
        resources: "filesystem",
        migrationTable: "_edgeever_migrations",
      });
      await adapter.resources.put("workspace/memo/image.bin", new Uint8Array([1, 2, 3]));

      expect(await readFile(`${directory}/workspace/memo/image.bin`)).toEqual(new Uint8Array([1, 2, 3]));
      expect(await adapter.resources.get("workspace/memo/image.bin")).not.toBeNull();
      await adapter.resources.delete("workspace/memo/image.bin");
      expect(await adapter.resources.get("workspace/memo/image.bin")).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("streams full and ranged filesystem downloads in bounded chunks", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-storage-`);
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };
    const payload = new Uint8Array(2 * 1024 * 1024);
    payload.fill(7);

    try {
      const store = createSelfHostedStorageAdapter(sqlite, directory).resources;
      await store.put("workspace/memo/large.bin", payload);
      const object = await store.get("workspace/memo/large.bin");
      const reader = object!.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(first.value!.byteLength).toBeLessThan(payload.byteLength);
      await reader.cancel();

      const ranged = await store.get("workspace/memo/large.bin", {
        range: { offset: 1_000_000, length: 100_000 },
      });
      expect(ranged?.range).toEqual({ offset: 1_000_000, length: 100_000 });
      expect((await new Response(ranged!.body).arrayBuffer()).byteLength).toBe(100_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("assembles filesystem multipart uploads without exposing staging parts", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-storage-`);
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };

    try {
      const store = createSelfHostedStorageAdapter(sqlite, directory).resources;
      const upload = await store.createMultipartUpload("workspace/memo/archive.bin");
      const second = await upload.uploadPart(2, new Uint8Array([4, 5]));
      const first = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
      await upload.complete([first, second]);

      expect(await readFile(`${directory}/workspace/memo/archive.bin`)).toEqual(
        new Uint8Array([1, 2, 3, 4, 5]),
      );
      expect(await store.get(`.uploads/${upload.uploadId}/1.part`)).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects attachment path traversal", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-storage-`);
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };

    try {
      const adapter = createSelfHostedStorageAdapter(sqlite, directory);
      await expect(adapter.resources.put("../outside", new Uint8Array([1]))).rejects.toThrow(
        "Invalid resource object key",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("maps the common object operations to an S3-compatible client", async () => {
    const commands: string[] = [];
    const client = {
      send: async (command: { constructor: { name: string }; input: { Key?: string } }) => {
        commands.push(`${command.constructor.name}:${command.input.Key ?? ""}`);
        if (command.constructor.name === "GetObjectCommand") {
          return { Body: new Blob(["edgeever"]), ContentLength: 8, ContentType: "text/plain" };
        }
        return {};
      },
    };
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };
    const adapter = createS3CompatibleStorageAdapter(
      sqlite,
      { bucket: "edgeever", endpoint: "http://minio:9000" },
      client as never,
    );
    expect(adapter.diagnostics).toEqual({
      database: "sqlite",
      resources: "s3",
      migrationTable: "_edgeever_migrations",
    });

    await adapter.resources.put("memo/image.txt", new Uint8Array([1]), {
      httpMetadata: { contentType: "text/plain" },
    });
    expect(await adapter.resources.get("memo/image.txt")).not.toBeNull();
    await adapter.resources.delete(["memo/image.txt", "memo/other.txt"]);
    expect(commands).toEqual([
      "PutObjectCommand:memo/image.txt",
      "GetObjectCommand:memo/image.txt",
      "DeleteObjectsCommand:",
    ]);
  });

  test("maps multipart lifecycle operations to an S3-compatible client", async () => {
    const commands: string[] = [];
    const client = {
      send: async (command: { constructor: { name: string }; input: { PartNumber?: number } }) => {
        commands.push(`${command.constructor.name}:${command.input.PartNumber ?? ""}`);
        if (command.constructor.name === "CreateMultipartUploadCommand") return { UploadId: "provider-upload" };
        if (command.constructor.name === "UploadPartCommand") return { ETag: `etag-${command.input.PartNumber}` };
        return {};
      },
    };
    const sqlite = {
      query: () => ({ all: () => [], get: () => null, run: () => undefined }),
      transaction: (callback: () => void) => () => callback(),
    };
    const store = createS3CompatibleStorageAdapter(
      sqlite,
      { bucket: "edgeever", endpoint: "http://minio:9000" },
      client as never,
    ).resources;

    const upload = await store.createMultipartUpload("memo/archive.bin");
    const part = await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
    await upload.complete([part]);

    expect(part).toEqual({ partNumber: 1, etag: "etag-1" });
    expect(commands).toEqual([
      "CreateMultipartUploadCommand:",
      "UploadPartCommand:1",
      "CompleteMultipartUploadCommand:",
    ]);
  });
});
