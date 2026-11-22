import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import sharp from "sharp";
import { createCloudflareImageThumbnailAdapter } from "./cloudflare-image-adapter.ts";
import { fetchEdgeEverApp } from "./index.ts";
import {
  buildThumbnailEtag,
  buildThumbnailObjectKey,
  matchesIfNoneMatch,
  resolveThumbnailVersionKey,
} from "./image-thumbnail.ts";
import { deleteMemosRecord, emptyTrashMemosRecord } from "./memo-service.ts";
import { registerResourceRoutes } from "./resource-routes.ts";
import {
  deleteReleasedResourceObjects,
  getResourceRow,
  replaceResourceContent,
} from "./resource-service.ts";
import { createSelfHostedStorageAdapter } from "./self-hosted-storage-adapter.ts";
import {
  createSelfHostedImageThumbnailAdapter,
  resizeWithImageScript,
} from "../../../scripts/self-hosted-image-thumbnail.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
});

const baseAuth = {
  kind: "agent",
  actorType: "agent",
  actorId: "token_1",
  username: "automation",
  displayName: null,
  scopes: ["read:resources", "write:resources"],
  workspaceId: "ws_1",
  role: "member",
};

const createInMemoryStore = (initial = {}) => {
  const objects = new Map();
  const gets = [];
  const puts = [];
  const deletes = [];

  for (const [key, value] of Object.entries(initial)) {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
    objects.set(key, { bytes, metadata: {} });
  }

  return {
    objects,
    gets,
    puts,
    deletes,
    store: {
      async get(key, options) {
        gets.push({ key, options });
        const entry = objects.get(key);
        if (!entry) return null;
        const totalSize = entry.bytes.byteLength;
        const range = options?.range;
        const slice = range
          ? entry.bytes.subarray(range.offset, range.offset + range.length)
          : entry.bytes;
        return {
          body: new Blob([slice]).stream(),
          size: totalSize,
          ...(range ? { range: { offset: range.offset, length: slice.byteLength } } : {}),
          writeHttpMetadata: (headers) => {
            if (entry.metadata?.contentType) headers.set("Content-Type", entry.metadata.contentType);
            if (entry.metadata?.cacheControl) headers.set("Cache-Control", entry.metadata.cacheControl);
          },
        };
      },
      async put(key, value, options) {
        puts.push({ key, options });
        const bytes = value instanceof Uint8Array
          ? new Uint8Array(value)
          : new Uint8Array(await new Response(value).arrayBuffer());
        objects.set(key, { bytes, metadata: options?.httpMetadata ?? {} });
      },
      async createMultipartUpload() {
        throw new Error("Unexpected multipart upload");
      },
      resumeMultipartUpload() {
        throw new Error("Unexpected multipart upload");
      },
      async delete(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) {
          deletes.push(key);
          objects.delete(key);
        }
      },
    },
  };
};

const createMockApp = ({
  authProvider = () => baseAuth,
  resourceProvider,
  dbOverrides = {},
  storeWrapper,
  resizeImageThumbnail,
}) => {
  const app = new Hono();
  app.onError((error, context) => context.json({ error: { message: error.message } }, 500));
  app.use("/api/v1/*", async (context, next) => {
    context.set("auth", authProvider());
    await next();
  });
  registerResourceRoutes(app, {
    clampNumber: (value, min, max) => Math.min(Math.max(value, min), max),
    createAttachmentResource: async () => { throw new Error("Unexpected upload"); },
    createImageResource: async () => { throw new Error("Unexpected upload"); },
    getMemoDetail: async () => null,
    getResourceRow: resourceProvider,
    initiateResourceUpload: async () => { throw new Error("Unexpected"); },
    uploadResourcePart: async () => { throw new Error("Unexpected"); },
    completeResourceUpload: async () => { throw new Error("Unexpected"); },
    abortResourceUpload: async () => { throw new Error("Unexpected"); },
    replaceResourceContent,
  });

  const env = {
    resizeImageThumbnail,
    storage: {
      db: {
        prepare: (sql) => ({
          first: async () => null,
          bind: (...args) => ({
            all: async () => ({
              results: dbOverrides.all ? await dbOverrides.all(sql, args) : [],
              success: true,
              meta: {},
            }),
            first: async () => (dbOverrides.first ? await dbOverrides.first(sql, args) : null),
            run: async () => ({ success: true, meta: {} }),
          }),
        }),
        batch: async () => [],
      },
      resources: storeWrapper.store,
    },
  };

  return { app, env };
};

const sampleImageRow = {
  id: "res_img_1",
  memo_id: "memo_1",
  original_memo_id: null,
  bucket_name: "resources",
  object_key: "workspaces/ws_1/memos/memo_1/res_img_1.png",
  storage_config_id: null,
  kind: "image",
  mime_type: "image/png",
  filename: "photo.png",
  byte_size: 2048,
  sha256: "sha_v1",
  width: 1200,
  height: 800,
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
  is_deleted: 0,
};

describe("resource blob thumbnail ?w= support", () => {
  test("validates width bounds and rejects invalid ?w= inputs without touching storage", async () => {
    const originalBytes = new Uint8Array(2048).fill(1);
    const storeWrapper = createInMemoryStore({ [sampleImageRow.object_key]: originalBytes });
    let resizeCalls = 0;
    const { app, env } = createMockApp({
      resourceProvider: async () => sampleImageRow,
      storeWrapper,
      resizeImageThumbnail: async () => {
        resizeCalls += 1;
        return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/webp" };
      },
    });

    for (const badQuery of ["", "abc", "0", "-10", "63", "1601", "99999", "400.5", "400&w=800"]) {
      const response = await app.request(`/api/v1/resources/res_img_1/blob?w=${badQuery}`, {}, env);
      expect(response.status).toBe(400);
    }
    expect(storeWrapper.gets).toHaveLength(0);
    expect(resizeCalls).toBe(0);
  });

  test("enforces permissions and revocation before reading cached thumbnails or returning 304", async () => {
    const originalBytes = new Uint8Array(2048).fill(2);
    const thumbBytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const thumbKey = buildThumbnailObjectKey("ws_1", "res_img_1", "sha_v1", 400);
    const etag = buildThumbnailEtag("sha_v1", 400);
    const storeWrapper = createInMemoryStore({
      [sampleImageRow.object_key]: originalBytes,
      [thumbKey]: thumbBytes,
    });

    let grantedNotebookIds = ["nb_allowed"];
    let currentScopes = ["read:resources"];

    const { app, env } = createMockApp({
      authProvider: () => ({
        ...baseAuth,
        scopes: currentScopes,
        notebookAccess: [{ notebookId: "nb_allowed", read: true, write: false }],
        notebookAccessLevel: "read",
      }),
      resourceProvider: async () => sampleImageRow,
      dbOverrides: {
        all: async (sql) => (sql.includes("WITH RECURSIVE accessible") ? grantedNotebookIds.map((id) => ({ id })) : []),
        first: async (sql) => (sql.includes("SELECT notebook_id FROM memos") ? { notebook_id: "nb_allowed" } : null),
      },
      storeWrapper,
      resizeImageThumbnail: async () => {
        throw new Error("Should not resize on cache hit");
      },
    });

    // Authorized request hits cached thumbnail.
    const okRes = await app.request("/api/v1/resources/res_img_1/blob?w=400", {}, env);
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(okRes.headers.get("ETag")).toBe(etag);
    expect(okRes.headers.get("Vary")).toBe("Authorization");
    expect(new Uint8Array(await okRes.arrayBuffer())).toEqual(thumbBytes);

    // Authorized conditional request returns 304.
    const notModified = await app.request(
      "/api/v1/resources/res_img_1/blob?w=400",
      { headers: { "If-None-Match": etag } },
      env,
    );
    expect(notModified.status).toBe(304);

    // Revoke notebook access: new requests MUST be denied even on cache hit or matching ETag.
    grantedNotebookIds = [];
    const getsBeforeRevoke = storeWrapper.gets.length;
    const revokedHit = await app.request("/api/v1/resources/res_img_1/blob?w=400", {}, env);
    expect(revokedHit.status).toBe(403);
    const revokedConditional = await app.request(
      "/api/v1/resources/res_img_1/blob?w=400",
      { headers: { "If-None-Match": etag } },
      env,
    );
    expect(revokedConditional.status).toBe(403);
    expect(storeWrapper.gets).toHaveLength(getsBeforeRevoke);

    // Restore notebook access, revoke scope: still 403 before storage touch.
    grantedNotebookIds = ["nb_allowed"];
    currentScopes = [];
    const scopeDenied = await app.request("/api/v1/resources/res_img_1/blob?w=400", {}, env);
    expect(scopeDenied.status).toBe(403);
    expect(storeWrapper.gets).toHaveLength(getsBeforeRevoke);
  });

  test("caches generated thumbnail by version, serves hits without resizing, and coalesces concurrent misses", async () => {
    const originalBytes = new Uint8Array(4096).fill(9);
    const thumbBytes = new Uint8Array(120).fill(5);
    const storeWrapper = createInMemoryStore({
      [sampleImageRow.object_key]: originalBytes,
    });
    let resizeCalls = 0;
    let releaseResize;
    const resizeGate = new Promise((resolve) => {
      releaseResize = resolve;
    });

    const { app, env } = createMockApp({
      resourceProvider: async () => sampleImageRow,
      storeWrapper,
      resizeImageThumbnail: async ({ width }) => {
        resizeCalls += 1;
        expect(width).toBe(400);
        await resizeGate;
        return { bytes: thumbBytes, mimeType: "image/webp" };
      },
    });

    // Two concurrent cold-cache requests coalesce into one resize call.
    const req1 = app.request("/api/v1/resources/res_img_1/blob?w=350", {}, env);
    const req2 = app.request("/api/v1/resources/res_img_1/blob?w=400", {}, env);
    await new Promise((r) => setTimeout(r, 10));
    releaseResize();
    const [res1, res2] = await Promise.all([req1, req2]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(resizeCalls).toBe(1);
    expect(res1.headers.get("Content-Type")).toBe("image/webp");
    expect(res1.headers.get("Content-Disposition")).toContain("photo.webp");
    expect(res1.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(new Uint8Array(await res1.arrayBuffer())).toEqual(thumbBytes);

    // Third request is a pure cache hit: never reads original object or calls resizer.
    const getsBeforeHit = storeWrapper.gets.length;
    const res3 = await app.request("/api/v1/resources/res_img_1/blob?w=400", {}, env);
    expect(res3.status).toBe(200);
    expect(resizeCalls).toBe(1);
    expect(storeWrapper.gets.slice(getsBeforeHit).map((g) => g.key)).toEqual([
      buildThumbnailObjectKey("ws_1", "res_img_1", "sha_v1", 400),
    ]);
    expect(new Uint8Array(await res3.arrayBuffer())).toEqual(thumbBytes);

    // Byte range read on cached thumbnail works cleanly.
    const rangeRes = await app.request(
      "/api/v1/resources/res_img_1/blob?w=400",
      { headers: { Range: "bytes=0-9" } },
      env,
    );
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("Content-Range")).toBe("bytes 0-9/120");
    expect(new Uint8Array(await rangeRes.arrayBuffer())).toEqual(thumbBytes.subarray(0, 10));
  });

  test("falls back to original bytes when resizer is missing, fails, or produces a larger output", async () => {
    const originalBytes = new Uint8Array(512).fill(4);
    const storeWrapper = createInMemoryStore({
      [sampleImageRow.object_key]: originalBytes,
    });
    const row = { ...sampleImageRow, byte_size: originalBytes.byteLength };

    // 1. No resizer configured.
    const noResizer = createMockApp({ resourceProvider: async () => row, storeWrapper });
    const r1 = await noResizer.app.request("/api/v1/resources/res_img_1/blob?w=400", {}, noResizer.env);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(originalBytes);
    expect(storeWrapper.puts).toHaveLength(0);

    // 2. Resizer throws (corrupt input).
    const throwingResizer = createMockApp({
      resourceProvider: async () => row,
      storeWrapper,
      resizeImageThumbnail: async () => {
        throw new Error("corrupt image");
      },
    });
    const r2 = await throwingResizer.app.request("/api/v1/resources/res_img_1/blob?w=400", {}, throwingResizer.env);
    expect(r2.status).toBe(200);
    expect(r2.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(originalBytes);
    expect(storeWrapper.puts).toHaveLength(0);

    // 3. Resizer output is larger than original.
    const largerResizer = createMockApp({
      resourceProvider: async () => row,
      storeWrapper,
      resizeImageThumbnail: async () => ({ bytes: new Uint8Array(1024).fill(8), mimeType: "image/webp" }),
    });
    const r3 = await largerResizer.app.request("/api/v1/resources/res_img_1/blob?w=400", {}, largerResizer.env);
    expect(r3.status).toBe(200);
    expect(r3.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await r3.arrayBuffer())).toEqual(originalBytes);
    expect(storeWrapper.puts).toHaveLength(0);
  });

  test("skips resizing for non-image attachments, SVG, GIF, and animated raster images", async () => {
    let resizeCalls = 0;
    const resizer = async () => {
      resizeCalls += 1;
      return { bytes: new Uint8Array([1, 2]), mimeType: "image/webp" };
    };

    // PDF attachment
    const pdfBytes = new TextEncoder().encode("%PDF-1.4 sample");
    const pdfRow = {
      ...sampleImageRow,
      id: "res_pdf",
      kind: "attachment",
      mime_type: "application/pdf",
      filename: "doc.pdf",
      byte_size: pdfBytes.byteLength,
      object_key: "pdf-key",
    };
    const pdfStore = createInMemoryStore({ "pdf-key": pdfBytes });
    const pdfApp = createMockApp({ resourceProvider: async () => pdfRow, storeWrapper: pdfStore, resizeImageThumbnail: resizer });
    const pdfRes = await pdfApp.app.request("/api/v1/resources/res_pdf/blob?w=400", {}, pdfApp.env);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await pdfRes.arrayBuffer())).toEqual(pdfBytes);

    // SVG image preserves sandbox CSP and original bytes
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const svgBytes = new TextEncoder().encode(svg);
    const svgRow = {
      ...sampleImageRow,
      id: "res_svg",
      mime_type: "image/svg+xml",
      filename: "chart.svg",
      byte_size: svgBytes.byteLength,
      object_key: "svg-key",
    };
    const svgStore = createInMemoryStore({ "svg-key": svgBytes });
    const svgApp = createMockApp({ resourceProvider: async () => svgRow, storeWrapper: svgStore, resizeImageThumbnail: resizer });
    const svgRes = await svgApp.app.request("/api/v1/resources/res_svg/blob?w=400", {}, svgApp.env);
    expect(svgRes.status).toBe(200);
    expect(svgRes.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(svgRes.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await svgRes.text()).toBe(svg);

    // Animated WebP (VP8X with animation flag bit 0x02 at byte 20)
    const animatedWebp = new Uint8Array(32);
    animatedWebp.set(new TextEncoder().encode("RIFF"), 0);
    animatedWebp.set(new TextEncoder().encode("WEBP"), 8);
    animatedWebp.set(new TextEncoder().encode("VP8X"), 12);
    animatedWebp[20] = 0x02;
    const animRow = {
      ...sampleImageRow,
      id: "res_anim",
      mime_type: "image/webp",
      filename: "anim.webp",
      byte_size: animatedWebp.byteLength,
      object_key: "anim-key",
    };
    const animStore = createInMemoryStore({ "anim-key": animatedWebp });
    const animApp = createMockApp({ resourceProvider: async () => animRow, storeWrapper: animStore, resizeImageThumbnail: resizer });
    const animRes = await animApp.app.request("/api/v1/resources/res_anim/blob?w=400", {}, animApp.env);
    expect(animRes.status).toBe(200);
    expect(animRes.headers.get("Content-Type")).toBe("image/webp");
    expect(new Uint8Array(await animRes.arrayBuffer())).toEqual(animatedWebp);

    expect(resizeCalls).toBe(0);
  });

  test("invalidates and cleans up thumbnails on image replacement and resource deletion", async () => {
    const dir = await mkdtemp(`${tmpdir()}/edgeever-thumb-integration-`);
    temporaryDirectories.push(dir);
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const migrationDir = new URL("../../../migrations/", import.meta.url);
      for (const name of (await readdir(migrationDir)).filter((v) => v.endsWith(".sql")).sort()) {
        db.exec(await readFile(new URL(name, migrationDir), "utf8"));
      }
      db.query("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)").run();

      const resourcesDir = join(dir, "resources");
      const env = {
        storage: createSelfHostedStorageAdapter(db, resourcesDir),
        resizeImageThumbnail: createSelfHostedImageThumbnailAdapter(),
        EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
        EDGE_EVER_RUNTIME: "self-hosted-bun",
      };

      const callApp = (path, init = {}) => fetchEdgeEverApp(
        new Request(`http://edgeever.test${path}`, init),
        env,
        { waitUntil: () => undefined, passThroughOnException: () => undefined },
      );

      const nbRes = await (await callApp("/api/v1/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Photos" }),
      })).json();
      const memoRes = await (await callApp("/api/v1/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: nbRes.notebook.id, title: "Gallery", contentMarkdown: "" }),
      })).json();

      // Generate a 1200x800 noisy PNG that compresses much smaller as a 400px WebP.
      const pngV1 = await sharp({
        create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 120, b: 80 } },
      }).png().toBuffer();
      const uploadForm = new FormData();
      uploadForm.append("file", new File([pngV1], "landscape.png", { type: "image/png" }));
      const uploaded = await (await callApp(`/api/v1/memos/${memoRes.memo.id}/resources`, {
        method: "POST",
        body: uploadForm,
      })).json();

      const resourceId = uploaded.resource.id;
      const shaV1 = uploaded.resource.sha256;

      // 1. Fetch thumbnail: real sharp produces <= 400px WebP smaller than original.
      const thumbV1 = await callApp(`/api/v1/resources/${resourceId}/blob?w=400`);
      expect(thumbV1.status).toBe(200);
      expect(thumbV1.headers.get("Content-Type")).toBe("image/webp");
      expect(thumbV1.headers.get("Cache-Control")).toBe("private, no-cache");
      const thumbV1Bytes = new Uint8Array(await thumbV1.arrayBuffer());
      const thumbV1Meta = await sharp(thumbV1Bytes).metadata();
      expect(thumbV1Meta.format).toBe("webp");
      expect(thumbV1Meta.width).toBe(400);
      expect(thumbV1Bytes.byteLength).toBeLessThan(pngV1.byteLength);

      // Cached thumbnail object exists in filesystem store.
      const thumbV1Key = buildThumbnailObjectKey("ws_default", resourceId, shaV1, 400);
      const cachedV1Obj = await env.storage.resources.get(thumbV1Key);
      expect(cachedV1Obj).not.toBeNull();
      await cachedV1Obj?.body.cancel();

      // 2. Original download without ?w= returns exact original PNG bytes + Range support.
      const origRes = await callApp(`/api/v1/resources/${resourceId}/blob`);
      expect(origRes.status).toBe(200);
      expect(origRes.headers.get("Content-Type")).toBe("image/png");
      expect(new Uint8Array(await origRes.arrayBuffer())).toEqual(new Uint8Array(pngV1));

      const origRange = await callApp(`/api/v1/resources/${resourceId}/blob`, {
        headers: { Range: "bytes=0-7" },
      });
      expect(origRange.status).toBe(206);
      expect(new Uint8Array(await origRange.arrayBuffer())).toEqual(new Uint8Array(pngV1.subarray(0, 8)));

      // 3. Replace image content with a new color: old thumbnail is purged, new thumbnail has new ETag.
      const pngV2 = await sharp({
        create: { width: 1000, height: 1000, channels: 3, background: { r: 220, g: 40, b: 40 } },
      }).png().toBuffer();
      const replaceForm = new FormData();
      replaceForm.append("file", new File([pngV2], "landscape-v2.png", { type: "image/png" }));
      replaceForm.append("expectedContentHash", shaV1);
      const replaced = await (await callApp(`/api/v1/resources/${resourceId}/blob`, {
        method: "PUT",
        body: replaceForm,
      })).json();
      expect(replaced.resource.sha256).not.toBe(shaV1);
      expect(await env.storage.resources.get(thumbV1Key)).toBeNull();

      const thumbV2 = await callApp(`/api/v1/resources/${resourceId}/blob?w=400`);
      expect(thumbV2.status).toBe(200);
      expect(thumbV2.headers.get("ETag")).not.toBe(thumbV1.headers.get("ETag"));
      const thumbV2Meta = await sharp(new Uint8Array(await thumbV2.arrayBuffer())).metadata();
      expect(thumbV2Meta.width).toBe(400);
      expect(thumbV2Meta.height).toBe(400);

      // 4. Delete resource: deletes both original and cached v2 thumbnail.
      const thumbV2Key = buildThumbnailObjectKey("ws_default", resourceId, replaced.resource.sha256, 400);
      const cachedV2Obj = await env.storage.resources.get(thumbV2Key);
      expect(cachedV2Obj).not.toBeNull();
      await cachedV2Obj?.body.cancel();
      const delRes = await callApp(`/api/v1/resources/${resourceId}`, { method: "DELETE" });
      expect(delRes.status).toBe(200);
      expect(await env.storage.resources.get(thumbV2Key)).toBeNull();
      expect(await getResourceRow(env.storage.db, "ws_default", resourceId)).toBeNull();
      expect((await callApp(`/api/v1/resources/${resourceId}/blob?w=400`)).status).toBe(404);
    } finally {
      db.close();
    }
  }, { timeout: 15000 });

  test("Cloudflare Images adapter transforms and falls back gracefully on errors", async () => {
    const transformedBytes = new Uint8Array([1, 2, 3, 4]);
    let seenTransform;
    let seenOutput;
    const adapter = createCloudflareImageThumbnailAdapter({
      info: async () => ({ format: "image/png", fileSize: 10, width: 1000, height: 800 }),
      input: () => ({
        transform: (opts) => {
          seenTransform = opts;
          return {
            draw: () => { throw new Error("unused"); },
            transform: () => { throw new Error("unused"); },
            output: async (outOpts) => {
              seenOutput = outOpts;
              return {
                response: () => new Response(transformedBytes),
                contentType: () => "image/webp",
                image: () => new Blob([transformedBytes]).stream(),
              };
            },
          };
        },
        draw: () => { throw new Error("unused"); },
        output: async () => { throw new Error("unused"); },
      }),
      hosted: {},
    });

    const ok = await adapter({ bytes: new Uint8Array([9, 8, 7]), mimeType: "image/png", width: 400 });
    expect(seenTransform).toEqual({ width: 400, fit: "scale-down" });
    expect(seenOutput).toEqual({ format: "image/webp", quality: 80 });
    expect(ok).toEqual({ bytes: transformedBytes, mimeType: "image/webp" });

    const failingAdapter = createCloudflareImageThumbnailAdapter({
      info: async () => { throw new Error("boom"); },
      input: () => ({
        transform: () => ({
          draw: () => { throw new Error("unused"); },
          transform: () => { throw new Error("unused"); },
          output: async () => { throw new Error("CF Images failed"); },
        }),
        draw: () => { throw new Error("unused"); },
        output: async () => { throw new Error("unused"); },
      }),
      hosted: {},
    });
    expect(await failingAdapter({ bytes: new Uint8Array([9]), mimeType: "image/png", width: 400 })).toBeNull();
  });

  test("matchesIfNoneMatch and resolveThumbnailVersionKey handle edge formats", async () => {
    expect(matchesIfNoneMatch('W/"thumb-v1-w400"', '"thumb-v1-w400"')).toBe(true);
    expect(matchesIfNoneMatch('"other", "thumb-v1-w400"', '"thumb-v1-w400"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"thumb-v1-w400"')).toBe(true);
    expect(matchesIfNoneMatch('"other"', '"thumb-v1-w400"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"thumb-v1-w400"')).toBe(false);

    const fallbackVersion = await resolveThumbnailVersionKey({
      object_key: "workspaces/ws/memos/m1/r1.png",
      sha256: null,
      updated_at: "2026-11-20T00:00:00.000Z",
    });
    expect(fallbackVersion).toMatch(/^[a-f0-9]{64}$/);
  });

  test("resizeWithImageScript resizes PNG/JPEG to WebP without enlarging small images", async () => {
    const png1200 = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 30, g: 140, b: 200 } },
    }).png().toBuffer();
    const pngOut = await resizeWithImageScript({ bytes: new Uint8Array(png1200), width: 400 });
    expect(pngOut).not.toBeNull();
    expect(pngOut?.mimeType).toBe("image/webp");
    const pngOutMeta = await sharp(pngOut.bytes).metadata();
    expect(pngOutMeta.format).toBe("webp");
    expect(pngOutMeta.width).toBe(400);
    expect(pngOutMeta.height).toBe(267);

    const jpg900 = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 210, g: 90, b: 40 } },
    }).jpeg().toBuffer();
    const jpgOut = await resizeWithImageScript({ bytes: new Uint8Array(jpg900), width: 400 });
    expect(jpgOut?.mimeType).toBe("image/webp");
    const jpgOutMeta = await sharp(jpgOut.bytes).metadata();
    expect(jpgOutMeta.format).toBe("webp");
    expect(jpgOutMeta.width).toBe(400);

    const smallPng = await sharp({
      create: { width: 200, height: 150, channels: 3, background: { r: 80, g: 180, b: 90 } },
    }).png().toBuffer();
    const smallOut = await resizeWithImageScript({ bytes: new Uint8Array(smallPng), width: 800 });
    expect(smallOut?.mimeType).toBe("image/webp");
    const smallOutMeta = await sharp(smallOut.bytes).metadata();
    expect(smallOutMeta.width).toBe(200);
    expect(smallOutMeta.height).toBe(150);

    expect(await resizeWithImageScript({ bytes: new Uint8Array([1, 2, 3, 4]), width: 400 })).toBeNull();
  });

  test("bundled self-hosted thumbnail adapter runs standalone without node_modules", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "edgeever-thumb-bundle-"));
    const emptyCacheDir = await mkdtemp(join(tmpdir(), "edgeever-bun-empty-cache-"));
    temporaryDirectories.push(outDir, emptyCacheDir);

    const entrypoint = fileURLToPath(new URL("../../../scripts/self-hosted-image-thumbnail.mjs", import.meta.url));
    const buildResult = await Bun.build({
      entrypoints: [entrypoint],
      target: "bun",
      format: "esm",
      outdir: outDir,
      sourcemap: "none",
    });
    expect(buildResult.success).toBe(true);

    const png1200 = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: { r: 25, g: 95, b: 190 } },
    }).png().toBuffer();

    const runnerPath = join(outDir, "run.mjs");
    await writeFile(
      runnerPath,
      [
        'import { createSelfHostedImageThumbnailAdapter } from "./self-hosted-image-thumbnail.js";',
        'const input = Uint8Array.from(Buffer.from(process.env.TEST_PNG_B64 || "", "base64"));',
        "const resize = createSelfHostedImageThumbnailAdapter();",
        "const res = await resize({ bytes: input, mimeType: 'image/png', width: 400 });",
        "if (!res || res.mimeType !== 'image/webp') process.exit(2);",
        "process.stdout.write(Buffer.from(res.bytes).toString('base64'));",
      ].join("\n"),
      "utf8",
    );

    const runResult = spawnSync(process.execPath, ["--no-install", runnerPath], {
      cwd: outDir,
      env: {
        ...process.env,
        BUN_INSTALL_CACHE_DIR: emptyCacheDir,
        TEST_PNG_B64: Buffer.from(png1200).toString("base64"),
      },
      encoding: "utf8",
    });
    expect(runResult.status).toBe(0);
    expect(runResult.stderr).toContain("using bundled imagescript thumbnail resizer");
    const outBytes = new Uint8Array(Buffer.from(runResult.stdout.trim(), "base64"));
    const meta = await sharp(outBytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(267);
  }, { timeout: 20000 });

  test("deleteReleasedResourceObjects and permanent memo deletion purge cached thumbnails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edgeever-thumb-purge-"));
    temporaryDirectories.push(dir);
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON");
      const migrationDir = new URL("../../../migrations/", import.meta.url);
      for (const name of (await readdir(migrationDir)).filter((v) => v.endsWith(".sql")).sort()) {
        db.exec(await readFile(new URL(name, migrationDir), "utf8"));
      }
      db.query("INSERT OR IGNORE INTO workspaces (id, name, is_personal) VALUES ('ws_default', 'Personal', 1)").run();

      const env = {
        storage: createSelfHostedStorageAdapter(db, join(dir, "resources")),
        resizeImageThumbnail: createSelfHostedImageThumbnailAdapter(),
        EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
        EDGE_EVER_RUNTIME: "self-hosted-bun",
      };
      const callApp = (path, init = {}) => fetchEdgeEverApp(
        new Request(`http://edgeever.test${path}`, init),
        env,
        { waitUntil: () => undefined, passThroughOnException: () => undefined },
      );

      const nbRes = await (await callApp("/api/v1/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Purge" }),
      })).json();
      const createMemoWithThumb = async (title) => {
        const memoRes = await (await callApp("/api/v1/memos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notebookId: nbRes.notebook.id, title, contentMarkdown: "" }),
        })).json();
        const png = await sharp({
          create: { width: 1200, height: 800, channels: 3, background: { r: 60, g: 130, b: 70 } },
        }).png().toBuffer();
        const form = new FormData();
        form.append("file", new File([png], "pic.png", { type: "image/png" }));
        const uploaded = await (await callApp(`/api/v1/memos/${memoRes.memo.id}/resources`, {
          method: "POST",
          body: form,
        })).json();
        const thumbRes = await callApp(`/api/v1/resources/${uploaded.resource.id}/blob?w=400`);
        expect(thumbRes.status).toBe(200);
        await thumbRes.body?.cancel();
        const thumbKey = buildThumbnailObjectKey("ws_default", uploaded.resource.id, uploaded.resource.sha256, 400);
        const cached = await env.storage.resources.get(thumbKey);
        expect(cached).not.toBeNull();
        await cached?.body.cancel();
        return { memoId: memoRes.memo.id, resource: uploaded.resource, thumbKey };
      };

      const actor = { actorType: "user", actorId: null };
      const memoA = await createMemoWithThumb("Permanent Delete");
      await deleteMemosRecord(env, "ws_default", [memoA.memoId], false, actor);
      const beforePermanent = await env.storage.resources.get(memoA.thumbKey);
      expect(beforePermanent).not.toBeNull();
      await beforePermanent?.body.cancel();
      await deleteMemosRecord(env, "ws_default", [memoA.memoId], true, actor);
      expect(await env.storage.resources.get(memoA.thumbKey)).toBeNull();

      const memoB = await createMemoWithThumb("Empty Trash");
      await deleteMemosRecord(env, "ws_default", [memoB.memoId], false, actor);
      await emptyTrashMemosRecord(env, "ws_default", actor);
      expect(await env.storage.resources.get(memoB.thumbKey)).toBeNull();

      const memoC = await createMemoWithThumb("Released Resource");
      await deleteReleasedResourceObjects(env, [{
        id: memoC.resource.id,
        workspaceId: "ws_default",
        objectKey: memoC.resource.objectKey,
        storageConfigId: memoC.resource.storageConfigId,
        kind: memoC.resource.kind,
        mimeType: memoC.resource.mimeType,
        byteSize: memoC.resource.byteSize,
        sha256: memoC.resource.sha256,
        updatedAt: memoC.resource.updatedAt,
      }]);
      expect(await env.storage.resources.get(memoC.thumbKey)).toBeNull();
    } finally {
      db.close();
    }
  }, { timeout: 20000 });
});
