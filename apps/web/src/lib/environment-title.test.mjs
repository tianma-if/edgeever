import { describe, expect, test } from "bun:test";
import { withEnvironmentTitlePrefix } from "./environment-title.ts";

describe("environment tab title", () => {
  test("marks local development tabs as DEV", () => {
    expect(withEnvironmentTitlePrefix("EdgeEver", { development: true, profile: "local" }))
      .toBe("[DEV] EdgeEver");
    expect(withEnvironmentTitlePrefix("EdgeEver", { development: true, profile: "" }))
      .toBe("[DEV] EdgeEver");
  });

  test("marks the local demo profile as DEMO", () => {
    expect(withEnvironmentTitlePrefix("EdgeEver", { development: true, profile: "demo" }))
      .toBe("[DEMO] EdgeEver");
  });

  test("is idempotent during hot reloads and leaves production titles unchanged", () => {
    expect(withEnvironmentTitlePrefix("[LOCAL DEMO] EdgeEver", { development: true, profile: "demo" }))
      .toBe("[DEMO] EdgeEver");
    expect(withEnvironmentTitlePrefix("EdgeEver", { development: false, profile: "demo" }))
      .toBe("EdgeEver");
  });
});
