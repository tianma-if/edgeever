import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createClientUuid } from "./client-id.ts";

describe("createClientUuid", () => {
  it("prefers the browser randomUUID implementation", () => {
    const expected = "12345678-1234-4123-8123-123456789abc";
    const cryptoApi = {
      randomUUID: () => expected,
      getRandomValues: () => {
        throw new Error("getRandomValues should not be called");
      },
    };

    assert.equal(createClientUuid(cryptoApi), expected);
  });

  it("creates an RFC 4122 v4 UUID when randomUUID is unavailable on HTTP", () => {
    const cryptoApi = {
      getRandomValues: (bytes) => {
        bytes.fill(0xab);
        return bytes;
      },
    };

    assert.equal(createClientUuid(cryptoApi), "abababab-abab-4bab-abab-abababababab");
  });

  it("still returns a UUID when the Crypto API is unavailable", () => {
    assert.match(createClientUuid(null), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
