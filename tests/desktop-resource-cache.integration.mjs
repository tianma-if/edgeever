// Run with node. Uses the bundled Electron and an isolated profile, never the
// installed app or a user's live cache. Optional module path supports baselines.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

if (!process.versions.electron) {
  const directory = await mkdtemp(join(tmpdir(), "edgeever-cache-electron-"));
  try {
    const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require("electron"), [fileURLToPath(import.meta.url), directory, ...process.argv.slice(2)], { env, stdio: "inherit" });
    const timeout = setTimeout(() => child.kill(), 30000);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    }).finally(() => clearTimeout(timeout));
    assert.equal(code, 0, "Electron resource cache regression failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  const { app, net } = await import("electron");
  const root = process.argv[2];
  app.setPath("userData", join(root, "profile"));
  app.whenReady().then(async () => {
    let server;
    try {
      const moduleUrl = process.argv[3] ? pathToFileURL(process.argv[3]) : new URL("../apps/desktop/src/main/resource-protocol.mjs", import.meta.url);
      const { createResourceProtocolHandler } = await import(moduleUrl.href);
      const full = randomBytes(5 * 1024 * 1024 + 137);
      const digest = createHash("sha256").update(full).digest("hex");
      let requests = 0;
      server = createServer((request, response) => {
        requests++;
        response.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(full.length) });
        if (request.url.includes("res_cancel")) response.write(full.subarray(0, 180170));
        else response.end(full);
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const directory = join(root, "cache");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(directory);
      const handler = createResourceProtocolHandler({
        getDirectory: () => directory,
        getApiBaseUrl: () => `http://127.0.0.1:${server.address().port}`,
        getRequestHeaders: async () => new Headers(),
        getIntegrity: async () => ({ byteSize: full.length, sha256: digest }),
        fetch: (url, init) => net.fetch(url, init),
      });
      // Recreate the old on-disk format and the exact observed prefix length.
      await writeFile(join(directory, "res_old.bin"), full.subarray(0, 180170));
      await writeFile(join(directory, "res_old.json"), JSON.stringify({ contentType: "image/png" }));
      const opened = await handler(new Request("edgeever-resource://resource/res_old"));
      assert.deepEqual(Buffer.from(await opened.arrayBuffer()), full);
      assert.deepEqual(await readFile(join(directory, "res_old.bin")), full);
      assert.equal(requests, 1);
      assert.deepEqual(Buffer.from(await (await handler(new Request("edgeever-resource://resource/res_old"))).arrayBuffer()), full);
      assert.equal(requests, 1, "verified cache must not download again");

      const cancelled = await handler(new Request("edgeever-resource://resource/res_cancel"));
      const reader = cancelled.body.getReader();
      let received = 0;
      while (received < 180170) received += (await reader.read()).value.byteLength;
      const pending = reader.read();
      // Let the next pull enter net.fetch's pending source read.
      await new Promise(resolve => setTimeout(resolve, 30));
      await reader.cancel();
      await pending;
      assert.deepEqual((await readdir(directory)).sort(), ["res_old.bin", "res_old.json"]);
      console.log(JSON.stringify({ electron: process.versions.electron, legacyCacheRepair: "passed", pendingReadCancellation: "passed", bytes: full.length }));
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    } finally {
      server?.closeAllConnections();
      server?.close();
    }
  });
}
