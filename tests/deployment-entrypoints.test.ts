import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const readRepositoryFile = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("Cloudflare deployment entrypoints", () => {
  test("all entrypoints converge on the common deployment pipeline", () => {
    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts.deploy).toContain("bun run build:cloudflare");
    expect(scripts.deploy).toContain("EDGE_EVER_USE_EXISTING_AUTH_SECRET=true");
    expect(scripts.deploy).toContain("deploy:ci");
    expect(scripts["deploy:manual"]).toBe(
      "export EDGE_EVER_DEPLOYMENT_TRIGGER=manual EDGE_EVER_DEPLOYMENT_METHOD=local_cli && bun run deploy:doctor && bun run build:cloudflare && bun run deploy:ci",
    );
    expect(scripts["deploy:ci"]).toBe(
      "bun run db:migrate:remote && bun run deploy:worker && bun run deploy:verify",
    );
    expect(scripts["deploy:cloudflare-builds"]).toBe("bun run deploy:ci");
  });

  test("online deployment declares the required authentication Secret", () => {
    const example = readRepositoryFile(".dev.vars.example");
    expect(example).toMatch(/^EDGE_EVER_AUTH_PASSWORD=\s*$/m);

    const packageJson = JSON.parse(readRepositoryFile("package.json"));
    expect(packageJson.cloudflare.bindings.EDGE_EVER_AUTH_PASSWORD.description).toBeTruthy();
  });

  test("deployed repositories receive guarded daily upstream updates", () => {
    const workflow = readRepositoryFile(".github/workflows/sync-edgeever-upstream.yml");

    expect(workflow).toContain("github.repository != 'tianma-if/edgeever'");
    expect(workflow).toContain("UPSTREAM_REPOSITORY: tianma-if/edgeever");
    expect(workflow).toContain("Require a GitHub Fork");
    expect(workflow).toContain(".fork");
    expect(workflow).toContain("EDGE_EVER_UPDATE_CHANNEL");
    expect(workflow).toContain("stable)");
    expect(workflow).toContain("edge)");
    expect(workflow).toContain("bun run db:migrate:local");
    expect(workflow).toContain("bun test");
    expect(workflow).toContain("git push origin HEAD:main");
    expect(workflow).toContain("source repo import");
    expect(workflow).toContain("--allow-unrelated-histories");
    expect(workflow).toContain("non_workflow_changes");
  });

  test("public deployment documentation exposes only Fork and Agent paths", () => {
    const englishReadme = readRepositoryFile("README.md");
    const chineseReadme = readRepositoryFile("README.zh-CN.md");

    expect(englishReadme).not.toContain("deploy.workers.cloudflare.com");
    expect(englishReadme).not.toContain("Option C: Manual Deployment");
    expect(englishReadme).toContain("Fork https://github.com/tianma-if/edgeever");
    expect(chineseReadme).not.toContain("deploy.workers.cloudflare.com");
    expect(chineseReadme).not.toContain("方案 C：手动部署");
    expect(chineseReadme).toContain("Fork https://github.com/tianma-if/edgeever");
  });

  test("AI Agent deployment remains fully online", () => {
    const englishAgentDoc = readRepositoryFile("docs/agent-deploy-cloudflare.md");
    const chineseAgentDoc = readRepositoryFile("docs/agent-deploy-cloudflare.zh-CN.md");

    expect(englishAgentDoc).toContain("Workers & Pages");
    expect(englishAgentDoc).toContain("Update deployed EdgeEver");
    expect(englishAgentDoc).not.toContain("bun run deploy:manual");
    expect(englishAgentDoc).not.toContain("deploy:setup");
    expect(englishAgentDoc).not.toContain(".env.local");
    expect(chineseAgentDoc).toContain("Workers & Pages");
    expect(chineseAgentDoc).not.toContain("bun run deploy:manual");
    expect(chineseAgentDoc).not.toContain("bun run deploy:manual");
  });
});
