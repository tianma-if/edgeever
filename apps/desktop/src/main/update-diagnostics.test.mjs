import { expect, test } from "bun:test";
import { createUpdateDiagnostic } from "./update-diagnostics.mjs";

const context = { stage: "check", version: "1.107.0", platform: "win32", arch: "x64", now: new Date("2026-10-10T14:00:00Z") };

test("preserves actionable network errors and UTC context", () => {
  const result = createUpdateDiagnostic(new Error("net::ERR_CONNECTION_TIMED_OUT at https://github.com/tianma-if/edgeever/releases.atom"), context);
  expect(result.code).toBe("ERR_CONNECTION_TIMED_OUT");
  expect(result.message).toContain("releases.atom");
  expect(result.at).toBe("2026-10-10T14:00:00.000Z");
  expect(result.platform).toBe("win32");
});

test("removes URL credentials, query secrets, headers, paths and response bodies", () => {
  const result = createUpdateDiagnostic(new Error('HTTP 403 https://user:pass@github.com/release?token=private#secret\nAuthorization: Bearer sensitive\nC:\\Users\\Alice\\AppData\\file\nXML:\n<private>response body</private>'), context);
  expect(result.message).toContain("HTTP 403 https://github.com/release");
  for (const secret of ["user:pass", "private", "sensitive", "Alice", "response body"]) expect(result.message).not.toContain(secret);
  expect(result.message).toContain("[local path]");
});

test("keeps signature failures distinct and bounds diagnostic size", () => {
  const result = createUpdateDiagnostic({ code: "ERR_SIGNATURE", message: "Windows update manifest signature is invalid " + "x".repeat(5000) }, { ...context, stage: "verify-windows-metadata" });
  expect(result.stage).toBe("verify-windows-metadata");
  expect(result.code).toBe("ERR_SIGNATURE");
  expect(result.message.length).toBeLessThanOrEqual(1200);
});
