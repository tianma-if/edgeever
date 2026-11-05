import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { restrictDirectory, restrictFile } from "./file-permissions.mjs";
import { downloadContentDispositionFromRequest, parseByteRangeHeader, resourceIdFromRequest, resourceResponseHeaders } from "./resource-url.mjs";

export const createResourceProtocolHandler = options => async (request, assertCurrent = () => {}) => {
  assertCurrent();
  const resourceId = resourceIdFromRequest(request.url);
  if (!resourceId) return new Response("Invalid resource", { status: 400 });
  const downloadDisposition = downloadContentDispositionFromRequest(request.url);

  const directory = options.getDirectory();
  const bytesPath = join(directory, `${resourceId}.bin`);
  const metadataPath = join(directory, `${resourceId}.json`);

  const fileResponse = async (path, contentType, rangeHeader) => {
    const { size } = await stat(path);
    const range = parseByteRangeHeader(rangeHeader, size);
    const headers = resourceResponseHeaders(contentType, downloadDisposition);
    headers.set("Accept-Ranges", "bytes");
    if (range.kind === "invalid") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const selected = range.kind === "range" ? range : { offset: 0, length: size };
    headers.set("Content-Length", String(selected.length));
    if (range.kind === "range") {
      headers.set("Content-Range", `bytes ${selected.offset}-${selected.offset + selected.length - 1}/${size}`);
    }
    const stream = createReadStream(path, {
      start: selected.offset,
      end: selected.offset + selected.length - 1,
    });
    return new Response(Readable.toWeb(stream), {
      status: range.kind === "range" ? 206 : 200,
      headers,
    });
  };

  const cachedResponse = async () => {
    let metadata = {};
    try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); } catch {}
    return fileResponse(bytesPath, metadata.contentType, request.headers.get("range"));
  };
  if (request.cache !== "reload") {
    try { return await cachedResponse(); } catch {
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
    if (rangeHeader) headers.set("range", rangeHeader);
    const response = await options.fetch(sourceUrl, { headers, redirect: "error", signal: request.signal, cache: request.cache === "reload" ? "no-store" : "default" });
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
    let finished = false;
    const cleanup = async () => {
      if (!finished) {
        finished = true;
        await output.close().catch(() => {});
        await rm(temporaryPath, { force: true }).catch(() => {});
      }
    };
    const streamedBody = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            await output.close();
            await rename(temporaryPath, bytesPath);
            await writeFile(metadataPath, JSON.stringify({ contentType: response.headers.get("content-type") || "application/octet-stream" }), { mode: 0o600 });
            await restrictFile(bytesPath);
            await restrictFile(metadataPath);
            finished = true;
            controller.close();
            return;
          }
          await output.write(next.value);
          controller.enqueue(next.value);
        } catch (error) {
          await cleanup();
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
        await cleanup();
      },
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Cache-Control", "no-store");
    if (downloadDisposition) responseHeaders.set("Content-Disposition", downloadDisposition);
    return new Response(streamedBody, { status: 200, headers: responseHeaders });
  } catch (error) {
    assertCurrent();
    if (request.cache === "reload") {
      try { return await cachedResponse(); } catch { /* No offline copy. */ }
    }
    void options.onError?.(resourceId, error);
    return new Response("Resource unavailable", { status: 504 });
  }
};
