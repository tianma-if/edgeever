import { parseAccept } from "hono/utils/accept";
import { extname, join, relative, resolve } from "node:path";
import { isPublicPagePath, PUBLIC_PAGE_HEADERS } from "../packages/shared/src/public-page-headers.ts";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const immutable = "public, max-age=31536000, immutable";
const fresh = "no-cache, no-store, must-revalidate";

// Vite writes hashed files to assets/. Files copied from public/ keep their
// original names and must not receive immutable caching.
const isFingerprintedAsset = (path) => /^assets\/[^/]+-[\w-]{8}\.[a-z0-9]+$/.test(path);
export const isCompressibleAsset = (path) => isFingerprintedAsset(path) && /\.(?:css|m?js|json|svg)$/.test(path);

const gzipQuality = (request) => {
  const encodings = parseAccept(request.headers.get("Accept-Encoding") ?? "");
  const quality = (name) => encodings.find(({ type }) => type.toLowerCase() === name)?.q;
  const wildcard = quality("*");
  return {
    gzip: quality("gzip") ?? wildcard ?? 0,
    identity: quality("identity") ?? (wildcard === 0 ? 0 : undefined),
  };
};

const sendFile = (request, file, headers) => {
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(file.size));
    return new Response(null, { headers });
  }
  return new Response(file, { headers });
};

export const serveSelfHostedStatic = async (request, webDirectory) => {
  const { pathname } = new URL(request.url);
  const candidate = resolve(webDirectory, pathname === "/" ? "index.html" : `.${pathname}`);
  const path = relative(webDirectory, candidate);

  if (path.startsWith("..") || (path.endsWith(".gz") && isCompressibleAsset(path.slice(0, -3)))) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(candidate);
  const compressible = isCompressibleAsset(path);
  const compressed = compressible ? Bun.file(`${candidate}.gz`) : null;
  const hasGzip = compressed !== null && await compressed.exists();
  const { gzip, identity } = compressible ? gzipQuality(request) : {};
  const sendGzip = hasGzip && gzip > 0 && gzip >= (identity ?? 0);
  const hasIdentity = !sendGzip && path && await file.exists();
  if (hasGzip || hasIdentity) {
    const extension = extname(path);
    const headers = new Headers({ "Content-Type": contentTypes[extension] ?? "application/octet-stream" });
    if (isPublicPagePath(pathname)) {
      for (const [name, value] of Object.entries(PUBLIC_PAGE_HEADERS)) headers.set(name, value);
    } else if (isFingerprintedAsset(path)) {
      headers.set("Cache-Control", immutable);
    } else if (extension === ".html" || path === "sw.js" || path === "manifest.webmanifest") {
      headers.set("Cache-Control", fresh);
    }

    if (compressible) {
      headers.set("Vary", "Accept-Encoding");
      if (sendGzip) {
        headers.set("Content-Encoding", "gzip");
        return sendFile(request, compressed, headers);
      }
      if (identity === 0) {
        return new Response(null, { status: 406, headers: { Vary: "Accept-Encoding" } });
      }
      if (!hasIdentity) {
        if (request.method === "HEAD") {
          // The gzip trailer records the original size of the build's single member.
          const trailer = await compressed.slice(-4).arrayBuffer();
          headers.set("Content-Length", String(new DataView(trailer).getUint32(0, true)));
          return new Response(null, { headers });
        }
        return new Response(compressed.stream().pipeThrough(new DecompressionStream("gzip")), { headers });
      }
    }
    return sendFile(request, file, headers);
  }

  // A stale chunk URL after an upgrade must not return the SPA shell as JS.
  if (path.startsWith("assets/")) {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const index = Bun.file(join(webDirectory, "index.html"));
  if (!await index.exists()) {
    return new Response("Web build not found. Run bun run build:web first.", { status: 503 });
  }
  const headers = new Headers({
    "Content-Type": contentTypes[".html"],
    "Cache-Control": fresh,
    ...(isPublicPagePath(pathname) ? PUBLIC_PAGE_HEADERS : {}),
  });
  return sendFile(request, index, headers);
};
