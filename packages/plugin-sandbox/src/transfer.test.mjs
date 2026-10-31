import { describe, expect, test } from "bun:test";
import {
  base64ToBytes,
  bytesToBase64,
  deserializeBlob,
  deserializeBody,
  deserializeResponse,
  headersToEntries,
  serializeBlob,
  serializeBody,
  serializeResponse,
} from "./transfer.ts";

describe("base64 helpers", () => {
  test("round-trips binary data", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
  test("round-trips utf-8 text", () => {
    const text = "Halo 插件发布测试 ✅";
    expect(new TextDecoder().decode(base64ToBytes(bytesToBase64(new TextEncoder().encode(text))))).toBe(text);
  });
});

describe("serializeBody", () => {
  test("serializes strings and URLSearchParams as text", async () => {
    expect(await serializeBody("hello")).toEqual({ kind: "text", text: "hello" });
    expect(await serializeBody(new URLSearchParams({ a: "1" }))).toEqual({ kind: "text", text: "a=1" });
    expect(await serializeBody(null)).toEqual({ kind: "none" });
  });

  test("serializes blobs to base64", async () => {
    const body = await serializeBody(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    expect(body.kind).toBe("base64");
    expect(body.mimeType).toBe("image/png");
    expect([...base64ToBytes(body.data)]).toEqual([1, 2, 3]);
  });

  test("round-trips FormData with text and file parts", async () => {
    const form = new FormData();
    form.append("title", "笔记");
    form.append("file", new File([new Uint8Array([9, 8, 7])], "image.png", { type: "image/png" }));
    const serialized = await serializeBody(form);
    expect(serialized.kind).toBe("form-data");
    expect(serialized.parts).toHaveLength(2);
    expect(serialized.parts[0]).toEqual({ name: "title", value: "笔记" });
    expect(serialized.parts[1]).toMatchObject({ name: "file", filename: "image.png", mimeType: "image/png" });

    const restored = deserializeBody(serialized);
    expect(restored).toBeInstanceOf(FormData);
    expect(restored.get("title")).toBe("笔记");
    const file = restored.get("file");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("image.png");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([9, 8, 7]);
  });
});

describe("serializeResponse", () => {
  test("round-trips text responses", async () => {
    const original = new Response(JSON.stringify({ ok: true }), {
      status: 201,
      statusText: "Created",
      headers: { "content-type": "application/json", "x-test": "1" },
    });
    const payload = await serializeResponse(original);
    expect(payload.status).toBe(201);
    expect(payload.body).toEqual({ kind: "text", text: '{"ok":true}' });
    const restored = deserializeResponse(payload);
    expect(restored.status).toBe(201);
    expect(restored.headers.get("x-test")).toBe("1");
    expect(await restored.text()).toBe('{"ok":true}');
  });

  test("keeps binary bodies as base64 and skips 204 bodies", async () => {
    const binary = await serializeResponse(new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "application/octet-stream" },
    }));
    expect(binary.body.kind).toBe("base64");
    expect([...base64ToBytes(binary.body.data)]).toEqual([1, 2, 3]);

    const empty = await serializeResponse(new Response(null, { status: 204 }));
    expect(empty.body).toBeUndefined();
  });

  test("serializes headers to entries", () => {
    expect(headersToEntries({ Authorization: "Bearer x" })).toEqual([["authorization", "Bearer x"]]);
  });
});

describe("blob helpers", () => {
  test("round-trips blobs", async () => {
    const payload = await serializeBlob(new Blob([new Uint8Array([5, 6])], { type: "image/webp" }));
    expect(payload.mimeType).toBe("image/webp");
    const blob = deserializeBlob(payload);
    expect(blob.type).toBe("image/webp");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([5, 6]);
  });
});
