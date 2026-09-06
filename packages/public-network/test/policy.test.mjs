import { expect, test } from "bun:test";
import { isPublicAddress, publicRequestHeaders, publicResponseHeaders, readPublicBody, validatePublicUrl } from "../src/policy.mjs";

test("shared public policy blocks local targets and sensitive headers", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "2001:db8::1"]) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress("8.8.8.8")).toBe(true);
  for (const url of ["http://example.org", "https://localhost", "https://127.0.0.1", "https://metadata.google.internal"]) expect(() => validatePublicUrl(url)).toThrow();
  expect(() => publicRequestHeaders({ Authorization: "secret" })).toThrow();
});

test("shared public policy bounds bodies and response metadata", async () => {
  const headers = publicResponseHeaders(new Headers({ "Content-Type": "text/plain", "Set-Cookie": "secret", "X-Other": "hidden" }));
  expect(headers).toEqual({ "content-type": "text/plain" });
  const signal = new AbortController().signal;
  expect(new TextDecoder().decode(await readPublicBody(new Response("ok"), signal))).toBe("ok");
  await expect(readPublicBody(new Response(new Uint8Array(2_000_001)), signal)).rejects.toThrow("size limit");
});
