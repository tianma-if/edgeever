import { describe, expect, test } from "bun:test";
import { runAcpAdapterCrossVersionVerification } from "./verify-acp-adapter-update.mjs";

describe("ACP adapter installer simulated cross-version regression", () => {
  test("runs simulated cross-version lifecycle and rollback regression test", async () => {
    const passed = await runAcpAdapterCrossVersionVerification({ silent: true });
    expect(passed).toBe(true);
  });
});
