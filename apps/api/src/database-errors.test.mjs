import { expect, test } from "bun:test";
import { isDatabaseDailyQuotaError } from "./database-errors.ts";

test("does not classify network, schema, storage or per-query limits as daily quota exhaustion", () => {
  for (const message of ["D1_ERROR: Network connection lost.", "D1_ERROR: no such table: users", "D1_ERROR: too many SQL variables", "D1_ERROR: database or disk is full", "daily row read limit"]) {
    expect(isDatabaseDailyQuotaError(new Error(message))).toBe(false);
  }
  const cyclic = new Error("wrapper");
  cyclic.cause = cyclic;
  expect(isDatabaseDailyQuotaError(cyclic)).toBe(false);
});
