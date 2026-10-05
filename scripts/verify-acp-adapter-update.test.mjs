import { describe, expect, test } from "bun:test";
import { runAcpAdapterCrossVersionVerification } from "./verify-acp-adapter-update.mjs";

describe("ACP adapter installer cross-version verification", () => {
  test("runs the full old-version-to-new-version lifecycle verification", async () => {
    const passed = await runAcpAdapterCrossVersionVerification({ silent: true });
    expect(passed).toBe(true);
  });
});
