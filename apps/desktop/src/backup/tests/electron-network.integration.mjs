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
const withElectron = async (stage, proxy, run) => {
  const transport = proxy ? "proxy" : "direct";
  const directory = await mkdtemp(join(tmpdir(), "edgeever-electron-backup-"));
  const cleanup = [];
  let proxyRequests = 0;
  try {
    const forwarder = proxy ? Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request, server) {
        proxyRequests++;
        const url = new URL(request.url);
        url.hostname = "127.0.0.1";
        if (stage === "cancellation" && url.pathname !== "/__fixture/status") server.timeout(request, 0);
        trace("proxy", request.method, url.pathname);
        return fetch(new Request(url, request), { proxy: null });
      },
    }) : null;
    if (forwarder) cleanup.push(() => forwarder.stop(true));
    const address = (url) => proxy ? url.replace("127.0.0.1", "backup-fixture.invalid") : url;
    const baseline = process.env.EDGE_EVER_BACKUP_BASELINE === "1";
    const runElectron = async ({ paths, ...fixture }) => {
      const settingsPath = join(directory, "settings.json");
      await writeFile(settingsPath, JSON.stringify({
        ...fixture, stage, directory, baseline,
        proxy: forwarder ? `http=127.0.0.1:${forwarder.port}` : null,
      }));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(electron, [fileURLToPath(new URL("./electron-network-runner.mjs", import.meta.url)), settingsPath], { env, stdio: ["ignore", "pipe", "pipe"] });
      const closed = new Promise((resolve, reject) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
        child.once("error", reject);
      });
      cleanup.push(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await closed.catch(() => {});
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", value => { stdout += value; });
      child.stderr.on("data", value => { stderr += value; process.stderr.write(value); });
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Electron backup ${transport}/${stage} timed out. Last API requests:\n${paths.slice(-10).join("\n")}\n${stderr}`));
        }, 40000);
      });
      const result = await Promise.race([closed, deadline]).finally(() => clearTimeout(timer));
      expect(result, stderr).toEqual({ code: 0, signal: null });
      const report = JSON.parse(stdout.trim().split("\n").at(-1));
      if (process.env.EDGE_EVER_BACKUP_REPORT) {
        const suffix = stage === "round-trip" ? transport : `${transport}-${stage}`;
        await writeFile(`${process.env.EDGE_EVER_BACKUP_REPORT}-${suffix}.json`, JSON.stringify({ ...report, paths, proxyRequests }, null, 2));
      }
      expect(proxyRequests > 0).toBe(proxy);
      return report;
    };
    await run({ stage, directory, cleanup, address, baseline, runElectron });
  } finally {
    for (const close of cleanup.reverse()) await close();
    await rm(directory, { recursive: true, force: true });
  }
};

const roundTrip = async ({ stage, directory, cleanup, address, baseline, runElectron }) => {
  const repeatedExport = stage === "freshness";
  const exportCount = repeatedExport ? 2 : 1;
  const paths = [];
  const auth = [];
  const attachmentCacheHeaders = [];
  let replaceAttachment;
  const instance = async name => {
    const folder = join(directory, name); await mkdir(folder);
    const database = new Database(join(folder, "database.sqlite"));
    for (const file of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", file), "utf8"));
    const environment = { storage: createSelfHostedStorageAdapter(database, join(folder, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (name === "source" && path === "/__fixture/replace-attachment" && request.method === "POST") return replaceAttachment();
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
  // Only the streaming case needs a large attachment. Cache freshness still
  // performs two exports and restores the updated bytes with a small fixture.
  const attachmentSize = repeatedExport ? 64 * 1024 : Number(process.env.EDGE_EVER_BACKUP_ATTACHMENT_MIB ?? 32) * 1024 * 1024;
  const bytes = randomBytes(attachmentSize + 11);
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

  const report = await runElectron({
    paths, source: address(source.url), target: address(target.url),
    control: `${source.url}/__fixture/status`, mutableResourceUrl: mutableResource.url,
  });
  expect(report.archiveBytes).toBeGreaterThan(bytes.length);
  expect(report.workersExited).toBe(baseline ? 0 : repeatedExport ? 4 : 2);
  expect(report.repeatedExport).toBe(repeatedExport);
  expect((await target.client.getMemo(memo.id)).memo.contentMarkdown).toBe("Streaming backup and restore");
  const restored = await target.client.getResourceResponse(`/api/v1/resources/${resource.id}/blob`);
  expect(Buffer.from(await restored.arrayBuffer()).equals(bytes)).toBe(true);
  const restoredMutable = await target.client.getResourceResponse(mutableResource.url);
  expect(Buffer.from(await restoredMutable.arrayBuffer()).equals(mutableBytes)).toBe(true);
  expect(auth.every(value => value.authorization === "Bearer fixture-bearer" && value.cookie === null)).toBe(true);
  expect(paths.filter(path => path === "source:GET /api/v1/backups/state")).toHaveLength(repeatedExport ? 5 : 2);
  expect(paths.filter(path => path.startsWith("source:GET /api/v1/backups/data"))).toHaveLength(3 * exportCount);
  expect(paths.filter(path => path === `source:GET /api/v1/resources/${resource.id}/blob`)).toHaveLength(exportCount);
  expect(paths.filter(path => path === `source:GET /api/v1/resources/${mutableResource.id}/blob`)).toHaveLength(exportCount);
  const mutableCacheHeaders = attachmentCacheHeaders.filter(value => value.path === `/api/v1/resources/${mutableResource.id}/blob`);
  expect(mutableCacheHeaders).toHaveLength(exportCount);
  expect(mutableCacheHeaders.every(({ cacheControl }) => cacheControl?.includes("private") && cacheControl.includes("max-age=3600"))).toBe(true);
  // Only the streaming restore's part count grows with the fixture size.
  const fixedRequests = repeatedExport ? 61 : 44;
  expect(paths, JSON.stringify(paths)).toHaveLength(fixedRequests + Math.ceil(bytes.length / RESOURCE_UPLOAD_PART_BYTES));
};

const fault = (stage) => async ({ cleanup, address, baseline, runElectron }) => {
  const paths = [];
  const credentials = [];
  let hanging = false;
  const fixture = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === "/__fixture/status") return Response.json({ hanging });
      paths.push(`${request.method} ${path}`);
      credentials.push({
        authorization: request.headers.get("authorization"),
        cookie: request.headers.get("cookie"),
      });
      if (stage === "http-503") {
        return Response.json({ error: { code: "fixture_unavailable", message: "Fixture unavailable" } }, { status: 503 });
      }
      // The client, rather than the fixture's idle timer, must cancel this request.
      server.timeout(request, 0);
      hanging = true;
      return new Promise((resolve) => {
        request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })), { once: true });
      });
    },
  });
  cleanup.push(() => fixture.stop(true));
  const url = `http://127.0.0.1:${fixture.port}`;
  const report = await runElectron({ paths, source: address(url), control: `${url}/__fixture/status` });
  expect(report.workersExited).toBe(baseline ? 0 : 1);
  expect(paths).toEqual(["GET /api/v1/backups/state"]);
  expect(credentials).toEqual([{ authorization: "Bearer fixture-bearer", cookie: null }]);
};

for (const proxy of [true, false]) {
  const transport = proxy ? "the session proxy" : "a direct connection";
  test(`Electron backups round trip through ${transport}`, () => withElectron("round-trip", proxy, roundTrip), 45000);
  test(`Electron backup re-exports uncached attachment bytes through ${transport}`, () => withElectron("freshness", proxy, roundTrip), 45000);
  test(`Electron backups report HTTP 503 through ${transport}`, () => withElectron("http-503", proxy, fault("http-503")), 45000);
  test(`Electron backups cancel an in-flight request through ${transport}`, () => withElectron("cancellation", proxy, fault("cancellation")), 45000);
}
