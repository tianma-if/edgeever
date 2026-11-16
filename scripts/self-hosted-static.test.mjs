import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { serveSelfHostedStatic } from "./self-hosted-static.mjs";

const asset = "/assets/app-abCD12_E.js";
const source = "export const content = " + JSON.stringify("sample content ".repeat(100)) + ";";
const html = "<!doctype html><main>App shell</main>";
let webDirectory;

before(async () => {
  webDirectory = await mkdtemp(join(tmpdir(), "edgeever-static-"));
  await mkdir(join(webDirectory, "assets"));
  await Promise.all(Object.entries({
    [asset]: source,
    "/assets/tiny-12345678.css": "body{}",
    "/assets/pdf.worker.mjs": "export const WorkerMessageHandler = {};",
    "/assets/unknown.bin": "binary",
    "/index.html": html,
    "/sw.js": "/* service worker */",
    "/manifest.webmanifest": "{}",
  }).map(([path, body]) => writeFile(join(webDirectory, path), body)));
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./precompress-self-hosted-assets.mjs", import.meta.url)),
    webDirectory,
  ]);
});

after(async () => {
  if (webDirectory) await rm(webDirectory, { recursive: true });
});

const request = (path, acceptEncoding, method = "GET") => serveSelfHostedStatic(
  new Request(`http://localhost${path}`, {
    method,
    headers: acceptEncoding === undefined ? {} : { "Accept-Encoding": acceptEncoding },
  }),
  webDirectory,
);

test("preserves MIME types without treating fixed asset names as immutable", async () => {
  for (const [path, type, body] of [
    ["/assets/pdf.worker.mjs", "text/javascript; charset=utf-8", "export const WorkerMessageHandler = {};"],
    ["/assets/unknown.bin", "application/octet-stream", "binary"],
  ]) {
    const response = await request(path, "gzip");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), type);
    assert.equal(response.headers.get("Content-Encoding"), null);
    assert.equal(response.headers.get("Cache-Control"), null);
    assert.equal(await response.text(), body);
  }
});

test("serves precompressed JS with the original MIME type and a separate cache variant", async () => {
  const files = await readdir(join(webDirectory, "assets"));
  assert.ok(files.includes("app-abCD12_E.js.gz"));
  assert.ok(!files.includes("app-abCD12_E.js"));
  const response = await request(asset, "br, gzip");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.equal(response.headers.get("Content-Type"), "text/javascript; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("Vary"), "Accept-Encoding");
  const bytes = await response.arrayBuffer();
  assert.ok(bytes.byteLength < Buffer.byteLength(source));
  assert.equal(gunzipSync(bytes).toString(), source);
  const head = await request(asset, "gzip", "HEAD");
  assert.equal(head.headers.get("Content-Encoding"), "gzip");
  assert.equal(Number(head.headers.get("Content-Length")), bytes.byteLength);
  assert.equal(await head.text(), "");
});

test("respects encoding exclusions and keeps the identity representation cacheable", async () => {
  for (const encoding of [undefined, "", "br", "gzip;q=0, *;q=1", "gzip;q=0.3, identity;q=1"]) {
    const response = await request(asset, encoding);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Encoding"), null);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("Vary"), "Accept-Encoding");
    assert.equal(await response.text(), source);
  }
  const head = await request(asset, "identity", "HEAD");
  assert.equal(head.headers.get("Content-Encoding"), null);
  assert.equal(Number(head.headers.get("Content-Length")), Buffer.byteLength(source));
  assert.equal(await head.text(), "");
  assert.equal((await request(asset, "*;q=1")).headers.get("Content-Encoding"), "gzip");
  assert.equal((await request(asset, "*;q=0")).status, 406);
  const tiny = await request("/assets/tiny-12345678.css", "gzip");
  assert.equal(tiny.headers.get("Content-Encoding"), null);
  assert.equal(await tiny.text(), "body{}");
});

test("does not cache the entry points or serve the app shell for an obsolete asset", async () => {
  for (const path of ["/", "/settings", "/sw.js", "/manifest.webmanifest"]) {
    const response = await request(path, "gzip");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-cache, no-store, must-revalidate");
    assert.equal(response.headers.get("Content-Encoding"), null);
  }
  for (const path of [`${asset}.gz`, "/assets/app-previous.js"]) {
    const response = await request(path, "gzip");
    assert.equal(response.status, 404);
    assert.doesNotMatch(response.headers.get("Cache-Control") ?? "", /immutable/);
  }
});

test("serves the app shell with privacy headers on public share and form routes", async () => {
  for (const path of ["/share/token", "/form/token"]) {
    const response = await request(path, "gzip");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive, nosnippet, noimageindex");
    assert.equal(await response.text(), html);
  }
});
