import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getImportFileAccept } from "./file-accept.ts";

describe("getImportFileAccept", () => {
  test("preserves extension filters on desktop browsers", () => {
    const macSafari = {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 0,
    };
    expect(getImportFileAccept("joplin", macSafari)).toBe(".zip,.jex");
    expect(getImportFileAccept("evernote", macSafari)).toBe(".enex,.zip,.notes");
    expect(getImportFileAccept("notion", macSafari)).toBe(".md,.markdown,.csv,.zip");
    expect(getImportFileAccept("siyuan", macSafari)).toBe(".md,.markdown,.zip");
    expect(getImportFileAccept("flomo", macSafari)).toBe(".html,.htm,.zip");
    expect(getImportFileAccept("obsidian", macSafari)).toBe(".zip");
    expect(getImportFileAccept("markdown", macSafari)).toBe(".md,.markdown");
  });

  test("omits accept on iOS, iPadOS desktop mode, and Android for custom extension formats", () => {
    const environments = [
      {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      },
      {
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      },
      {
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      },
    ];

    for (const env of environments) {
      expect(getImportFileAccept("joplin", env)).toBeUndefined();
      expect(getImportFileAccept("evernote", env)).toBeUndefined();
      expect(getImportFileAccept("notion", env)).toBe(".md,.markdown,.csv,.zip");
      expect(getImportFileAccept("siyuan", env)).toBe(".md,.markdown,.zip");
      expect(getImportFileAccept("flomo", env)).toBe(".html,.htm,.zip");
      expect(getImportFileAccept("obsidian", env)).toBe(".zip");
      expect(getImportFileAccept("markdown", env)).toBe(".md,.markdown");
    }
  });

  test("ThirdPartyImportDialog uses getImportFileAccept for the file input", () => {
    const source = readFileSync(new URL("../../components/settings/ThirdPartyImportDialog.tsx", import.meta.url), "utf8");
    expect(source).toContain("accept={getImportFileAccept(state.format)}");
  });
});
