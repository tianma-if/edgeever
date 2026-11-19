import { describe, expect, test } from "bun:test";
import { getAttachmentByteSizeFromResponse } from "./attachment-byte-size.ts";

describe("attachment byte size discovery", () => {
  test("reads the complete size from a one-byte range response", () => {
    const response = new Response(new Uint8Array([1]), {
      status: 206,
      headers: {
        "Content-Length": "1",
        "Content-Range": "bytes 0-0/856000",
      },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBe(856000);
  });

  test("falls back to Content-Length for a full response", () => {
    const response = new Response(null, {
      status: 200,
      headers: { "Content-Length": "2048" },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBe(2048);
  });

  test("does not mistake a partial Content-Length for the complete size", () => {
    const response = new Response(new Uint8Array([1]), {
      status: 206,
      headers: { "Content-Length": "1" },
    });

    expect(getAttachmentByteSizeFromResponse(response)).toBeNull();
  });
});

test("uses authorized metadata without reading attachment bytes, retaining old-server compatibility", async () => {
  const { fetchAttachmentByteSize } = await import("./attachment-byte-size.ts");
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  globalThis.window = { location: { origin: "https://notes.example" } };
  let calls = [];
  try {
    globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({ byteSize: 8192 }); };
    expect(await fetchAttachmentByteSize("/api/v1/resources/r1/blob")).toBe(8192);
    expect(calls).toEqual(["https://notes.example/api/v1/resources/r1/metadata"]);
    calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return String(url).endsWith("/metadata") ? new Response(null, { status: 404 })
        : new Response("x", { status: 206, headers: { "Content-Range": "bytes 0-0/4096" } });
    };
    expect(await fetchAttachmentByteSize("/api/v1/resources/r1/blob")).toBe(4096);
    expect(calls.length).toBe(2);
    for (const status of [401, 403, 429, 500]) {
      calls = [];
      globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(null, { status }); };
      expect(await fetchAttachmentByteSize("/api/v1/resources/r1/blob")).toBeNull();
      expect(calls.length).toBe(1);
    }
  } finally { globalThis.window = oldWindow; globalThis.fetch = oldFetch; }
});

test("does not redownload a missing resource or treat a packaged desktop origin as a Web API origin", async () => {
  const { fetchAttachmentByteSize } = await import("./attachment-byte-size.ts");
  const oldWindow = globalThis.window, oldFetch = globalThis.fetch;
  try {
    globalThis.window = { location: { origin: "https://notes.example" } };
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "resource_not_found" } }, { status: 404 }); };
    expect(await fetchAttachmentByteSize("/api/v1/resources/missing/blob")).toBeNull();
    expect(calls).toBe(1);
    globalThis.window = { location: { origin: "null" } };
    let requested;
    globalThis.fetch = async (url) => { requested = String(url); return new Response("x", { headers: { "Content-Length": "1" } }); };
    expect(await fetchAttachmentByteSize("https://notes.example/api/v1/resources/r1/blob")).toBe(1);
    expect(requested).toBe("https://notes.example/api/v1/resources/r1/blob");
  } finally { globalThis.window = oldWindow; globalThis.fetch = oldFetch; }
});
