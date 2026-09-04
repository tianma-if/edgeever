import { describe, expect, test } from "bun:test";
import { getMemoListTimestamp, getMemoListTimestampField } from "./memo-timestamps.ts";

const timestamps = {
  createdAt: "2010-08-30T02:00:00.000Z",
  updatedAt: "2026-08-25T01:59:00.000Z",
};

describe("memo list timestamps", () => {
  test("uses creation time for creation sorting", () => {
    expect(getMemoListTimestampField("created-desc")).toBe("createdAt");
    expect(getMemoListTimestamp(timestamps, "created-desc")).toEqual({
      field: "createdAt",
      value: timestamps.createdAt,
    });
  });

  test("uses update time for update and title sorting", () => {
    expect(getMemoListTimestamp(timestamps, "updated-desc")).toEqual({
      field: "updatedAt",
      value: timestamps.updatedAt,
    });
    expect(getMemoListTimestamp(timestamps, "title-asc")).toEqual({
      field: "updatedAt",
      value: timestamps.updatedAt,
    });
  });
});
