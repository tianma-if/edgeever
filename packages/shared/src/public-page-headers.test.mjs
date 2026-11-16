import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isPublicPagePath, PUBLIC_PAGE_HEADERS } from "./public-page-headers.ts";

const readHeaderRules = (path) => {
  const rules = new Map();
  let current = null;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const separator = line.indexOf(":");
    current.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return rules;
};

describe("public page headers", () => {
  test("matches share and form links only", () => {
    expect(isPublicPagePath("/share/abc")).toBe(true);
    expect(isPublicPagePath("/share/notebook/abc/memo")).toBe(true);
    expect(isPublicPagePath("/form/abc")).toBe(true);
    expect(isPublicPagePath("/")).toBe(false);
    expect(isPublicPagePath("/settings")).toBe(false);
    expect(isPublicPagePath("/shared")).toBe(false);
  });

  test("Cloudflare static asset rules send the same headers as the shared policy", () => {
    const rules = readHeaderRules(new URL("../../../apps/web/public/_headers", import.meta.url));
    for (const route of ["/share/*", "/form/*"]) {
      expect(Object.fromEntries(rules.get(route) ?? [])).toEqual(PUBLIC_PAGE_HEADERS);
    }
  });
});
