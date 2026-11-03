// Loopback-only real API/storage fixture for desktop offline upgrade verification.
import { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createSelfHostedStorageAdapter } from "../apps/api/src/self-hosted-storage-adapter.ts";

const directory = process.argv[2];
if (!directory) throw new Error("Pass an isolated test directory");
const database = new Database(join(directory, "api.sqlite"));
for (const name of (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort()) {
  database.exec(await readFile(join("migrations", name), "utf8"));
}
const environment = {
  storage: createSelfHostedStorageAdapter(database, join(directory, "resources")),
  EDGE_EVER_AUTH_PASSWORD: "offline-test-password-only",
  EDGE_EVER_RUNTIME: "self-hosted-bun",
};
let mode = "healthy";
const counters = {};
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/__test/control" && request.method === "POST") {
    const input = await request.json();
    mode = input.mode;
    if (input.revoke) database.exec("DELETE FROM sessions");
    return Response.json({ mode });
  }
  if (path === "/__test/status") return Response.json({ mode, counters });
  const cors = {
    "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "null",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Vary": "Origin",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  counters[path] = (counters[path] ?? 0) + 1;
  if (mode !== "healthy") {
    const status = mode === "protected401" && path !== "/api/v1/auth/session" ? 401
      : mode === "500" ? 500 : 503;
    return Response.json({ error: { code: status === 401 ? "unauthorized" : "database_daily_quota_exceeded", message: "Test server unavailable" } }, { status, headers: cors });
  }
  return fetchEdgeEverApp(request, environment, { waitUntil() {}, passThroughOnException() {} });
} });
process.stdin.on("end", () => { server.stop(true); database.close(); process.exit(0); });
process.stdin.resume();
console.log(`READY http://127.0.0.1:${server.port}`);
