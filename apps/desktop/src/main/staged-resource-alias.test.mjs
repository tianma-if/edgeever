import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  cacheStagedResourceBytes,
  listPendingStagedResources,
  listStagedResourceMetadata,
  readStagedResourceMetadata,
  recordStagedResourceAlias,
  uploadedResourceIdFromUrl,
} from "./staged-resource-alias.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("upgrades an old staged file to a durable resource alias before deleting its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "edgeever-stage-alias-"));
  roots.push(root);
  const oldMetadata = { id: "stage_123", memoId: "memo_1", name: "photo.jpg", type: "image/jpeg", size: 4 };
  await writeFile(join(root, "stage_123.json"), JSON.stringify(oldMetadata));
  await writeFile(join(root, "stage_123.bin"), "jpeg");
  expect(await listPendingStagedResources(root)).toEqual([oldMetadata]);

  const cache = join(root, "cache");
  await cacheStagedResourceBytes(root, cache, "stage_123", "/api/v1/resources/res_uploaded/blob");
  const aliased = await recordStagedResourceAlias(root, "stage_123", "/api/v1/resources/res_uploaded/blob");
  expect(aliased).toEqual({ ...oldMetadata, resourceId: "res_uploaded" });
  expect(JSON.parse(await readFile(join(root, "stage_123.json"), "utf8"))).toEqual(aliased);
  await unlink(join(root, "stage_123.bin"));
  expect(await listPendingStagedResources(root)).toEqual([]);
  expect(await listStagedResourceMetadata(root)).toEqual([aliased]);
  expect((await readStagedResourceMetadata(root, "stage_123")).resourceId).toBe("res_uploaded");
  expect((await readFile(join(cache, "res_uploaded.bin"))).toString()).toBe("jpeg");
  expect(JSON.parse(await readFile(join(cache, "res_uploaded.json"), "utf8"))).toEqual({ contentType: "image/jpeg", byteSize: 4, sha256: createHash("sha256").update("jpeg").digest("hex") });
});

test("rejects an invalid or conflicting uploaded resource mapping", async () => {
  const root = await mkdtemp(join(tmpdir(), "edgeever-stage-alias-"));
  roots.push(root);
  await writeFile(join(root, "stage_123.json"), JSON.stringify({ id: "stage_123", memoId: "memo_1", name: "photo.jpg" }));
  expect(uploadedResourceIdFromUrl("https://example.com/api/v1/resources/res_1/blob")).toBe("res_1");
  expect(uploadedResourceIdFromUrl("/api/v1/resources/../../secret/blob")).toBeNull();
  await expect(recordStagedResourceAlias(root, "stage_123", "https://example.com/not-a-resource")).rejects.toThrow();
  await recordStagedResourceAlias(root, "stage_123", "/api/v1/resources/res_1/blob");
  await expect(recordStagedResourceAlias(root, "stage_123", "/api/v1/resources/res_2/blob")).rejects.toThrow();
});
