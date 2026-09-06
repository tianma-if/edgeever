import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../.github/workflows/deploy-personal.yml", import.meta.url),
  "utf8",
);

describe("personal Cloudflare deployment workflow", () => {
  test("deploys only the official repository on formal Release publication", () => {
    expect(workflow).toContain("release:\n    types:\n      - published");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.repository == 'tianma-if/edgeever'");
    expect(workflow).toContain("ref: ${{ steps.release.outputs.tag }}");
    expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
  });

  test("uses the isolated personal instance resources", () => {
    expect(workflow).toContain("EDGE_EVER_TIANMA_WORKER_NAME");
    expect(workflow).toContain("EDGE_EVER_TIANMA_D1_DATABASE_ID");
    expect(workflow).toContain("EDGE_EVER_TIANMA_R2_BUCKET_NAME");
    expect(workflow).toContain("EDGE_EVER_TIANMA_CUSTOM_DOMAIN");
    expect(workflow).not.toContain("EDGE_EVER_DEMO_");
  });

  test("deploys with Release metadata and verifies the live version", () => {
    expect(workflow).toContain("EDGE_EVER_DEPLOYMENT_TRIGGER: ${{ github.event_name == 'release' && 'github_release' || 'manual' }}");
    expect(workflow).toContain("EDGE_EVER_RELEASED_AT: ${{ steps.release.outputs.published_at }}");
    expect(workflow).toContain("run: bun run deploy");
    expect(workflow).toContain('new URL("/api/release"');
    expect(workflow).toContain("actualVersion !== expectedVersion");
  });
});
