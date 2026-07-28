import { describe, expect, test } from "bun:test";
import { isSupportedAssociatedFile, markdownTitleFromFileName } from "./file-association.mjs";

describe("desktop file associations", () => {
  test("accepts Markdown extensions case-insensitively", () => {
    expect(isSupportedAssociatedFile("/tmp/notes/today.md")).toBe(true);
    expect(isSupportedAssociatedFile("C:\\Notes\\Today.MARKDOWN")).toBe(true);
    expect(isSupportedAssociatedFile("/tmp/notes/today.txt")).toBe(false);
    expect(isSupportedAssociatedFile("/tmp/notes/.md")).toBe(false);
  });

  test("derives a clean note title from the associated file name", () => {
    expect(markdownTitleFromFileName("  Today.markdown ")).toBe("Today");
    expect(markdownTitleFromFileName("meeting.md")).toBe("meeting");
    expect(markdownTitleFromFileName("README")).toBe("README");
  });
});
