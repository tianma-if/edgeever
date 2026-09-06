import { expect, test } from "bun:test";
import {
  cachedResourceResponse,
  isSafeResourceId,
  parseByteRangeHeader,
  resourceIdFromRequest,
} from "./resource-url.mjs";

test("desktop resource URL parsing accepts safe resource and staged IDs", () => {
  expect(resourceIdFromRequest("edgeever-resource://resource/resource_123")).toBe("resource_123");
  expect(resourceIdFromRequest("edgeever-staged://stage_123")).toBe("stage_123");
  expect(resourceIdFromRequest("edgeever-staged://stage%5F123")).toBe("stage_123");
  expect(resourceIdFromRequest("edgeever-staged://bad/id")).toBe("id");
  expect(resourceIdFromRequest("edgeever-staged://../../etc/passwd")).toBeNull();
  expect(resourceIdFromRequest("edgeever-staged://stage_%ZZ")).toBeNull();
});

test("desktop staged resource IPC IDs reject path traversal", () => {
  expect(isSafeResourceId("stage_123")).toBe(true);
  expect(isSafeResourceId("../edgeever.sqlite")).toBe(false);
  expect(isSafeResourceId("stage/123")).toBe(false);
  expect(isSafeResourceId("..")).toBe(false);
});

test("desktop resource range parser supports bounded, open, and suffix ranges", () => {
  expect(parseByteRangeHeader("bytes=2-5", 10)).toEqual({ kind: "range", offset: 2, length: 4 });
  expect(parseByteRangeHeader("bytes=7-", 10)).toEqual({ kind: "range", offset: 7, length: 3 });
  expect(parseByteRangeHeader("bytes=-4", 10)).toEqual({ kind: "range", offset: 6, length: 4 });
  expect(parseByteRangeHeader("bytes=10-", 10)).toEqual({ kind: "invalid" });
  expect(parseByteRangeHeader("bytes=0-1,4-5", 10)).toEqual({ kind: "invalid" });
});

test("desktop cached resources return 206 slices and 416 for invalid ranges", async () => {
  const bytes = new TextEncoder().encode("0123456789");
  const partial = cachedResourceResponse(bytes, "application/pdf", "bytes=2-5");
  expect(partial.status).toBe(206);
  expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
  expect(partial.headers.get("accept-ranges")).toBe("bytes");
  expect(await partial.text()).toBe("2345");

  const invalid = cachedResourceResponse(bytes, "application/pdf", "bytes=20-");
  expect(invalid.status).toBe(416);
  expect(invalid.headers.get("content-range")).toBe("bytes */10");
});
