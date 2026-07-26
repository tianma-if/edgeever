import { Database } from "bun:sqlite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { createS3CompatibleStorageAdapter } from "../apps/api/src/s3-compatible-storage-adapter.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(process.env.EDGE_EVER_DATA_DIR ?? join(projectRoot, ".edgeever-data"));
const databaseFile = resolve(process.env.EDGE_EVER_SQLITE_FILE ?? join(dataDirectory, "edgeever.sqlite"));
const resourcesDirectory = resolve(process.env.EDGE_EVER_RESOURCES_DIR ?? join(dataDirectory, "resources"));
const webDirectory = resolve(process.env.EDGE_EVER_WEB_DIR ?? join(projectRoot, "apps/web/dist"));
const port = Number(process.env.PORT ?? process.env.EDGE_EVER_PORT ?? 8787);

await mkdir(dataDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
const sqlite = new Database(databaseFile, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");

const migrationFiles = (await readdir(join(projectRoot, "migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort();

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS _edgeever_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`);

const appliedMigrations = new Set(
  sqlite.query("SELECT name FROM _edgeever_migrations").all().map((row) => row.name),
);

for (const name of migrationFiles) {
  if (appliedMigrations.has(name)) {
    continue;
  }

  const sql = await readFile(join(projectRoot, "migrations", name), "utf8");
  sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite.query("INSERT INTO _edgeever_migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
  })();
  console.log(`[self-hosted] applied migration ${name}`);
}

const storageBackend = process.env.EDGE_EVER_STORAGE_BACKEND ?? "local";
const storage = storageBackend === "s3"
  ? createS3CompatibleStorageAdapter(sqlite, {
      bucket: process.env.EDGE_EVER_S3_BUCKET ?? "",
      region: process.env.EDGE_EVER_S3_REGION,
      endpoint: process.env.EDGE_EVER_S3_ENDPOINT,
      accessKeyId: process.env.EDGE_EVER_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.EDGE_EVER_S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.EDGE_EVER_S3_FORCE_PATH_STYLE
        ? process.env.EDGE_EVER_S3_FORCE_PATH_STYLE === "true"
        : undefined,
    })
  : createSelfHostedStorageAdapter(sqlite, resourcesDirectory);

if (storageBackend === "s3" && !process.env.EDGE_EVER_S3_BUCKET) {
  throw new Error("EDGE_EVER_S3_BUCKET is required when EDGE_EVER_STORAGE_BACKEND=s3");
}
const env = {
  DB: storage.db,
  RESOURCES: storage.resources,
  EDGE_EVER_AUTH_USERNAME: process.env.EDGE_EVER_AUTH_USERNAME ?? "admin",
  EDGE_EVER_RUNTIME: "self-hosted-bun",
  EDGE_EVER_AUTH_PASSWORD: process.env.EDGE_EVER_AUTH_PASSWORD,
  EDGE_EVER_AUTH_PASSWORD_HASH: process.env.EDGE_EVER_AUTH_PASSWORD_HASH,
  EDGE_EVER_SESSION_TTL_DAYS: process.env.EDGE_EVER_SESSION_TTL_DAYS ?? "400",
  EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS: process.env.EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS,
  EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: process.env.EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS,
  EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS: process.env.EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS,
  EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: process.env.EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS,
  EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS: process.env.EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS,
  EDGE_EVER_DEMO_MODE: process.env.EDGE_EVER_DEMO_MODE,
  EDGE_EVER_ALLOW_UNAUTHENTICATED: process.env.EDGE_EVER_ALLOW_UNAUTHENTICATED,
};

const executionContext = {
  waitUntil: (promise) => Promise.resolve(promise).catch((error) => console.error("[self-hosted] background task failed", error)),
  passThroughOnException: () => undefined,
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const serveStatic = async (request) => {
  const url = new URL(request.url);
  const requestedPath = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  const candidate = resolve(webDirectory, `.${requestedPath}`);
  const relativeCandidate = relative(webDirectory, candidate);

  if (relativeCandidate.startsWith("..") || relativeCandidate.includes(".." + "/")) {
    return new Response("Not Found", { status: 404 });
  }

  const file = Bun.file(candidate);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "Content-Type": contentTypes[extname(candidate)] ?? "application/octet-stream" },
    });
  }

  const index = Bun.file(join(webDirectory, "index.html"));
  return (await index.exists())
    ? new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    : new Response("Web build not found. Run bun run build:web first.", { status: 503 });
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      return worker.fetch(request, env, executionContext);
    }
    return serveStatic(request);
  },
});

console.log(`[self-hosted] listening on ${server.url}`);
console.log(`[self-hosted] data directory: ${dataDirectory}`);
console.log(`[self-hosted] storage backend: ${storageBackend}`);
