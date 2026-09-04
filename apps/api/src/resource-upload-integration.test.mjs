import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchEdgeEverApp } from "./index.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import { createEdgeEverClient } from "../../../packages/client/src/index.ts";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const requestJson = async (environment, path, init = {}) => {
  const response = await fetchEdgeEverApp(
    new Request(`http://edgeever.test${path}`, init),
    environment,
    { waitUntil: () => undefined, passThroughOnException: () => undefined },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
};

describe("resource upload integration", () => {
  test("uploads small images directly and assembles large resources through the filesystem adapter", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-upload-integration-`);
    temporaryDirectories.push(directory);
    const database = new Database(join(directory, "edgeever.sqlite"), { create: true });
    database.exec("PRAGMA foreign_keys = ON");
    const migrationDirectory = new URL("../../../migrations/", import.meta.url);
    for (const name of (await readdir(migrationDirectory)).filter((value) => value.endsWith(".sql")).sort()) {
      database.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    }
    database.query(
      "INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)",
    ).run();

    const resourcesDirectory = join(directory, "resources");
    const environment = {
      storage: createSelfHostedStorageAdapter(database, resourcesDirectory),
      EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
      EDGE_EVER_RUNTIME: "self-hosted-bun",
    };
    const notebook = await requestJson(environment, "/api/v1/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Uploads" }),
    });
    const memo = await requestJson(environment, "/api/v1/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notebookId: notebook.notebook.id, title: "Multipart", contentMarkdown: "" }),
    });

    const uploadPaths = [];
    const client = createEdgeEverClient({
      baseUrl: "http://edgeever.test",
      fetch: (input, init) => {
        uploadPaths.push(new URL(input).pathname);
        return fetchEdgeEverApp(new Request(input, init), environment,
          { waitUntil: () => undefined, passThroughOnException: () => undefined });
      },
    });
    const smallImage = new File([
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
    ], "small.png", { type: "image/png" });
    const images = await Promise.all([0, 1].map(() => client.uploadMemoResource(memo.memo.id, smallImage)));
    expect(uploadPaths).toEqual(Array(2).fill(`/api/v1/memos/${memo.memo.id}/resources`));
    for (const { resource } of images) {
      expect(resource).toMatchObject({ filename: "small.png", kind: "image", mimeType: "image/png", byteSize: smallImage.size });
      const imageRow = database.query("SELECT object_key FROM resources WHERE id = ?").get(resource.id);
      expect(await readFile(join(resourcesDirectory, imageRow.object_key)))
        .toEqual(Buffer.from(await smallImage.arrayBuffer()));
    }

    const file = new Uint8Array(8 * 1024 * 1024 + 3);
    file.fill(7);
    file.set([1, 2, 3], file.byteLength - 3);
    const started = await requestJson(environment, `/api/v1/memos/${memo.memo.id}/resource-uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "archive.bin", mimeType: "application/octet-stream", byteSize: file.byteLength }),
    });
    expect(started.upload.partCount).toBe(2);

    for (let partNumber = 1; partNumber <= started.upload.partCount; partNumber += 1) {
      const start = (partNumber - 1) * started.upload.partSize;
      const chunk = file.slice(start, Math.min(start + started.upload.partSize, file.byteLength));
      await requestJson(environment, `/api/v1/resource-uploads/${started.upload.id}/parts/${partNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "Content-Length": String(chunk.byteLength) },
        body: chunk,
      });
    }
    const completed = await requestJson(environment, `/api/v1/resource-uploads/${started.upload.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(completed.resource).toMatchObject({
      memoId: memo.memo.id,
      filename: "archive.bin",
      byteSize: file.byteLength,
      sha256: null,
    });
    const row = database.query("SELECT object_key FROM resources WHERE id = ?").get(completed.resource.id);
    expect(await readFile(join(resourcesDirectory, row.object_key))).toEqual(file);
    expect(database.query("SELECT COUNT(*) AS count FROM resource_uploads").get().count).toBe(0);

    const restoredBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const restoredMetadata = {
      id: "res_restored",
      memoId: memo.memo.id,
      originalMemoId: null,
      kind: "attachment",
      mimeType: "application/octet-stream",
      filename: "restored.bin",
      byteSize: restoredBytes.byteLength,
      sha256: "backup-checksum",
      width: null,
      height: null,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
      archivePath: "resources/res_restored/restored.bin",
    };
    const restoreStarted = await requestJson(
      environment,
      "/api/v1/restores/json/resources/res_restored/uploads",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoredMetadata),
      },
    );
    expect(restoreStarted.upload.resourceId).toBe("res_restored");
    await requestJson(environment, `/api/v1/resource-uploads/${restoreStarted.upload.id}/parts/1`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(restoredBytes.byteLength),
      },
      body: restoredBytes,
    });
    const restored = await requestJson(environment, `/api/v1/resource-uploads/${restoreStarted.upload.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(restored.resource).toMatchObject({
      id: "res_restored",
      memoId: memo.memo.id,
      filename: "restored.bin",
      byteSize: restoredBytes.byteLength,
      sha256: "backup-checksum",
    });
    const restoredRow = database.query("SELECT object_key FROM resources WHERE id = ?").get("res_restored");
    expect(await readFile(join(resourcesDirectory, restoredRow.object_key))).toEqual(restoredBytes);
    database.close();
  });
});
