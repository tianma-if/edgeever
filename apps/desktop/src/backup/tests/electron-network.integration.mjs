import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { fetchEdgeEverApp } from "../../../../api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../../../../api/src/self-hosted-storage-adapter.ts";
import { createEdgeEverClient } from "../../../../../packages/client/src/index.ts";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const electron = require("electron");
const trace = (...values) => { if (process.env.EDGE_EVER_BACKUP_TRACE === "1") console.error(...values); };
for (const proxy of [true, false]) test(`Electron backups export and restore through ${proxy ? "the session proxy" : "a direct connection"}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-electron-backup-"));
  const cleanup = [];
  const paths = [];
  const auth = [];
  let hanging = false;
  try {
    const instance = async name => {
      const folder = join(directory, name); await mkdir(folder);
      const database = new Database(join(folder, "database.sqlite"));
      for (const file of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) database.exec(await readFile(join("migrations", file), "utf8"));
      const environment = { storage: createSelfHostedStorageAdapter(database, join(folder, "resources")), EDGE_EVER_ALLOW_UNAUTHENTICATED: "true", EDGE_EVER_RUNTIME: "self-hosted-bun" };
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/__fixture/status") return Response.json({ hanging });
        if (path.startsWith("/hang/")) { hanging = true; return new Promise((resolve) => request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })), { once: true })); }
        if (path.startsWith("/failure/")) return Response.json({ error: { code: "fixture_unavailable", message: "Fixture unavailable" } }, { status: 503 });
        if (request.headers.get("authorization") === "Bearer fixture-bearer") { paths.push(`${name}:${request.method} ${path}${new URL(request.url).search}`); auth.push({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie") }); }
        trace(name, request.method, path);
        return fetchEdgeEverApp(request, environment, { waitUntil() {}, passThroughOnException() {} }).then(response => {
          trace(name, request.method, path, response.status); return response;
        });
      } });
      cleanup.push(() => { server.stop(true); database.close(); });
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

    let proxyRequests = 0;
    const forwarder = createServer((request, response) => {
      proxyRequests++;
      const url = new URL(request.url);
      trace("proxy start", request.method, url.pathname);
      const upstream = httpRequest({ hostname: "127.0.0.1", port: url.port, method: request.method, path: url.pathname + url.search, headers: request.headers }, result => {
        trace("proxy response", request.method, url.pathname, result.statusCode);
        response.writeHead(result.statusCode, result.headers); result.pipe(response);
      });
      upstream.on("finish", () => trace("proxy sent", request.method, url.pathname));
      response.on("finish", () => trace("proxy finish", request.method, url.pathname));
      upstream.on("error", () => response.destroy());
      response.on("close", () => { if (!response.writableFinished) upstream.destroy(); });
      request.pipe(upstream);
    });
    await new Promise(resolve => forwarder.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => { forwarder.closeAllConnections(); forwarder.close(); });
    const settings = { directory, source: proxy ? source.url.replace("127.0.0.1", "backup-fixture.invalid") : source.url,
      target: proxy ? target.url.replace("127.0.0.1", "backup-fixture.invalid") : target.url,
      control: `${source.url}/__fixture/status`, proxy: proxy ? `http=127.0.0.1:${forwarder.address().port}` : null,
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
    expect(report.archiveBytes).toBeGreaterThan(bytes.length);
    expect(report.workersExited).toBe(settings.baseline ? 0 : 5);
    expect((await target.client.getMemo(memo.id)).memo.contentMarkdown).toBe("Streaming backup and restore");
    const restored = await target.client.getResourceResponse(`/api/v1/resources/${resource.id}/blob`);
    expect(new Uint8Array(await restored.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(auth.every(value => value.authorization === "Bearer fixture-bearer" && value.cookie === null)).toBe(true);
    expect(paths.filter(path => path === "source:GET /api/v1/backups/state")).toHaveLength(3);
    expect(paths.filter(path => path.startsWith("source:GET /api/v1/backups/data"))).toHaveLength(3);
    expect(paths.filter(path => path.endsWith(`/resources/${resource.id}/blob`))).toHaveLength(1);
    expect(paths).toHaveLength(47);
    expect(proxyRequests > 0).toBe(proxy);
    if (process.env.EDGE_EVER_BACKUP_REPORT) await writeFile(`${process.env.EDGE_EVER_BACKUP_REPORT}-${proxy ? "proxy" : "direct"}.json`, JSON.stringify({ ...report, archive: undefined, paths, proxyRequests }, null, 2));
  } finally { for (const close of cleanup.reverse()) await close(); await rm(directory, { recursive: true, force: true }); }
}, 45000);
