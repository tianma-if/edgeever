import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MEMO_TITLE,
  formatMemoCreatedAtLabel,
  getMemoDisplayTitleWithCreatedAt,
} from "./memo-title.ts";

describe("formatMemoCreatedAtLabel", () => {
  test("formats a valid creation time with seconds", () => {
    const label = formatMemoCreatedAtLabel("2026-11-06T16:03:22.000Z", "en-US");
    expect(label).not.toBeNull();
    expect(label).toContain("2026");
    expect(label).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });

  test("distinguishes notes created within the same minute", () => {
    const first = formatMemoCreatedAtLabel("2026-11-06T16:03:05.000Z", "en-US");
    const second = formatMemoCreatedAtLabel("2026-11-06T16:03:47.000Z", "en-US");
    expect(first).not.toBe(second);
  });

  test("returns null for missing or invalid timestamps", () => {
    expect(formatMemoCreatedAtLabel(null, "en-US")).toBeNull();
    expect(formatMemoCreatedAtLabel(undefined, "en-US")).toBeNull();
    expect(formatMemoCreatedAtLabel("", "en-US")).toBeNull();
    expect(formatMemoCreatedAtLabel("not-a-date", "en-US")).toBeNull();
  });
});

describe("getMemoDisplayTitleWithCreatedAt", () => {
  const createdAt = "2026-11-06T16:03:22.000Z";

  test("keeps real titles, including padded and Chinese ones", () => {
    expect(getMemoDisplayTitleWithCreatedAt("  Plan  ", createdAt, "Untitled note", "en-US")).toBe("Plan");
    expect(getMemoDisplayTitleWithCreatedAt("会议记录", createdAt, "Untitled note", "en-US")).toBe("会议记录");
  });

  test("uses the creation label for untitled notes", () => {
    const expected = formatMemoCreatedAtLabel(createdAt, "en-US");
    expect(getMemoDisplayTitleWithCreatedAt("", createdAt, "Untitled note", "en-US")).toBe(expected);
    expect(getMemoDisplayTitleWithCreatedAt(null, createdAt, "Untitled note", "en-US")).toBe(expected);
    expect(getMemoDisplayTitleWithCreatedAt(` ${DEFAULT_MEMO_TITLE} `, createdAt, "Untitled note", "en-US")).toBe(expected);
  });

  test("falls back to the untitled label when the creation time is unusable", () => {
    expect(getMemoDisplayTitleWithCreatedAt("", "", "Untitled note", "en-US")).toBe("Untitled note");
    expect(getMemoDisplayTitleWithCreatedAt(null, "not-a-date", "Untitled note", "en-US")).toBe("Untitled note");
    expect(getMemoDisplayTitleWithCreatedAt(DEFAULT_MEMO_TITLE, undefined, "Untitled note", "en-US")).toBe("Untitled note");
  });
});
