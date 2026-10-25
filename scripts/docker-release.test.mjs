import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveSelfHostedConfig } from "./self-hosted-config.mjs";
import { loadSelfHostedEnvironment } from "./self-hosted-secrets.mjs";

const readProjectFile = (path) =>
  readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("self-hosted runtime configuration", () => {
  test("uses the portable single-volume defaults", () => {
    const config = resolveSelfHostedConfig({}, "/opt/edgeever");
    expect(config.dataDirectory).toBe("/opt/edgeever/.edgeever-data");
    expect(config.databaseFile).toBe(
      "/opt/edgeever/.edgeever-data/edgeever.sqlite",
    );
    expect(config.resourcesDirectory).toBe(
      "/opt/edgeever/.edgeever-data/resources",
    );
    expect(config.port).toBe(8787);
    expect(config.storageBackend).toBe("local");
  });

  test("loads Docker secrets without retaining the file indirection", async () => {
    const directory = await mkdtemp(`${tmpdir()}/edgeever-docker-secret-`);
    const secretPath = resolve(directory, "password");
    try {
      await writeFile(secretPath, "secret-from-file\n");
      const environment = await loadSelfHostedEnvironment({
        EDGE_EVER_AUTH_PASSWORD_FILE: secretPath,
      });
      expect(environment.EDGE_EVER_AUTH_PASSWORD).toBe("secret-from-file");
      expect(environment.EDGE_EVER_AUTH_PASSWORD_FILE).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects invalid ports and storage backends", () => {
    expect(() => resolveSelfHostedConfig({ EDGE_EVER_PORT: "0" })).toThrow(
      "EDGE_EVER_PORT",
    );
    expect(() =>
      resolveSelfHostedConfig({ EDGE_EVER_STORAGE_BACKEND: "r2" }),
    ).toThrow("either local or s3");
    expect(() =>
      resolveSelfHostedConfig({ EDGE_EVER_STORAGE_BACKEND: "s3" }),
    ).toThrow("EDGE_EVER_S3_BUCKET");
  });
});

describe("Docker release contract", () => {
  test("runs the production image as a non-root user with one persistent volume", () => {
    const dockerfile = readProjectFile("Dockerfile");
    const runtimeStage = dockerfile.slice(
      dockerfile.indexOf("FROM oven/bun:1.3.14-alpine AS runtime"),
    );
    const packageMetadata = JSON.parse(readProjectFile("package.json"));
    expect(dockerfile).toContain("FROM --platform=$BUILDPLATFORM oven/bun:1.3.14-alpine AS manifests");
    expect(dockerfile).toContain("FROM oven/bun:1.3.14-alpine AS runtime");
    expect(dockerfile).toContain("COPY patches patches");
    expect(dockerfile).toContain("COPY docs docs");
    expect(dockerfile).toContain(
      "COPY packages/wrangler/package.json packages/wrangler/package.json",
    );
    expect(dockerfile).toContain(
      "COPY packages/public-network/package.json packages/public-network/package.json",
    );
    expect(dockerfile).toContain(
      "COPY release-summary.json release-summary.json",
    );
    expect(dockerfile).toContain("--filter @edgeever/web");
    expect(dockerfile).toContain("--filter @edgeever/public-network");
    expect(dockerfile).toContain(
      "RUN bun install --frozen-lockfile \\\n  --filter edgeever \\\n  --filter @edgeever/api",
    );
    expect(packageMetadata.scripts["build:self-hosted"]).toBe(
      "bun build scripts/self-hosted-server.mjs --target=bun --format=esm --outdir=dist/self-hosted --sourcemap=none",
    );
    expect(dockerfile).toContain("RUN bun run build:web && bun run build:self-hosted");
    expect(dockerfile).toContain("scripts/prepare-poster-thumbnails.mjs scripts/prepare-poster-thumbnails.d.mts scripts/");
    expect(dockerfile).toContain("RUN apk add --no-cache chromium nodejs");
    expect(dockerfile).toContain("EDGE_EVER_POSTER_CHROME_EXECUTABLE=/usr/bin/chromium");
    expect(dockerfile).toContain("COPY tests/browser/poster-thumbnail-generator.html tests/browser/poster-thumbnail-generator.ts tests/browser/");
    expect(runtimeStage).toContain(
      "COPY --from=build /app/dist/self-hosted/self-hosted-server.js ./scripts/self-hosted-server.js",
    );
    expect(runtimeStage).toContain(
      "ln -s self-hosted-server.js /app/scripts/self-hosted-server.mjs",
    );
    expect(runtimeStage).toContain('org.opencontainers.image.title="EdgeEver"');
    expect(runtimeStage).toContain('org.opencontainers.image.licenses="AGPL-3.0-only"');
    expect(runtimeStage).not.toContain("node_modules");
    expect(runtimeStage).not.toContain("/app/apps/api");
    expect(runtimeStage).not.toContain("/app/packages");
    expect(runtimeStage).not.toContain("./package.json");
    expect(runtimeStage).not.toContain("./release-summary.json");
    expect(runtimeStage).not.toContain("./docs/openapi.json");
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("ARG EDGE_EVER_BUILD_ID=unknown");
    expect(dockerfile).toContain("EDGE_EVER_BUILD_ID=${EDGE_EVER_BUILD_ID}");
    for (const name of ["EDGE_EVER_BUILD_CREATED_AT", "EDGE_EVER_BUILD_TRIGGER", "EDGE_EVER_BUILD_METHOD"]) {
      // Empty by default so self-built images report unknown build metadata.
      expect(runtimeStage).toContain(`ARG ${name}=\n`);
      expect(runtimeStage).toContain(`${name}=\${${name}}`);
    }
    expect(runtimeStage).toContain('CMD ["bun", "scripts/self-hosted-server.js"]');
    expect(readProjectFile("docs/deploy-docker.md")).toContain(
      'Module not found "scripts/self-hosted-server.mjs"',
    );
    expect(readProjectFile("docs/deploy-docker.zh-CN.md")).toContain(
      'Module not found "scripts/self-hosted-server.mjs"',
    );
    expect(readProjectFile("docs/self-hosting-architecture.md")).toContain(
      "scripts/self-hosted-server.mjs",
    );
    expect(readProjectFile("docs/self-hosting-architecture.zh-CN.md")).toContain(
      "scripts/self-hosted-server.mjs",
    );
  });

  test("keeps authentication explicit in Compose", () => {
    const compose = readProjectFile("compose.yaml");
    expect(compose).toContain(
      'EDGE_EVER_AUTH_PASSWORD: "${EDGE_EVER_AUTH_PASSWORD:?',
    );
    expect(compose).toContain(
      'EDGE_EVER_CONTAINER_IMAGE: "${EDGE_EVER_IMAGE:-ghcr.io/tianma-if/edgeever}"',
    );
    expect(compose).toContain("edgeever-data:/data");
    expect(compose).toContain("no-new-privileges:true");
  });

  test("keeps both runtime entrypoints on the shared application", () => {
    const application = readProjectFile("apps/api/src/index.ts");
    const selfHosted = readProjectFile("scripts/self-hosted-server.mjs");
    expect(application).toContain("export const fetchEdgeEverApp");
    expect(application).toContain(
      "storage: createCloudflareStorageAdapter(env)",
    );
    expect(selfHosted).toContain(
      "fetchEdgeEverApp(request, env, executionContext)",
    );
    expect(selfHosted).toContain(
      'await import("../apps/api/src/s3-compatible-storage-adapter.ts")',
    );
    expect(selfHosted).not.toContain(
      'import { createS3CompatibleStorageAdapter } from',
    );
    expect(selfHosted).not.toContain("worker.fetch(");
    expect(selfHosted).toContain("ensureSelfHostedCredentialSecrets");
  });

  test("persists credential encryption secrets on the data volume", () => {
    const secrets = readProjectFile("scripts/self-hosted-secrets.mjs");
    expect(secrets).toContain("edgeever-secrets.json");
    expect(secrets).not.toContain("edgeever.sqlite");
    expect(readProjectFile("docs/deploy-docker.md")).toContain("edgeever-secrets.json");
    expect(readProjectFile("docs/deploy-docker.zh-CN.md")).toContain("edgeever-secrets.json");
    expect(readProjectFile("docs/self-hosting-architecture.md")).toContain(
      "NAS/GUI upgrades that drop container environment variables",
    );
    expect(readProjectFile("docs/self-hosting-architecture.zh-CN.md")).toContain(
      "NAS/GUI 升级丢掉容器环境变量",
    );
  });

  test("gates official image publishing and release auditing", () => {
    const workflow = readProjectFile(".github/workflows/docker-image.yml");
    const mirrorWorkflow = readProjectFile(
      ".github/workflows/docker-tcr-mirror.yml",
    );
    const cnbWorkflow = readProjectFile(".cnb.yml");
    const tcrPublisher = readProjectFile("scripts/publish-tcr-image.sh");
    expect(
      workflow.match(/github\.repository == 'tianma-if\/edgeever'/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(workflow).toContain("release_tag");
    expect(workflow).toContain("contents: write\n      packages: write");
    expect(workflow).toContain(
      "name: Publish official multi-platform image\n    runs-on: ubuntu-latest\n    timeout-minutes: 60",
    );
    expect(workflow).toContain('gh release view "${RELEASE_TAG}"');
    expect(workflow).not.toContain("releases/tags/${RELEASE_TAG}");
    expect(workflow).toContain("docker logout ghcr.io");
    expect(workflow).toContain("docker buildx imagetools inspect");
    expect(workflow).toContain('docker pull "${GHCR_IMAGE_NAME}:${{ steps.image.outputs.audit_tag }}"');
    expect(workflow).toContain("container_name=edgeever-published-audit");
    expect(workflow).toContain("test -s /app/scripts/self-hosted-server.js");
    expect(workflow).toContain("test -s /app/scripts/self-hosted-server.mjs");
    expect(workflow).toContain(
      "cmp -s /app/scripts/self-hosted-server.js /app/scripts/self-hosted-server.mjs",
    );
    expect(workflow).toContain("test ! -e /app/node_modules");
    expect(workflow).toContain("test ! -e /app/apps/api");
    expect(workflow).toContain("test ! -e /app/packages");
    expect(workflow).toContain("curl --fail --silent --show-error http://127.0.0.1:8787/");
    expect(workflow).toContain('docker build \\\n            --build-arg EDGE_EVER_BUILD_ID="${GITHUB_SHA}"');
    expect(workflow).toContain("EDGE_EVER_BUILD_ID=${{ github.sha }}");
    expect(workflow).toContain("EDGE_EVER_BUILD_CREATED_AT=${{ steps.image.outputs.created_at }}");
    expect(workflow).toContain("EDGE_EVER_BUILD_TRIGGER=${{ steps.image.outputs.build_trigger }}");
    expect(workflow).toContain("EDGE_EVER_BUILD_METHOD=github_actions");
    expect(workflow).toContain("org.opencontainers.image.created=${{ steps.image.outputs.created_at }}");
    // Draft releases are prepared by workflow_dispatch with release_tag; published only audits.
    const resolveTags = workflow.slice(workflow.indexOf("- name: Resolve image tags"), workflow.indexOf("- name: Set up QEMU"));
    const releaseBranch = resolveTags.slice(resolveTags.indexOf('if [[ -n "${RELEASE_TAG}" ]]'), resolveTags.indexOf("          else\n"));
    expect(releaseBranch).toContain('echo "build_trigger=github_release"');
    expect(resolveTags).toContain('if [[ "${GITHUB_EVENT_NAME}" == "push" ]]; then\n              build_trigger=main_push');
    expect(resolveTags).toContain("build_trigger=manual");
    expect(workflow).toContain("docker build --tag edgeever:ci-default .");
    expect(workflow).toContain('.buildProvenance == {"trigger": "main_push", "method": "github_actions"}');
    expect(workflow).toContain('.deployment == {"trigger": "manual", "method": "docker"}');
    expect(workflow).toContain('.build == "unknown" and .buildCreatedAt == null and .buildProvenance == {"trigger": "unknown", "method": "unknown"}');
    expect(workflow).toContain('.buildProvenance == {"trigger": $trigger, "method": "github_actions"}');
    expect(workflow).not.toContain("TCR_IMAGE_NAME");
    expect(workflow).not.toContain("TENCENT_TCR_USERNAME");

    expect(mirrorWorkflow).toContain(
      "name: Build Tencent TCR image through CNB",
    );
    expect(mirrorWorkflow).not.toContain("workflow_run:");
    expect(mirrorWorkflow).toContain("release:");
    expect(mirrorWorkflow).toContain("types:\n      - published");
    expect(mirrorWorkflow).toContain("workflow_dispatch:");
    expect(mirrorWorkflow).toContain("secrets.CNB_TCR_BUILD_PUSH_TOKEN");
    expect(mirrorWorkflow).toContain("https://cnb.cool/tianma-if/edgeever");
    expect(mirrorWorkflow).toContain('"HEAD:${destination}"');
    expect(mirrorWorkflow).not.toContain("skopeo");
    expect(mirrorWorkflow).not.toContain("ghcr.io");

    expect(cnbWorkflow).toContain("main:\n  push:");
    expect(cnbWorkflow).toContain('"v*":\n  tag_push:');
    expect(cnbWorkflow).toContain("runner:\n        cpus: 2");
    expect(cnbWorkflow).toContain("tianma-if/edgeever-secrets");
    expect(cnbWorkflow).toContain("bash scripts/publish-tcr-image.sh");

    expect(tcrPublisher).toContain(
      'readonly TCR_IMAGE="${TCR_REGISTRY}/edgeever/edgeever"',
    );
    expect(tcrPublisher).toContain("--platform linux/amd64,linux/arm64");
    expect(tcrPublisher).toContain('primary_tag="sha-${short_sha}"');
    expect(tcrPublisher).toContain('promotion_tags=("${version}" latest)');
    expect(tcrPublisher).toContain(
      '--label "org.opencontainers.image.revision=${CNB_COMMIT}"',
    );
    expect(tcrPublisher).toContain("readonly build_attempts=3");
    expect(tcrPublisher).toContain("attempt <= build_attempts");
    expect(tcrPublisher).toContain("timeout --signal=TERM --kill-after=1m 15m");
    expect(tcrPublisher).toContain("BuildKit can reuse completed layers");
    expect(tcrPublisher).toContain("docker buildx imagetools create \\");
    expect(tcrPublisher).toContain("org.opencontainers.image.revision");
    expect(tcrPublisher).toContain("--format '{{json .Image}}'");
    expect(tcrPublisher).toContain("TCR_SHA_TAGS_TO_KEEP=20");
    expect(tcrPublisher).not.toContain("ghcr.io");
  });
});
