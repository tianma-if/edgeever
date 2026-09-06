import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");
const packageJson = JSON.parse(readRepositoryFile("package.json")) as { packageManager?: string };
const bunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];

describe("Bun toolchain version", () => {
  test("pins one repository-wide Bun version", () => {
    expect(bunVersion).toBe("1.3.14");
  });

  test("all GitHub Actions inherit the repository version", () => {
    const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
    const workflows = readdirSync(workflowDirectory)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .map((name) => [name, readFileSync(resolve(workflowDirectory, name), "utf8")] as const)
      .filter(([, content]) => content.includes("oven-sh/setup-bun@"));

    expect(workflows.length).toBeGreaterThan(0);
    for (const [name, content] of workflows) {
      expect(content, `${name} must let setup-bun read packageManager`).not.toContain("bun-version:");
    }
  });

  test("container entrypoints stay on the repository version", () => {
    expect(readRepositoryFile("Dockerfile")).toContain(`FROM oven/bun:${bunVersion}-alpine AS runtime`);
    expect(readRepositoryFile("scripts/publish-tcr-image.sh")).toContain(`oven/bun:${bunVersion}-alpine`);
  });
});
