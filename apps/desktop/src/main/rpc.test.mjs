import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { SidecarRpcClient, SIDECAR_PROTOCOL_VERSION } from "./rpc.mjs";

const createChild = () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  return child;
};

test("sidecar RPC client accepts the supported protocol", async () => {
  const child = createChild();
  const client = new SidecarRpcClient(child);
  const ready = client.waitUntilReady(100);
  child.stdout.write(`${JSON.stringify({ event: "ready", protocolVersion: SIDECAR_PROTOCOL_VERSION })}\n`);
  await assert.doesNotReject(ready);
});

test("sidecar RPC client rejects an incompatible protocol before requests start", async () => {
  const child = createChild();
  const client = new SidecarRpcClient(child);
  child.stdout.write(`${JSON.stringify({ event: "ready", protocolVersion: SIDECAR_PROTOCOL_VERSION + 1 })}\n`);
  await assert.rejects(
    client.waitUntilReady(100),
    /Unsupported EdgeEver sidecar protocol/,
  );
});
