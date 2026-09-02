import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const readmes = ["README.md", "README.zh-CN.md"];
const remoteSource = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

const localHtmlImageSources = (markdown) =>
  [...markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((source) => !remoteSource.test(source));

describe("README image assets", () => {
  for (const readme of readmes) {
    test(`${readme} only references existing local image files`, () => {
      const markdown = readFileSync(resolve(repositoryRoot, readme), "utf8");
      const sources = localHtmlImageSources(markdown);

      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        const assetPath = resolve(repositoryRoot, decodeURIComponent(source));
        expect(existsSync(assetPath), `${readme}: missing ${source}`).toBe(true);
        expect(statSync(assetPath).isFile(), `${readme}: not a file ${source}`).toBe(true);
      }
    });
  }
});
