import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isSafeResourceId } from "./resource-url.mjs";

export const uploadedResourceIdFromUrl = (value) => {
  try {
    const url = new URL(value, "https://edgeever.invalid");
    const match = /^\/api\/v1\/resources\/([^/]+)\/blob$/.exec(url.pathname);
    const id = match ? decodeURIComponent(match[1]) : null;
    return isSafeResourceId(id) ? id : null;
  } catch {
    return null;
  }
};

export const readStagedResourceMetadata = async (directory, id) => {
  if (!isSafeResourceId(id)) throw new Error("Invalid staged resource id");
  const metadata = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));
  if (metadata.id !== id) throw new Error("Staged resource metadata mismatch");
  return metadata;
};

export const recordStagedResourceAlias = async (directory, id, uploadedUrl) => {
  const resourceId = uploadedResourceIdFromUrl(uploadedUrl);
  if (!resourceId) throw new Error("Invalid uploaded resource URL");
  const metadata = await readStagedResourceMetadata(directory, id);
  if (metadata.resourceId && metadata.resourceId !== resourceId) {
    throw new Error("Staged resource already maps to another resource");
  }
  const next = { ...metadata, resourceId };
  const temporary = join(directory, `${id}.alias-pending.json`);
  try {
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, join(directory, `${id}.json`));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return next;
};

export const cacheStagedResourceBytes = async (stagedDirectory, cacheDirectory, id, uploadedUrl) => {
  const resourceId = uploadedResourceIdFromUrl(uploadedUrl);
  if (!resourceId) throw new Error("Invalid uploaded resource URL");
  const metadata = await readStagedResourceMetadata(stagedDirectory, id);
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const pendingPath = join(cacheDirectory, `${resourceId}.${randomUUID()}.pending`);
  try {
    await copyFile(join(stagedDirectory, `${id}.bin`), pendingPath);
    const { size } = await stat(pendingPath);
    if (size !== metadata.size) throw new Error("Staged resource cache size mismatch");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(pendingPath)) hash.update(chunk);
    await rename(pendingPath, join(cacheDirectory, `${resourceId}.bin`));
    await writeFile(join(cacheDirectory, `${resourceId}.json`), JSON.stringify({ contentType: metadata.type, byteSize: size, sha256: hash.digest("hex") }), { mode: 0o600 });
  } catch (error) {
    await rm(pendingPath, { force: true }).catch(() => {});
    throw error;
  }
  return resourceId;
};

export const listStagedResourceMetadata = async (directory) => {
  const names = await readdir(directory).catch(() => []);
  const result = [];
  for (const name of names.filter((value) => value.endsWith(".json") && !value.endsWith(".pending.json") && !value.endsWith(".alias-pending.json"))) {
    const id = name.slice(0, -5);
    try { result.push(await readStagedResourceMetadata(directory, id)); } catch {}
  }
  return result;
};

export const listPendingStagedResources = async (directory) => {
  const metadata = await listStagedResourceMetadata(directory);
  const present = await Promise.all(metadata.map(async (item) => (
    await stat(join(directory, `${item.id}.bin`)).then(() => true).catch(() => false)
  )));
  return metadata.filter((_, index) => present[index]);
};
