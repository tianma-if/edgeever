import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DESKTOP_RPC_METHODS,
  DESKTOP_SIDECAR_PROTOCOL_VERSION,
} from "./desktop-rpc.ts";

const rustRpcSource = readFileSync(
  new URL("../../../crates/desktop-sidecar/src/rpc.rs", import.meta.url),
  "utf8",
);
const electronRpcSource = readFileSync(
  new URL("../../../apps/desktop/src/main/rpc.mjs", import.meta.url),
  "utf8",
);

describe("desktop sidecar RPC contract", () => {
  test("keeps the TypeScript method registry aligned with the Rust dispatcher", () => {
    const dispatcherStart = rustRpcSource.indexOf("match request.method.as_str()");
    const dispatcherEnd = rustRpcSource.indexOf("\n    }\n}\n\nfn chrono_like_now", dispatcherStart);
    const dispatcher = rustRpcSource.slice(dispatcherStart, dispatcherEnd);
    const rustMethods = [...dispatcher.matchAll(/"([^"]+)"\s*=>/g)]
      .map((match) => match[1])
      .filter((method) => method !== "app.shutdown")
      .sort();

    expect([...DESKTOP_RPC_METHODS].sort()).toEqual(rustMethods);
  });

  test("keeps the native and Electron protocol guards aligned", () => {
    const rustVersion = Number(rustRpcSource.match(/const PROTOCOL_VERSION: i64 = (\d+);/)?.[1]);
    const electronVersion = Number(
      electronRpcSource.match(/SIDECAR_PROTOCOL_VERSION = (\d+);/)?.[1],
    );

    expect(rustVersion).toBe(DESKTOP_SIDECAR_PROTOCOL_VERSION);
    expect(electronVersion).toBe(DESKTOP_SIDECAR_PROTOCOL_VERSION);
  });
});
