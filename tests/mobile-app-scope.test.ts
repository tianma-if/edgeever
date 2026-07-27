import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workspaceSource = readFileSync(
  new URL("../apps/mobile/src/screens/WorkspaceScreen.tsx", import.meta.url),
  "utf8"
);
const accountSecuritySource = readFileSync(
  new URL("../apps/mobile/src/screens/AccountSecurityModal.tsx", import.meta.url),
  "utf8"
);

describe("mobile app scope", () => {
  test("keeps workspace administration out of the native app", () => {
    for (const removedCapability of [
      "ApiTokensModal",
      "ResourcesModal",
      "TagsManagerModal",
      "createApiToken",
      "deleteApiToken",
      "mergeMemos",
    ]) {
      expect(workspaceSource).not.toContain(removedCapability);
    }
  });

  test("limits account security to the signed-in user", () => {
    for (const removedCapability of ["createUser", "listUsers", "updateUser"]) {
      expect(accountSecuritySource).not.toContain(removedCapability);
    }
  });
});
