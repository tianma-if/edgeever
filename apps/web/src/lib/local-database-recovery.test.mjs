import { describe, expect, test } from "bun:test";
import {
  LocalDatabaseUnavailableError,
  runLocalDatabaseOperationWithRecovery,
} from "./local-database-recovery";

describe("local database recovery", () => {
  test("reopens and retries once after a storage operation times out", async () => {
    let attempts = 0;
    let reopens = 0;
    const result = await runLocalDatabaseOperationWithRecovery(
      async () => {
        attempts += 1;
        if (attempts === 1) return new Promise(() => {});
        return "saved";
      },
      {
        reopen: async () => { reopens += 1; },
        timeoutMs: 5,
      },
    );

    expect(result).toBe("saved");
    expect(attempts).toBe(2);
    expect(reopens).toBe(1);
  });

  test("fails explicitly instead of waiting forever when retry also times out", async () => {
    let attempts = 0;
    await expect(runLocalDatabaseOperationWithRecovery(
      async () => {
        attempts += 1;
        return new Promise(() => {});
      },
      { reopen: async () => {}, timeoutMs: 5 },
    )).rejects.toBeInstanceOf(LocalDatabaseUnavailableError);
    expect(attempts).toBe(2);
  });

  test("does not retry non-recoverable validation errors", async () => {
    let reopens = 0;
    await expect(runLocalDatabaseOperationWithRecovery(
      async () => { throw new TypeError("Invalid memo payload"); },
      { reopen: async () => { reopens += 1; }, timeoutMs: 5 },
    )).rejects.toThrow("Invalid memo payload");
    expect(reopens).toBe(0);
  });
});
