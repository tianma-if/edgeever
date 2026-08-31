import { Database } from "bun:sqlite";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasBootstrapCredential } from "../apps/api/src/auth-bootstrap.ts";
import { isUnauthenticatedAccessEnabled } from "../apps/api/src/auth-state.ts";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";
import { createS3CompatibleStorageAdapter } from "../apps/api/src/s3-compatible-storage-adapter.ts";
import { resolveSelfHostedConfig } from "./self-hosted-config.mjs";
import { loadSelfHostedEnvironment } from "./self-hosted-secrets.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEnvironment = await loadSelfHostedEnvironment(process.env);
const config = resolveSelfHostedConfig(runtimeEnvironment, projectRoot);
const { dataDirectory, databaseFile, resourcesDirectory, webDirectory } = config;

await mkdir(dataDirectory, { recursive: true });
await mkdir(resourcesDirectory, { recursive: true });
const sqlite = new Database(databaseFile, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");

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

const existingUser = sqlite.query("SELECT id FROM users WHERE is_disabled = 0 LIMIT 1").get();
if (
  !existingUser
  && !hasBootstrapCredential(runtimeEnvironment.EDGE_EVER_AUTH_PASSWORD, runtimeEnvironment.EDGE_EVER_AUTH_PASSWORD_HASH)
  && !isUnauthenticatedAccessEnabled(runtimeEnvironment.EDGE_EVER_ALLOW_UNAUTHENTICATED)
) {
  sqlite.close();
  throw new Error(
    "Authentication is not configured. Set EDGE_EVER_AUTH_PASSWORD (recommended), "
    + "EDGE_EVER_AUTH_PASSWORD_HASH, or explicitly set EDGE_EVER_ALLOW_UNAUTHENTICATED=true.",
  );
}

const storage = config.storageBackend === "s3"
  ? createS3CompatibleStorageAdapter(sqlite, {
      bucket: runtimeEnvironment.EDGE_EVER_S3_BUCKET ?? "",
      region: runtimeEnvironment.EDGE_EVER_S3_REGION,
      endpoint: runtimeEnvironment.EDGE_EVER_S3_ENDPOINT,
      accessKeyId: runtimeEnvironment.EDGE_EVER_S3_ACCESS_KEY_ID,
      secretAccessKey: runtimeEnvironment.EDGE_EVER_S3_SECRET_ACCESS_KEY,
      forcePathStyle: runtimeEnvironment.EDGE_EVER_S3_FORCE_PATH_STYLE
        ? runtimeEnvironment.EDGE_EVER_S3_FORCE_PATH_STYLE === "true"
        : undefined,
    })
  : createSelfHostedStorageAdapter(sqlite, resourcesDirectory);
const env = {
  storage,
  EDGE_EVER_AUTH_USERNAME: runtimeEnvironment.EDGE_EVER_AUTH_USERNAME ?? "admin",
  EDGE_EVER_RUNTIME: "self-hosted-bun",
  EDGE_EVER_CONTAINER_IMAGE: runtimeEnvironment.EDGE_EVER_CONTAINER_IMAGE,
  EDGE_EVER_AUTH_PASSWORD: runtimeEnvironment.EDGE_EVER_AUTH_PASSWORD,
  EDGE_EVER_AUTH_PASSWORD_HASH: runtimeEnvironment.EDGE_EVER_AUTH_PASSWORD_HASH,
  EDGE_EVER_SESSION_TTL_DAYS: runtimeEnvironment.EDGE_EVER_SESSION_TTL_DAYS ?? "400",
  EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS: runtimeEnvironment.EDGE_EVER_AUTH_LOGIN_WINDOW_SECONDS,
  EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS: runtimeEnvironment.EDGE_EVER_AUTH_LOGIN_USERNAME_MAX_ATTEMPTS,
  EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS: runtimeEnvironment.EDGE_EVER_AUTH_LOGIN_USERNAME_COOLDOWN_SECONDS,
  EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS: runtimeEnvironment.EDGE_EVER_AUTH_LOGIN_IP_MAX_ATTEMPTS,
  EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS: runtimeEnvironment.EDGE_EVER_AUTH_LOGIN_IP_COOLDOWN_SECONDS,
  EDGE_EVER_STORAGE_ENCRYPTION_KEY: runtimeEnvironment.EDGE_EVER_STORAGE_ENCRYPTION_KEY,
  EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY: runtimeEnvironment.EDGE_EVER_CREDENTIALS_ENCRYPTION_KEY,
  EDGE_EVER_DEMO_MODE: runtimeEnvironment.EDGE_EVER_DEMO_MODE,
  EDGE_EVER_ALLOW_UNAUTHENTICATED: runtimeEnvironment.EDGE_EVER_ALLOW_UNAUTHENTICATED,
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
  hostname: config.hostname,
  port: config.port,
  // Model providers may take longer than Bun's 10-second default to emit the
  // first streaming token. Keep the connection alive within Bun's supported range.
  idleTimeout: config.idleTimeout,
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      return fetchEdgeEverApp(request, env, executionContext);
    }
    return serveStatic(request);
  },
});

console.log(`[self-hosted] listening on ${server.url}`);
console.log(`[self-hosted] data directory: ${dataDirectory}`);
console.log(`[self-hosted] storage backend: ${config.storageBackend}`);
console.log(`[self-hosted] idle timeout: ${config.idleTimeout}s`);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[self-hosted] received ${signal}; shutting down`);

  try {
    await server.stop();
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    sqlite.close();
    console.log("[self-hosted] shutdown complete");
  } catch (error) {
    console.error("[self-hosted] shutdown failed", error);
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
