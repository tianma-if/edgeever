import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const sidecarPath = process.env.EDGE_EVER_SIDECAR_PATH
  ?? join(process.cwd(), "crates/desktop-sidecar/target/debug/edgeever-sidecar");
const migrationsPath = process.env.EDGE_EVER_MIGRATIONS_PATH ?? join(process.cwd(), "migrations");
const dataPath = join(tmpdir(), `edgeever-sidecar-benchmark-${randomUUID()}`);

if (!existsSync(sidecarPath)) {
  throw new Error(`Sidecar not found: ${sidecarPath}`);
}
mkdirSync(dataPath, { recursive: true });

const startedAt = performance.now();
const child = spawn(sidecarPath, ["--data-dir", dataPath, "--migrations-dir", migrationsPath], {
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout });
const messages = [];
lines.on("line", (line) => {
  try {
    messages.push(JSON.parse(line));
  } catch {
    // Ignore diagnostic output that is not JSON-RPC.
  }
});

const waitFor = async (predicate, timeoutMs = 10000) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for sidecar response");
};

let nextRequestId = 1;
const request = async (method, params = {}) => {
  const id = nextRequestId++;
  const startedAt = performance.now();
  child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  const response = await waitFor((message) => message.id === id);
  if (response.error) throw new Error(response.error.message || `${method} failed`);
  return { result: response.result, elapsedMs: performance.now() - startedAt };
};

await waitFor((message) => message.event === "ready");
const readyMs = performance.now() - startedAt;
const health = await request("storage.health");
const notebooks = await request("notebook.list");
const notebookId = notebooks.result.notebooks.find((notebook) => notebook.slug === "inbox")?.id ?? notebooks.result.notebooks[0]?.id;
if (!notebookId) throw new Error("No notebook available for benchmark");
const created = await request("memo.create", { notebookId, title: "Benchmark memo", contentMarkdown: "Local benchmark content", tags: [] });
const listed = await request("memo.list", { notebookId, limit: 50 });
const detailed = await request("memo.get", { memoId: created.result.memo.id });
child.stdin.end();

console.log(JSON.stringify({
  sidecarPath,
  readyMs: Number(readyMs.toFixed(2)),
  storageHealthMs: Number(health.elapsedMs.toFixed(2)),
  memoListMs: Number(listed.elapsedMs.toFixed(2)),
  memoDetailMs: Number(detailed.elapsedMs.toFixed(2)),
  memoCreateMs: Number(created.elapsedMs.toFixed(2)),
  storageHealthy: health.result?.ok === true,
  memoListHealthy: listed.result?.memos?.some((memo) => memo.id === created.result.memo.id) === true,
  thresholds: {
    ready: readyMs < 500,
    storageHealth: health.elapsedMs < 20,
    memoList: listed.elapsedMs < 50,
    memoDetail: detailed.elapsedMs < 20,
    memoCreate: created.elapsedMs < 50,
  },
}, null, 2));
