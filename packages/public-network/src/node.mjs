import { lookup } from "node:dns";
import { request } from "node:https";
import { createBrotliDecompress, createUnzip } from "node:zlib";
import { isPublicAddress, validatePublicUrl } from "./policy.mjs";

export function createPublicLookup(resolve = lookup) { return (hostname, options, callback) => {
  resolve(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) { callback(error, "", 0); return; }
    if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) { callback(new Error("The destination does not resolve exclusively to public addresses."), "", 0); return; }
    const candidates = options.family ? addresses.filter(entry => entry.family === options.family) : addresses;
    if (!candidates.length) { callback(new Error("No public address in the requested family."), "", 0); return; }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0].address, candidates[0].family);
  });
}; }
export const publicLookup = createPublicLookup();

export async function nodePublicFetch(input, init = {}) {
  const url = validatePublicUrl(input);
  init.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    const req = request(url, { method: init.method ?? "GET", headers: { ...headers, "accept-encoding": "identity" }, lookup: publicLookup, agent: false, signal: init.signal ?? undefined }, incoming => {
      const encoding = incoming.headers["content-encoding"];
      const stream = encoding === "gzip" || encoding === "deflate" ? incoming.pipe(createUnzip()) : encoding === "br" ? incoming.pipe(createBrotliDecompress()) : incoming;
      if (encoding && !["identity", "gzip", "deflate", "br"].includes(encoding)) { incoming.destroy(); reject(new Error("Unsupported response encoding.")); return; }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined && !["content-encoding", "content-length", "transfer-encoding"].includes(key)) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      const iterator = stream[Symbol.asyncIterator]();
      const abort = () => { incoming.destroy(); stream.destroy(); };
      init.signal?.addEventListener("abort", abort, { once: true });
      const cleanUp = () => { init.signal?.removeEventListener("abort", abort); };
      const status = incoming.statusCode ?? 502;
      if (init.method === "HEAD" || [204, 205, 304].includes(status)) { abort(); cleanUp(); resolve(new Response(null, { status, headers: responseHeaders })); return; }
      const body = new ReadableStream({
        async pull(controller) { try { init.signal?.throwIfAborted(); const chunk = await iterator.next(); init.signal?.throwIfAborted(); if (chunk.done) { cleanUp(); controller.close(); } else controller.enqueue(new Uint8Array(chunk.value)); } catch (error) { cleanUp(); controller.error(error); abort(); } },
        cancel() { cleanUp(); abort(); },
      });
      resolve(new Response(body, { status, statusText: incoming.statusMessage, headers: responseHeaders }));
    });
    req.on("error", reject); req.end();
  });
}
