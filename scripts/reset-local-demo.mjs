import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, openSync, closeSync, realpathSync, readdirSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchEdgeEverApp } from "../apps/api/src/index.ts";
import { createCloudflareStorageAdapter } from "../apps/api/src/cloudflare-storage-adapter.ts";
import { DEMO_SEED_MEMO_IDS, DEMO_SEED_NOTEBOOK_IDS } from "../apps/api/src/demo-seed-data.ts";
import { findLocalD1DatabasePaths } from "./local-dev.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const assertLocalResetPath = (root) => {
  root = realpathSync(root);
  const statePath = resolve(root, ".wrangler/state");
  // Never follow a developer's symlink to another repository or data volume.
  for (const path of [resolve(root, ".wrangler"), statePath, resolve(statePath, "v3")]) {
    if (existsSync(path) && realpathSync(path) !== path) {
      throw new Error(`Refusing symlinked local state: ${path}`);
    }
  }
  const inspect = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked local state: ${path}`);
      if (entry.isDirectory()) inspect(path);
    }
  };
  inspect(statePath);
  return statePath;
};

export const restoreLocalDemoData = async (storage) => {
  // Demo reset may delete S3 objects. Refuse external storage, including an
  // active external default used when recreating the example attachments.
  const external = await storage.db.prepare(
    "SELECT id FROM object_storage_configs WHERE provider <> 'builtin' LIMIT 1",
  ).first();
  if (external) throw new Error("Local Demo reset requires built-in local object storage; external storage is configured.");

  const response = await fetchEdgeEverApp(
    new Request("http://localhost/api/v1/demo/reset", { method: "POST" }),
    {
      storage,
      EDGE_EVER_DEMO_MODE: "true",
      EDGE_EVER_ALLOW_UNAUTHENTICATED: "true",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
  if (!response.ok) {
    const body = await response.json();
    throw new Error(`Local Demo reset failed: ${body.error?.message || response.status}`);
  }
  const memos = (await storage.db.prepare("SELECT id FROM memos ORDER BY id").all()).results.map((row) => row.id);
  const notebooks = (await storage.db.prepare("SELECT id FROM notebooks ORDER BY id").all()).results.map((row) => row.id);
  if (JSON.stringify(memos) !== JSON.stringify([...DEMO_SEED_MEMO_IDS].sort())
    || JSON.stringify(notebooks) !== JSON.stringify([...DEMO_SEED_NOTEBOOK_IDS].sort())) {
    throw new Error("Local Demo reset completed but the restored IDs do not match the repository seed.");
  }
  return { memoCount: memos.length, notebookCount: notebooks.length };
};

const main = async () => {
  if (process.argv.length > 2) {
    throw new Error("Usage: bun run dev:reset (local data only; no arguments)");
  }
  process.chdir(projectRoot);
  const statePath = assertLocalResetPath(projectRoot);
  const paths = findLocalD1DatabasePaths(statePath);
  if (paths.length !== 1) throw new Error("Expected one local DEV database. Run bun run dev:prepare first.");
  if (realpathSync(paths[0]) !== paths[0]) throw new Error("Refusing symlinked local database.");
  mkdirSync(resolve(projectRoot, ".wrangler"), { recursive: true });
  const lockPath = resolve(projectRoot, ".wrangler/local-demo-reset.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("A local reset lock exists. Wait for the reset to finish; see docs/local-dev-reset.md if it was interrupted.");
    throw error;
  }
  let proxy;
  try {
    // Use Wrangler's existing D1/R2 driver and persistence layout. No listener,
    // deployment, remote bindings, instance secrets, or generated config edits.
    const require = createRequire(resolve(projectRoot, "packages/wrangler/package.json"));
    const { getPlatformProxy } = require("edgeever-wrangler-cli");
    proxy = await getPlatformProxy({
      configPath: resolve(projectRoot, "wrangler.toml"),
      envFiles: [],
      persist: { path: resolve(statePath, "v3") },
      remoteBindings: false,
    });
    const storage = createCloudflareStorageAdapter(proxy.env);
    const sqlite = new Database(paths[0], { readonly: true });
    try {
      const expected = sqlite.query("SELECT created_at FROM workspaces WHERE id = 'ws_default'").get();
      const actual = await storage.db.prepare("SELECT created_at FROM workspaces WHERE id = 'ws_default'").first();
      if (!expected || actual?.created_at !== expected.created_at) {
        throw new Error("Wrangler bindings do not match the local DEV database; refusing reset.");
      }
    } finally {
      sqlite.close();
    }
    console.log(`[local-reset] Replacing notes, notebooks, attachments, revisions and API tokens in ${statePath}`);
    const result = await restoreLocalDemoData(storage);
    console.log(`[local-reset] Restored ${result.memoCount} Demo notes and ${result.notebookCount} notebooks. Accounts and AI settings preserved.`);
    console.log("[local-reset] Refresh http://127.0.0.1:5173/ to reload the clean workspace. Start stopped services with bun run dev.");
  } finally {
    try { await proxy?.dispose(); } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  }
};

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[local-reset] ${error.message}`);
    process.exitCode = 1;
  });
}
