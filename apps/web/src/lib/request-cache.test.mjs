import { expect, test } from "bun:test";
import { createRequestCache } from "./request-cache.ts";

test("coalesces 100 concurrent public lookups, expires, and allows explicit refresh", async () => {
  let now = 0, calls = 0;
  const cached = createRequestCache({ ttlMs: 60_000, now: () => now });
  const load = async () => ++calls;
  expect(await Promise.all(Array.from({ length: 100 }, () => cached("repo-a", load)))).toEqual(Array(100).fill(1));
  expect(await cached("repo-a", load)).toBe(1);
  expect(await cached("repo-b", load)).toBe(2);
  expect(await cached("repo-a", load, true)).toBe(3);
  now = 60_001;
  expect(await cached("repo-a", load)).toBe(4);
});

test("does not cache errors or evict a newer retry when an older request fails", async () => {
  const cached = createRequestCache({ ttlMs: 60_000, limit: 1 });
  let fail;
  const old = cached("a", () => new Promise((_, reject) => { fail = reject; }));
  await Promise.resolve();
  await cached("b", async () => "b");
  expect(await cached("a", async () => "fresh")).toBe("fresh");
  fail(new Error("offline"));
  await expect(old).rejects.toThrow("offline");
  expect(await cached("a", async () => "wrong")).toBe("fresh");
});
