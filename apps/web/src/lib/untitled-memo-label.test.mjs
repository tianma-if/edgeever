import { afterEach, describe, expect, test } from "bun:test";
import {
  formatUntitledMemoDate,
  readUntitledMemoDateFormatPreference,
  resolveMemoDisplayLabel,
  resolveStoredUntitledMemoDateFormat,
  UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY,
  writeUntitledMemoDateFormatPreference,
} from "./untitled-memo-label.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

const installWindow = ({ failWrites = false } = {}) => {
  const values = new Map();
  const events = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error("QuotaExceededError");
        values.set(key, String(value));
      },
    },
    dispatchEvent: (event) => {
      events.push(event);
      return true;
    },
  };
  return { events, values };
};

const createdAt = "2026-11-06T14:32:00.000Z";
const labels = { untitled: "Untitled note", withDate: (date) => `Untitled note · ${date}` };

describe("untitled note date", () => {
  test("formats the creation time in the requested locale and time zone", () => {
    // ICU versions differ in separators ("," or "at", narrow spaces), so only the parts are checked.
    const medium = formatUntitledMemoDate(createdAt, "en-US", "medium", "UTC");
    expect(medium).toContain("Nov 6, 2026");
    expect(medium).toMatch(/2:32\sPM$/);
    expect(formatUntitledMemoDate(createdAt, "en-US", "long", "UTC")).toContain("November 6, 2026");
    expect(formatUntitledMemoDate(createdAt, "en-US", "short", "UTC")).toMatch(/^11\/6\/26.*2:32\sPM$/);
    expect(formatUntitledMemoDate(createdAt, "en-US", "date", "UTC")).toBe("Nov 6, 2026");
    expect(formatUntitledMemoDate(createdAt, "pl", "medium", "UTC")).toMatch(/^6 lis 2026.*14:32$/);
    expect(formatUntitledMemoDate(createdAt, "zh-CN", "date", "UTC")).toBe("2026年11月6日");
  });

  test("uses the viewer's time zone", () => {
    expect(formatUntitledMemoDate(createdAt, "en-US", "iso", "UTC")).toBe("2026-11-06 14:32");
    expect(formatUntitledMemoDate(createdAt, "en-US", "iso", "Asia/Shanghai")).toBe("2026-11-06 22:32");
    expect(formatUntitledMemoDate("2026-11-06T20:00:00.000Z", "en-US", "date", "Asia/Tokyo")).toBe("Nov 7, 2026");
  });

  test("returns nothing when the format is off or the timestamp is unusable", () => {
    expect(formatUntitledMemoDate(createdAt, "en-US", "off", "UTC")).toBeNull();
    expect(formatUntitledMemoDate("", "en-US", "medium", "UTC")).toBeNull();
    expect(formatUntitledMemoDate(null, "en-US", "medium", "UTC")).toBeNull();
    expect(formatUntitledMemoDate(undefined, "en-US", "iso", "UTC")).toBeNull();
    expect(formatUntitledMemoDate("not a date", "en-US", "medium", "UTC")).toBeNull();
  });
});

describe("memo display label", () => {
  test("keeps real titles unchanged", () => {
    expect(resolveMemoDisplayLabel({ title: "  Groceries ", createdAt }, "en-US", "medium", labels, "UTC")).toBe("Groceries");
  });

  test("adds the creation time to empty and default titles", () => {
    expect(resolveMemoDisplayLabel({ title: "", createdAt }, "en-US", "iso", labels, "UTC")).toBe("Untitled note · 2026-11-06 14:32");
    expect(resolveMemoDisplayLabel({ title: "无标题笔记", createdAt }, "en-US", "iso", labels, "UTC")).toBe("Untitled note · 2026-11-06 14:32");
    expect(resolveMemoDisplayLabel({ title: null, createdAt }, "en-US", "iso", labels, "UTC")).toBe("Untitled note · 2026-11-06 14:32");
  });

  test("falls back to the plain label without a usable date or when turned off", () => {
    expect(resolveMemoDisplayLabel({ title: "", createdAt: "invalid" }, "en-US", "medium", labels, "UTC")).toBe("Untitled note");
    expect(resolveMemoDisplayLabel({ title: "" }, "en-US", "medium", labels, "UTC")).toBe("Untitled note");
    expect(resolveMemoDisplayLabel({ title: "", createdAt }, "en-US", "off", labels, "UTC")).toBe("Untitled note");
  });
});

describe("untitled note date preference", () => {
  test("defaults to the medium format for missing or unknown values", () => {
    expect(resolveStoredUntitledMemoDateFormat(null)).toBe("medium");
    expect(resolveStoredUntitledMemoDateFormat("unsupported")).toBe("medium");
    expect(resolveStoredUntitledMemoDateFormat("iso")).toBe("iso");
    expect(resolveStoredUntitledMemoDateFormat("off")).toBe("off");
  });

  test("persists changes and notifies the current document", () => {
    const { events, values } = installWindow();
    writeUntitledMemoDateFormatPreference("long");
    expect(values.get(UNTITLED_MEMO_DATE_FORMAT_STORAGE_KEY)).toBe("long");
    expect(readUntitledMemoDateFormatPreference()).toBe("long");
    expect(events.at(-1).detail).toBe("long");
  });

  test("keeps the choice for the session when storage rejects writes", () => {
    installWindow({ failWrites: true });
    writeUntitledMemoDateFormatPreference("date");
    expect(readUntitledMemoDateFormatPreference()).toBe("date");
    installWindow();
    writeUntitledMemoDateFormatPreference("medium");
    expect(readUntitledMemoDateFormatPreference()).toBe("medium");
  });
});
