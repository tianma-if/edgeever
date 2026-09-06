import { describe, expect, test } from "bun:test";
import {
  buildSchemaVerificationSql,
  normalizeDeploymentUrl,
  parseCapturedDeploymentTargets,
  parseCapturedDeploymentUrls,
  parseD1Rows,
  parseJsonOutput,
  parseSecretNames,
  REQUIRED_TABLES,
  resolveDeploymentUrl,
  verifyCloudflareWorkerHealth,
} from "../scripts/verify-deployment.mjs";
import {
  parseWranglerDeploymentUrls,
  parseWranglerDeploymentVersionId,
  shouldCaptureDeploymentTargets,
} from "../scripts/wrangler-runner.mjs";

describe("deployment verification", () => {
  test("checks the remote schema tables required by current application code", () => {
    const sql = buildSchemaVerificationSql();
    for (const table of REQUIRED_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  test("parses Wrangler D1 JSON output", () => {
    expect(parseD1Rows(JSON.stringify([{ results: [{ name: "users" }] }]))).toEqual([{ name: "users" }]);
  });

  test("reports empty Wrangler JSON output clearly", () => {
    expect(() => parseJsonOutput("", "the remote D1 schema")).toThrow(
      "Wrangler returned no JSON while checking the remote D1 schema.",
    );
  });

  test("treats an empty D1 result as zero rows", () => {
    expect(parseD1Rows("")).toEqual([]);
  });

  test("parses current and wrapped Wrangler secret output", () => {
    expect(parseSecretNames(JSON.stringify([{ name: "EDGE_EVER_AUTH_PASSWORD" }]))).toContain(
      "EDGE_EVER_AUTH_PASSWORD",
    );
    expect(parseSecretNames(JSON.stringify({ result: [{ name: "EDGE_EVER_AUTH_PASSWORD_HASH" }] }))).toContain(
      "EDGE_EVER_AUTH_PASSWORD_HASH",
    );
  });

  test("captures public Workers and custom-domain URLs from Wrangler deploy output", () => {
    expect(parseWranglerDeploymentUrls([
      "Uploaded edgeever (2.1 sec)",
      "Deployed edgeever triggers (0.4 sec)",
      "  https://edgeever.example.workers.dev",
      "  notes.example.com (custom domain)",
      "Current Version ID: version-1",
    ].join("\n"))).toEqual([
      "https://edgeever.example.workers.dev",
      "https://notes.example.com",
    ]);
    expect(parseWranglerDeploymentUrls("No targets deployed for edgeever")).toEqual([]);
    expect(parseWranglerDeploymentVersionId([
      "Uploaded edgeever (2.1 sec)",
      "Current Version ID: version-1",
    ].join("\n"))).toBe("version-1");
  });

  test("captures deployment targets only in CI environments", () => {
    expect(shouldCaptureDeploymentTargets({ WORKERS_CI: "1" })).toBe(true);
    expect(shouldCaptureDeploymentTargets({ CI: " TRUE " })).toBe(true);
    expect(shouldCaptureDeploymentTargets({})).toBe(false);
  });

  test("resolves an explicit or captured deployment URL without credentials or paths", () => {
    expect(normalizeDeploymentUrl("notes.example.com/path")).toBe("https://notes.example.com");
    expect(parseCapturedDeploymentUrls(JSON.stringify({
      urls: ["https://edgeever.example.workers.dev"],
    }))).toEqual(["https://edgeever.example.workers.dev"]);
    expect(parseCapturedDeploymentTargets(JSON.stringify({
      urls: ["https://edgeever.example.workers.dev"],
      versionId: "version-1",
    }))).toEqual({
      urls: ["https://edgeever.example.workers.dev"],
      versionId: "version-1",
    });
    expect(resolveDeploymentUrl({
      env: { EDGE_EVER_DEPLOYMENT_URL: "https://notes.example.com/app" },
      capturedUrls: ["https://edgeever.example.workers.dev"],
    })).toBe("https://notes.example.com");
    expect(resolveDeploymentUrl({
      env: { EDGE_EVER_CUSTOM_DOMAIN: "notes.example.com" },
      capturedUrls: [],
    })).toBe("https://notes.example.com");
    expect(() => normalizeDeploymentUrl("file:///tmp/edgeever")).toThrow("must use HTTP(S)");
  });

  test("verifies the live Worker health response", async () => {
    let requestedUrl = "";
    const result = await verifyCloudflareWorkerHealth({
      deploymentUrl: "https://notes.example.com",
      attempts: 1,
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return Response.json({ ok: true, authMode: "required" });
      },
    });

    expect(requestedUrl).toBe("https://notes.example.com/api/health");
    expect(result.payload).toMatchObject({ ok: true });
  });

  test("requires a URL before requesting the live Worker", async () => {
    expect(verifyCloudflareWorkerHealth({ deploymentUrl: "" })).rejects.toThrow(
      "A deployment URL is required",
    );
  });

  test("diagnoses a live Worker bound to a different unprepared D1 database", async () => {
    expect(verifyCloudflareWorkerHealth({
      deploymentUrl: "https://notes.example.com",
      attempts: 1,
      fetchImpl: async () => Response.json({
        error: { code: "database_not_ready" },
      }, { status: 503 }),
    })).rejects.toThrow("may differ from the DB binding used by the live Worker");
  });

  test("diagnoses a live Worker without its R2 binding", async () => {
    expect(verifyCloudflareWorkerHealth({
      deploymentUrl: "https://notes.example.com",
      attempts: 1,
      fetchImpl: async () => Response.json({
        error: { code: "object_storage_not_ready" },
      }, { status: 503 }),
    })).rejects.toThrow("RESOURCES binding points to the configured R2 bucket");
  });

  test("preserves Cloudflare runtime diagnostics for an unknown health failure", async () => {
    const verification = verifyCloudflareWorkerHealth({
      deploymentUrl: "https://notes.example.com",
      deploymentVersionId: "version-1101",
      attempts: 1,
      fetchImpl: async () => new Response("error code: 1101", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "CF-Ray": "ray-id-SJC" },
      }),
    });

    await expect(verification).rejects.toThrow("response body: error code: 1101");
    await expect(verification).rejects.toThrow("CF-Ray: ray-id-SJC");
    await expect(verification).rejects.toThrow("Worker Version ID: version-1101");
    await expect(verification).rejects.toThrow("Logs > Live");
  });
});
