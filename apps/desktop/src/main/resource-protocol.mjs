import { createReadStream } from "node:fs";
import { once } from "node:events";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import { downloadContentDispositionFromRequest, isSafeResourceId, parseByteRangeHeader, resourceIdFromRequest, resourceResponseHeaders } from "./resource-url.mjs";
import { readStagedResourceMetadata } from "./staged-resource-alias.mjs";

const fileResponse = async (path, contentType, request) => {
  const { size } = await stat(path);
  const range = parseByteRangeHeader(request.headers.get("range"), size);
  const headers = resourceResponseHeaders(contentType, downloadContentDispositionFromRequest(request.url));
  headers.set("Accept-Ranges", "bytes");
  if (range.kind === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const selected = range.kind === "range" ? range : { offset: 0, length: size };
  headers.set("Content-Length", String(selected.length));
  if (size === 0) return new Response(null, { status: 200, headers });
  if (range.kind === "range") {
    headers.set("Content-Range", `bytes ${selected.offset}-${selected.offset + selected.length - 1}/${size}`);
  }
  const stream = createReadStream(path, {
    start: selected.offset,
    end: selected.offset + selected.length - 1,
  });
  // Detect a staged file removed during sync before returning the response.
  await once(stream, "open");
  return new Response(Readable.toWeb(stream), {
    status: range.kind === "range" ? 206 : 200,
    headers,
  });
};

export const createStagedResourceProtocolHandler = (options) => async (request, assertCurrent = () => {}) => {
  assertCurrent();
  const stagedId = resourceIdFromRequest(request.url);
  if (!stagedId) return new Response("Invalid staged resource", { status: 400 });
  const directory = options.getDirectory();
  try {
    const metadata = await readStagedResourceMetadata(directory, stagedId);
    try {
      return await fileResponse(join(directory, `${stagedId}.bin`), metadata.type, request);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Sync records the alias before removing staged bytes. Refresh metadata
      // if the file disappeared after the first read.
      const resourceId = metadata.resourceId ?? (await readStagedResourceMetadata(directory, stagedId)).resourceId;
      if (!isSafeResourceId(resourceId)) throw error;
      const target = new URL(`edgeever-resource://resource/${encodeURIComponent(resourceId)}`);
      target.search = new URL(request.url).search;
      assertCurrent();
      return options.readUploadedResource(new Request(target, { headers: request.headers, signal: request.signal }), assertCurrent);
    }
  } catch (error) {
    void options.onError?.(stagedId, error);
    return new Response("Staged resource unavailable", { status: 404 });
  }
};

// Keep only active reads and disk writes. Network waits never hold the write queue.
export const createResourceCacheWrites = () => {
  const readers = new Map();
  const writes = new Map();
  const enqueue = (path, write) => {
    const previous = writes.get(path);
    const next = (previous ?? Promise.resolve()).then(write);
    const tail = next.catch(() => {}).finally(() => {
      if (writes.get(path) === tail) writes.delete(path);
    });
    writes.set(path, tail);
    return next;
  };
  return {
    observe(path) {
      const group = readers.get(path) ?? { count: 0 };
      group.count++;
      readers.set(path, group);
      return {
        publish: write => enqueue(path, () => {
          if (readers.get(path) === group) return write();
        }),
        release() {
          if (--group.count === 0 && readers.get(path) === group) readers.delete(path);
        },
      };
    },
    replace(path, write) {
      return enqueue(path, async () => {
        try { return await write(); }
        // Include reads that saw the old files while the replacement was being written.
        finally { readers.delete(path); }
      });
    },
  };
};

export const createResourceProtocolHandler = options => {
  const verifiedFiles = new Map();
  const cacheWrites = options.cacheWrites ?? createResourceCacheWrites();
  const serve = async (request, assertCurrent, resourceId, bytesPath, cacheRead) => {
    const downloadDisposition = downloadContentDispositionFromRequest(request.url);
    const directory = dirname(bytesPath);
    const metadataPath = join(directory, `${resourceId}.json`);
    let damagedCache = false;

    const cachedResponse = async () => {
      let metadata = {};
      try {
        const value = JSON.parse(await readFile(metadataPath, "utf8"));
        if (value && typeof value === "object") metadata = value;
      } catch {}
      const info = await stat(bytesPath);
      const { size } = info;
      // Older versions only recorded contentType. Use the synced catalog to
      // validate those files too, without requesting every attachment from API.
      const hasIntegrity = Number.isSafeInteger(metadata.byteSize) && /^[a-f0-9]{64}$/i.test(metadata.sha256 ?? "");
      let integrity = hasIntegrity
        ? metadata : await options.getIntegrity?.(resourceId);
      assertCurrent();
      // The local catalog is populated lazily, so some legacy cache entries
      // have no synced resource row. HEAD validates those without listing or
      // downloading all attachments. Unverifiable legacy bytes stay on disk.
      if (!integrity && options.getApiBaseUrl()) {
        const url = `${options.getApiBaseUrl()}/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
        const headers = await options.getRequestHeaders(url);
        assertCurrent();
        const response = await options.fetch(url, { method: "HEAD", headers, redirect: "error", signal: request.signal, cache: "no-store" });
        await response.body?.cancel().catch(() => {});
        assertCurrent();
        const length = response.headers.get("content-length");
        if (response.ok && length !== null && /^\d+$/.test(length)) integrity = { byteSize: Number(length) };
      }
      if (!integrity) throw new Error("Resource cache integrity unavailable; connect to verify this legacy file");
      if (size !== integrity.byteSize) throw new Error("Resource cache size mismatch");
      const fingerprint = `${size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}:${integrity.sha256}`;
      // Video/audio range requests repeatedly open the same file. Hash once per
      // unchanged file, rather than scanning a large attachment for every range.
      if (verifiedFiles.get(bytesPath) !== fingerprint) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(bytesPath)) hash.update(chunk);
        const digest = hash.digest("hex");
        if (/^[a-f0-9]{64}$/i.test(integrity.sha256 ?? "") && digest !== integrity.sha256.toLowerCase()) throw new Error("Resource cache checksum mismatch");
        if (!hasIntegrity) {
          const temporaryMetadata = `${metadataPath}.${randomUUID()}.pending`;
          try {
            await writeFile(temporaryMetadata, JSON.stringify({ ...metadata, byteSize: size, sha256: digest }), { mode: 0o600 });
            await cacheRead.publish(async () => {
              assertCurrent();
              await rename(temporaryMetadata, metadataPath);
            });
          } finally { await rm(temporaryMetadata, { force: true }); }
        }
        if (verifiedFiles.size >= 256) verifiedFiles.delete(verifiedFiles.keys().next().value);
        verifiedFiles.set(bytesPath, fingerprint);
      }
      assertCurrent();
      return fileResponse(bytesPath, metadata.contentType, request);
    };
    if (request.cache !== "reload") {
      try { return await cachedResponse(); } catch (error) {
        assertCurrent();
        if (error.code !== "ENOENT") {
          damagedCache = true;
          void options.onError?.(resourceId, error);
        }
        // Fall through to the instance while online, then persist the response.
      }
    }

    const configuredApiBaseUrl = options.getApiBaseUrl();
    if (!configuredApiBaseUrl) return new Response("Resource is not cached", { status: 504 });
    const sourceUrl = `${configuredApiBaseUrl}/api/v1/resources/${encodeURIComponent(resourceId)}/blob`;
    try {
      assertCurrent();
      const headers = await options.getRequestHeaders(sourceUrl);
      assertCurrent();
      const rangeHeader = request.headers.get("range");
      // Repair the whole file, bypassing Chromium's HTTP cache as well. Returning
      // 200 to a Range request is permitted; subsequent ranges use the new cache.
      if (rangeHeader && !damagedCache) headers.set("range", rangeHeader);
      const response = await options.fetch(sourceUrl, { headers, redirect: "error", signal: request.signal, cache: request.cache === "reload" || damagedCache ? "no-store" : "default" });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        assertCurrent();
        if (request.cache === "reload" && response.status >= 500 && response.status <= 599) {
          let cached;
          try { cached = await cachedResponse(); assertCurrent(); return cached; } catch {
            await cached?.body?.cancel().catch(() => {});
            assertCurrent(); // A cache miss must not hide a scope change.
          }
        }
        return new Response("Resource request failed", { status: response.status });
      }
      if (response.status === 206) {
        const responseHeaders = resourceResponseHeaders(response.headers.get("content-type"), downloadDisposition);
        responseHeaders.set("Accept-Ranges", response.headers.get("accept-ranges") || "bytes");
        for (const name of ["content-length", "content-range", "etag", "last-modified"]) {
          const value = response.headers.get(name);
          if (value) responseHeaders.set(name, value);
        }
        if (downloadDisposition) responseHeaders.set("Content-Disposition", downloadDisposition);
        return new Response(response.body, { status: 206, headers: responseHeaders });
      }
      if (!response.body) return new Response("Resource response body is empty", { status: 502 });
      await mkdir(directory, { recursive: true });
      await restrictDirectory(directory);
      const temporaryPath = `${bytesPath}.download-${randomUUID()}`;
      const output = await open(temporaryPath, "w", 0o600);
      const reader = response.body.getReader();
      const declaredLength = response.headers.get("content-length");
      const expectedLength = declaredLength !== null && /^\d+$/.test(declaredLength)
        ? Number(declaredLength) : null;
      const hash = createHash("sha256");
      let byteSize = 0;
      let cancelled = false;
      let inFlight;
      let finished = false;
      const cleanup = async (published = false) => {
        if (!finished) {
          finished = true;
          cacheRead.release();
          if (published) return;
          await output.close().catch(() => {});
          await rm(temporaryPath, { force: true }).catch(() => {});
        }
      };
      const streamedBody = new ReadableStream({
        pull(controller) {
          inFlight = (async () => {
            try {
              const next = await reader.read();
              if (cancelled) return;
              assertCurrent();
              if (next.done) {
                if (expectedLength !== null && byteSize !== expectedLength) {
                  throw new Error(`Resource download size mismatch: expected ${expectedLength}, received ${byteSize}`);
                }
                await output.close();
                if (cancelled) return;
                const published = await cacheRead.publish(async () => {
                  if (cancelled) return;
                  assertCurrent();
                  await rename(temporaryPath, bytesPath);
                  await writeFile(metadataPath, JSON.stringify({ contentType: response.headers.get("content-type") || "application/octet-stream", byteSize, sha256: hash.digest("hex") }), { mode: 0o600 });
                  await restrictFile(bytesPath);
                  await restrictFile(metadataPath);
                  return true;
                });
                await cleanup(published);
                if (cancelled) return;
                controller.close();
                return;
              }
              // FileHandle.write may perform a short write. writeFile drains the
              // entire chunk before advancing to the next one.
              await output.writeFile(next.value);
              byteSize += next.value.byteLength;
              hash.update(next.value);
              if (expectedLength !== null && byteSize > expectedLength) throw new Error("Resource download exceeds declared size");
              if (cancelled) return;
              controller.enqueue(next.value);
            } catch (error) {
              await reader.cancel(error).catch(() => {});
              await cleanup();
              void options.onError?.(resourceId, error);
              if (!cancelled) controller.error(error);
            }
          })();
          return inFlight;
        },
        async cancel(reason) {
          // Set this before reader.cancel: it resolves a pending read with done,
          // which must never be mistaken for a successful download completion.
          cancelled = true;
          await reader.cancel(reason).catch(() => {});
          await inFlight;
          await cleanup();
        },
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", "no-store");
      if (downloadDisposition) responseHeaders.set("Content-Disposition", downloadDisposition);
      const result = new Response(streamedBody, { status: 200, headers: responseHeaders });
      cacheRead.streaming = true;
      return result;
    } catch (error) {
      assertCurrent();
      if (request.cache === "reload") {
        try { return await cachedResponse(); } catch { /* No offline copy. */ }
      }
      void options.onError?.(resourceId, error);
      return new Response("Resource unavailable", { status: 504 });
    }
  };
  return async (request, assertCurrent = () => {}) => {
    assertCurrent();
    const resourceId = resourceIdFromRequest(request.url);
    if (!resourceId) return new Response("Invalid resource", { status: 400 });
    const bytesPath = join(options.getDirectory(), `${resourceId}.bin`);
    const read = cacheWrites.observe(bytesPath);
    try { return await serve(request, assertCurrent, resourceId, bytesPath, read); }
    finally { if (!read.streaming) read.release(); }
  };
};
