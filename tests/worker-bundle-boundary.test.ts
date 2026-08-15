import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("Worker bundle boundaries", () => {
  test("keeps the KaTeX renderer behind the browser-only mathematics entry", () => {
    const packageJson = JSON.parse(readRepositoryFile("packages/shared/package.json"));
    const sharedIndex = readRepositoryFile("packages/shared/src/index.ts");
    const contentSource = readRepositoryFile("packages/shared/src/content.ts");

    expect(packageJson.exports["./mathematics"]).toBe("./src/mathematics.ts");
    expect(sharedIndex).not.toContain('export * from "./mathematics"');
    expect(contentSource).toContain('from "./mathematics-markdown"');
    expect(contentSource).not.toContain('from "./mathematics"');
    expect(contentSource).not.toContain("createEdgeEverMathematics");
  });
});
