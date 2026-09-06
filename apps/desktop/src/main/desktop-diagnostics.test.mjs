import { describe, expect, test } from "bun:test";
import {
  buildDesktopDiagnosticIssueUrl,
  normalizeDesktopDiagnostic,
  sanitizeDesktopDiagnosticText,
} from "./desktop-diagnostics.mjs";

describe("desktop crash diagnostics", () => {
  test("redacts URLs, credentials, and home directory names", () => {
    const sanitized = sanitizeDesktopDiagnosticText(
      'https://notes.example.com/api Bearer private-token /Users/alice/note "token":"secret-value"',
    );
    expect(sanitized).not.toContain("notes.example.com");
    expect(sanitized).not.toContain("private-token");
    expect(sanitized).not.toContain("alice");
    expect(sanitized).not.toContain("secret-value");
    expect(sanitized).toContain("[redacted-url]");
  });

  test("retains packaged asset locations without exposing the installation path", () => {
    expect(sanitizeDesktopDiagnosticText(
      "at render (file:///Applications/EdgeEver.app/Contents/Resources/web/assets/index-a1b2.js:42:7)",
    )).toBe("at render (file:///[app]/assets/index-a1b2.js:42:7)");
  });

  test("normalizes renderer supplied data to the diagnostic allowlist", () => {
    expect(normalizeDesktopDiagnostic({ kind: "react-error", message: "boom", private: "note" })).toEqual({
      kind: "react-error",
      message: "boom",
      stack: "",
      componentStack: "",
      reason: "",
      exitCode: null,
    });
    expect(normalizeDesktopDiagnostic(null)).toMatchObject({ kind: "unknown", message: "" });
  });

  test("builds a public issue draft containing sanitized diagnostics and system information", () => {
    const issueUrl = buildDesktopDiagnosticIssueUrl({
      diagnostic: { kind: "react-error", message: "failed at https://private.example.com" },
      systemInfo: {
        appVersion: "1.31.0",
        platform: "darwin",
        architecture: "x64",
        osVersion: "15.6",
        osRelease: "24.6.0",
        electron: "38.0.0",
        chrome: "140.0.0.0",
        gpu: "Intel UHD Graphics 630",
        gpuFeatures: "webgl=enabled",
      },
    });
    const url = new URL(issueUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/tianma-if/edgeever/issues/new");
    expect(url.searchParams.get("title")).toContain("darwin x64");
    expect(url.searchParams.get("body")).toContain('"appVersion": "1.31.0"');
    expect(url.searchParams.get("body")).toContain("Intel UHD Graphics 630");
    expect(url.searchParams.get("body")).not.toContain("private.example.com");
    expect(issueUrl.length).toBeLessThan(8_000);
  });

  test("keeps even non-ASCII crash reports within a practical issue URL limit", () => {
    const issueUrl = buildDesktopDiagnosticIssueUrl({
      diagnostic: {
        kind: "react-error",
        message: "错".repeat(2_000),
        stack: "栈".repeat(2_000),
        componentStack: "组件".repeat(2_000),
      },
      systemInfo: { appVersion: "1.31.0", platform: "darwin", architecture: "x64" },
    });
    expect(issueUrl.length).toBeLessThan(8_000);
  });
});
