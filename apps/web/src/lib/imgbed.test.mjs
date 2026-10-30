import { expect, test } from "bun:test";
import { expandImgBedFolder, imgBedFolderError, IMGBED_MAX_FOLDER_LENGTH, IMGBED_MAX_MEMO_ID_LENGTH } from "./imgbed.ts";
import { normalizeImgBedFolder } from "../../../desktop/src/main/imgbed.mjs";

const now = new Date(2026, 0, 5, 7, 8, 9, 42);

test("expands PicList date placeholders in local time with zero padding", () => {
  expect(expandImgBedFolder("notes/{Y}/{y}{m}{d}/{h}-{i}-{s}-{ms}", now)).toBe("notes/2026/260105/07-08-09-042");
  expect(expandImgBedFolder("{timestamp}/{timestampS}", now)).toBe(`${now.getTime()}/${Math.floor(now.getTime() / 1000)}`);
});

test("expands random placeholders and the target note id", () => {
  expect(expandImgBedFolder("a/{uuid}", now)).toMatch(/^a\/[0-9a-f-]{36}$/);
  expect(expandImgBedFolder("{str-6}", now)).toMatch(/^[A-Za-z0-9]{6}$/);
  expect(expandImgBedFolder("notes/{memoId}", now, { memoId: "memo_abc-1" })).toBe("notes/memo_abc-1");
  expect(expandImgBedFolder("notes/{memoId}/{Y}", now)).toBe("notes/2026");
  expect(expandImgBedFolder("notes/{memoId}", now, { memoId: "../x" })).toBe("notes/x");
});

test("normalizes slashes and drops dot segments", () => {
  expect(expandImgBedFolder("", now)).toBe("");
  expect(expandImgBedFolder(" /a// b /./../c/ ", now)).toBe("a/b/c");
});

test("rejects unknown placeholders, stray braces, unsafe characters and long templates", () => {
  for (const template of ["{filename}", "{md5}", "{str-0}", "{str-33}", "{Y", "a}b", "{{Y}}"]) {
    expect(imgBedFolderError(template)).toBe("placeholder");
    expect(() => expandImgBedFolder(template, now)).toThrow();
  }
  for (const template of ["a?b", "a#b", "a%b", "a\\b", "a:b", "a|b"]) expect(imgBedFolderError(template)).toBe("characters");
  expect(imgBedFolderError("x".repeat(201))).toBe("length");
  expect(imgBedFolderError("notes/{Y}/{m}/{memoId}")).toBeNull();
});

// Regression for PR #740 review: the connection test expands {memoId} to nothing,
// so a folder could pass the test and still exceed the main-process limit on upload.
test("rejects a folder that passes the connection test but overflows with a real note id", () => {
  const template = `${"a".repeat(180)}/{memoId}`;
  const realMemoId = `memo_${"0".repeat(32)}`;
  expect(expandImgBedFolder(`${"a".repeat(180)}`, now)).toHaveLength(180);
  expect(() => normalizeImgBedFolder(`${"a".repeat(180)}/${realMemoId}`)).toThrow();
  expect(imgBedFolderError(template)).toBe("length");
  expect(() => expandImgBedFolder(template, now, { memoId: realMemoId })).toThrow();
});

test("an accepted folder always fits the main-process limit at its longest expansion", () => {
  const boundary = `${"a".repeat(IMGBED_MAX_FOLDER_LENGTH - IMGBED_MAX_MEMO_ID_LENGTH - 1)}/{memoId}`;
  expect(imgBedFolderError(boundary)).toBeNull();
  expect(imgBedFolderError(`a${boundary}`)).toBe("length");
  for (const memoId of [`memo_${"f".repeat(32)}`, "m".repeat(200)]) {
    const folder = expandImgBedFolder(boundary, now, { memoId });
    expect(folder.length).toBeLessThanOrEqual(IMGBED_MAX_FOLDER_LENGTH);
    expect(normalizeImgBedFolder(folder)).toBe(folder);
  }
  const busy = "{Y}/{m}/{d}/{uuid}/{timestamp}/{timestampS}/{str-32}/{memoId}";
  expect(imgBedFolderError(busy)).toBeNull();
  expect(normalizeImgBedFolder(expandImgBedFolder(busy, now, { memoId: "m".repeat(200) }))).toBeTruthy();
});
