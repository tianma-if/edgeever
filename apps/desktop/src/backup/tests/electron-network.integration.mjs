import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { fetchEdgeEverApp } from "../../../../api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../../../../api/src/self-hosted-storage-adapter.ts";
import { RESOURCE_UPLOAD_PART_BYTES } from "../../../../api/src/resource-upload-service.ts";
import { createEdgeEverClient } from "../../../../../packages/client/src/index.ts";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const electron = require("electron");
const trace = (...values) => { if (process.env.EDGE_EVER_BACKUP_TRACE === "1") console.error(...values); };
for (const proxy of [true, false]) test(`Electron backups export and restore through ${proxy ? "the session proxy" : "a direct connection"}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-electron-backup-"));
  const cleanup = [];
  const paths = [];
  const auth = [];
  const attachmentCacheHeaders = [];
  let hanging = false;
  let replaceAttachment;
  try {
    const instance = async name => {
      const folder = join(directory, name); await mkdir(folder);
      const database = new Database(join(folder, "database.sqlite"));
      for (const file of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", file), "utf8"));
      const environment = { storage: createSelfHostedStorageAdapter(database, join(folder, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/__fixture/status") return Response.json({ hanging });
        if (name === "source" && path === "/__fixture/replace-attachment" && request.method === "POST") return replaceAttachment();
        if (path.startsWith("/hang/")) { hanging = true; return new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })), { once: true })); }
        if (path.startsWith("/failure/")) return Response.json({ error: { code: "fixture_unavailable", message: "Fixture unavailable" } }, { status: 503 });
        if (request.headers.get("authorization") === "Bearer fixture-bearer") { paths.push(`${name}:${request.method} ${path}${new URL(request.url).search}`); auth.push({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie") }); }
        trace(name, request.method, path);
        return fetchEdgeEverApp(request, environment, { waitUntil() {}, passThroughOnException() {} }).then(response => {
          if (name === "source" && request.method === "GET" && /^\/api\/v1\/resources\/[^/]+\/blob$/.test(path)) attachmentCacheHeaders.push({ path, cacheControl: response.headers.get("cache-control") });
          trace(name, request.method, path, response.status); return response;
        });
      } });
      cleanup.push(async () => {
        await server.stop(true);
        // Bun 1.3.14 can leave uncached SQLite statements alive (oven-sh/bun#36572).
        // Release them and require a complete close before deleting fixture files.
        Bun.gc(true); database.close(true);
      });
      return { server, database, folder, url: `http://127.0.0.1:${server.port}`, client: createEdgeEverClient({ baseUrl: `http://127.0.0.1:${server.port}` }) };
    };
    const source = await instance("source"); const target = await instance("target");
    const { notebook } = await source.client.createNotebook({ name: "Network backup" });
    const { memo } = await source.client.createMemo({ notebookId: notebook.id, title: "Proxy round trip", contentMarkdown: "Streaming backup and restore" });
    const bytes = randomBytes(Number(process.env.EDGE_EVER_BACKUP_ATTACHMENT_MIB ?? 32) * 1024 * 1024 + 11);
    const { resource } = await source.client.uploadMemoResource(memo.id, new File([new Uint8Array([1])], "stream.bin", { type: "application/octet-stream" }));
    const row = source.database.query("SELECT object_key FROM resources WHERE id=?").get(resource.id);
    await writeFile(join(source.folder, "resources", row.object_key), bytes);
    source.database.query("UPDATE resources SET byte_size=?, sha256=NULL WHERE id=?").run(bytes.length, resource.id);

    // A small attachment is reliably cacheable even on runners with a small HTTP cache.
    // Keep the large attachment above for the streaming regression.
    const mutableBytes = randomBytes(64 * 1024);
    const { resource: mutableResource } = await source.client.uploadMemoResource(memo.id, new File([mutableBytes], "mutable.bin", { type: "application/octet-stream" }));
    const mutableRow = source.database.query("SELECT object_key FROM resources WHERE id=?").get(mutableResource.id);
    const previousHash = createHash("sha256").update(mutableBytes).digest("hex");
    source.database.query("UPDATE resources SET sha256=? WHERE id=?").run(previousHash, mutableResource.id);
    replaceAttachment = async () => {
      const revisionBefore = source.database.query("SELECT backup_revision FROM workspaces WHERE id='ws_default'").get().backup_revision;
      mutableBytes[0] ^= 0xff;
      await writeFile(join(source.folder, "resources", mutableRow.object_key), mutableBytes);
      const hash = createHash("sha256").update(mutableBytes).digest("hex");
      source.database.query("UPDATE resources SET sha256=? WHERE id=?").run(hash, mutableResource.id);
      const revisionAfter = source.database.query("SELECT backup_revision FROM workspaces WHERE id='ws_default'").get().backup_revision;
      return Response.json({ previousHash, hash, revisionBefore, revisionAfter, resourceUrl: mutableResource.url });
    };

    let proxyRequests = 0;
    const forwarder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      proxyRequests++;
      const url = new URL(request.url); url.hostname = "127.0.0.1";
      trace("proxy", request.method, url.pathname);
      return fetch(new Request(url, request), { proxy: null });
    } });
    cleanup.push(() => forwarder.stop(true));
    const settings = { directory, source: proxy ? source.url.replace("127.0.0.1", "backup-fixture.invalid") : source.url,
      target: proxy ? target.url.replace("127.0.0.1", "backup-fixture.invalid") : target.url,
      control: `${source.url}/__fixture/status`, proxy: proxy ? `http=127.0.0.1:${forwarder.port}` : null,
      mutableResourceUrl: mutableResource.url,
      baseline: process.env.EDGE_EVER_BACKUP_BASELINE === "1" };
    const settingsPath = join(directory, "settings.json"); await writeFile(settingsPath, JSON.stringify(settings));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [fileURLToPath(new URL("./electron-network-runner.mjs", import.meta.url)), settingsPath], { env, stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    cleanup.push(async () => { child.kill("SIGTERM"); await exited.catch(() => {}); });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; process.stderr.write(value); });
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Electron backup fixture timed out. Last API requests:\n${paths.slice(-10).join("\n")}\n${stderr}`));
      }, 40000);
    });
    const code = await Promise.race([exited, deadline]).finally(() => clearTimeout(timer));
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout.trim().split("\n").findLast(line => line.startsWith("{")));
    if (process.env.EDGE_EVER_BACKUP_REPORT) await writeFile(`${process.env.EDGE_EVER_BACKUP_REPORT}-${proxy ? "proxy" : "direct"}.json`, JSON.stringify({ ...report, archive: undefined, paths, proxyRequests }, null, 2));
    expect(report.archiveBytes).toBeGreaterThan(bytes.length);
    expect(report.workersExited).toBe(settings.baseline ? 0 : 6);
    expect(report.repeatedExport).toBe(true);
    expect((await target.client.getMemo(memo.id)).memo.contentMarkdown).toBe("Streaming backup and restore");
    const restored = await target.client.getResourceResponse(`/api/v1/resources/${resource.id}/blob`);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(new Uint8Array(bytes));
    const restoredMutable = await target.client.getResourceResponse(mutableResource.url);
    expect(new Uint8Array(await restoredMutable.arrayBuffer())).toEqual(new Uint8Array(mutableBytes));
    expect(auth.every(value => value.authorization === "Bearer fixture-bearer" && value.cookie === null)).toBe(true);
    expect(paths.filter(path => path === "source:GET /api/v1/backups/state")).toHaveLength(5);
    expect(paths.filter(path => path.startsWith("source:GET /api/v1/backups/data"))).toHaveLength(6);
    expect(paths.filter(path => path === `source:GET /api/v1/resources/${resource.id}/blob`)).toHaveLength(2);
    expect(paths.filter(path => path === `source:GET /api/v1/resources/${mutableResource.id}/blob`)).toHaveLength(2);
    const mutableCacheHeaders = attachmentCacheHeaders.filter(value => value.path === `/api/v1/resources/${mutableResource.id}/blob`);
    expect(mutableCacheHeaders).toHaveLength(2);
    expect(mutableCacheHeaders.every(({ cacheControl }) => cacheControl?.includes("private") && cacheControl.includes("max-age=3600"))).toBe(true);
    // Two exports, one unchanged-source check and one restore. Only the large
    // restore's part count grows with EDGE_EVER_BACKUP_ATTACHMENT_MIB.
    expect(paths, JSON.stringify(paths)).toHaveLength(61 + Math.ceil(bytes.length / RESOURCE_UPLOAD_PART_BYTES));
    expect(proxyRequests > 0).toBe(proxy);
  } finally { for (const close of cleanup.reverse()) await close(); await rm(directory, { recursive: true, force: true }); }
}, 45000);
