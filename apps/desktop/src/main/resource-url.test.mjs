import { expect, test } from "bun:test";
import { isSafeResourceId, resourceIdFromRequest } from "./resource-url.mjs";

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
