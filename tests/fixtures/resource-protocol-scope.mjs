import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await fsp.mkdtemp(join(tmpdir(), "edgeever-resource-scope-"));
const path = join(root, "res_1.bin");
let scope = "a", stream;
const stat = fsp.stat, createReadStream = fs.createReadStream;
await fsp.writeFile(path, "cached attachment bytes");
fsp.stat = async (...args) => {
  const result = await stat(...args);
  if (args[0] === path) scope = "b";
  return result;
};
fs.createReadStream = (value, options) => {
  stream = createReadStream(value, { ...options, highWaterMark: 1 });
  return stream;
};
syncBuiltinESMExports();
const { createResourceProtocolHandler } = await import("../../apps/desktop/src/main/resource-protocol.mjs");
try {
  const handler = createResourceProtocolHandler({
    getDirectory: () => root, getApiBaseUrl: () => "http://local.test",
    getRequestHeaders: async () => new Headers(),
    fetch: async () => new Response("Unavailable", { status: 503 }),
  });
  await assert.rejects(handler(new Request("edgeever-resource://resource/res_1", { cache: "reload" }), () => {
    if (scope !== "a") throw new Error("Account changed");
  }), /Account changed/);
  assert.ok(stream);
  assert.equal(stream.destroyed, true, "a rejected cached response must close its file stream");
} finally { stream?.destroy(); await fsp.rm(root, { recursive: true, force: true }); }
