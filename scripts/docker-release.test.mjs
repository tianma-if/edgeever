import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveSelfHostedConfig } from "./self-hosted-config.mjs";
import { loadSelfHostedEnvironment } from "./self-hosted-secrets.mjs";

const readProjectFile = (path) => readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("self-hosted runtime configuration", () => {
  test("uses the portable single-volume defaults", () => {
    const config = resolveSelfHostedConfig({}, "/opt/edgeever");
    expect(config.dataDirectory).toBe("/opt/edgeever/.edgeever-data");
    expect(config.databaseFile).toBe("/opt/edgeever/.edgeever-data/edgeever.sqlite");
    expect(config.resourcesDirectory).toBe("/opt/edgeever/.edgeever-data/resources");
    expect(config.port).toBe(8787);
    expect(config.storageBackend).toBe("local");
  });

  test("loads Docker secrets without retaining the file indirection", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-docker-secret-`);
    const secretPath = resolve(directory, "password");
    try {
      await writeFile(secretPath, "secret-from-file\n");
      const environment = await loadSelfHostedEnvironment({ EDGE_EVER_AUTH_PASSWORD_FILE: secretPath });
      expect(environment.EDGE_EVER_AUTH_PASSWORD).toBe("secret-from-file");
      expect(environment.EDGE_EVER_AUTH_PASSWORD_FILE).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid ports and storage backends", () => {
    expect(() => resolveSelfHostedConfig({ EDGE_EVER_PORT: "0" })).toThrow("EDGE_EVER_PORT");
    expect(() => resolveSelfHostedConfig({ EDGE_EVER_STORAGE_BACKEND: "r2" })).toThrow(
      "either local or s3",
    );
    expect(() => resolveSelfHostedConfig({ EDGE_EVER_STORAGE_BACKEND: "s3" })).toThrow(
      "EDGE_EVER_S3_BUCKET",
    );
  });
});

describe("Docker release contract", () => {
  test("runs the production image as a non-root user with one persistent volume", () => {
    const dockerfile = readProjectFile("Dockerfile");
    expect(dockerfile).toContain("FROM oven/bun:1.3.14-alpine AS runtime");
    expect(dockerfile).toContain("COPY patches patches");
    expect(dockerfile).toContain("COPY docs docs");
    expect(dockerfile).toContain("COPY release-summary.json release-summary.json");
    expect(dockerfile).toContain("COPY --from=build /app/release-summary.json ./release-summary.json");
    expect(dockerfile).toContain("--filter @edgeever/web");
    expect(dockerfile).toContain("--production --filter edgeever");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toContain("HEALTHCHECK");
  });

  test("keeps authentication explicit in Compose", () => {
    const compose = readProjectFile("compose.yaml");
    expect(compose).toContain("EDGE_EVER_AUTH_PASSWORD: \"${EDGE_EVER_AUTH_PASSWORD:?");
    expect(compose).toContain("edgeever-data:/data");
    expect(compose).toContain("no-new-privileges:true");
  });

  test("keeps both runtime entrypoints on the shared application", () => {
    const application = readProjectFile("apps/api/src/index.ts");
    const selfHosted = readProjectFile("scripts/self-hosted-server.mjs");
    expect(application).toContain("export const fetchEdgeEverApp");
    expect(application).toContain("storage: createCloudflareStorageAdapter(env)");
    expect(selfHosted).toContain("fetchEdgeEverApp(request, env, executionContext)");
    expect(selfHosted).not.toContain("worker.fetch(");
  });

  test("gates official image publishing and release auditing", () => {
    const workflow = readProjectFile(".github/workflows/docker-image.yml");
    expect(workflow.match(/github\.repository == 'tianma-if\/edgeever'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow).toContain("release_tag");
    expect(workflow).toContain("contents: write\n      packages: write");
    expect(workflow).toContain("name: Publish official multi-platform image\n    runs-on: ubuntu-latest\n    timeout-minutes: 60");
    expect(workflow).toContain('gh release view "${RELEASE_TAG}"');
    expect(workflow).not.toContain('releases/tags/${RELEASE_TAG}');
    expect(workflow).toContain("docker logout ghcr.io");
    expect(workflow).toContain("TCR_IMAGE_NAME: ccr.ccs.tencentyun.com/edgeever/edgeever");
    expect(workflow).toContain("secrets.TENCENT_TCR_USERNAME");
    expect(workflow).toContain("secrets.TENCENT_TCR_PASSWORD");
    expect(workflow).toContain("name: Mirror image to Tencent Cloud Container Registry");
    expect(workflow).toContain('docker buildx imagetools create \\');
    expect(workflow).toContain('--tag "${TCR_IMAGE_NAME}:${image_tag}"');
    expect(workflow).toContain('"${GHCR_IMAGE_NAME}:${image_tag}"');
    expect(workflow).not.toContain('echo "${TCR_IMAGE_NAME}:${RELEASE_TAG}"');
    expect(workflow).toContain('docker logout ccr.ccs.tencentyun.com');
    expect(workflow).toContain('test "${ghcr_digest}" = "${tcr_digest}"');
    expect(workflow).toContain('for image in "${GHCR_IMAGE_NAME}" "${TCR_IMAGE_NAME}"');
    expect(workflow).toContain("docker buildx imagetools inspect");
  });
});
