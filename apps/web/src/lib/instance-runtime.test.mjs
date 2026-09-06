import { describe, expect, test } from "bun:test";
import { resolveDeploymentPlatform } from "./instance-runtime.ts";

describe("resolveDeploymentPlatform", () => {
  test("maps the Cloudflare Workers runtime", () => {
    expect(resolveDeploymentPlatform("cloudflare-workers")).toBe("cloudflare");
  });

  test("maps the self-hosted Bun runtime to Docker", () => {
    expect(resolveDeploymentPlatform("self-hosted-bun")).toBe("docker");
  });

  test("keeps missing and future runtimes explicit", () => {
    expect(resolveDeploymentPlatform(undefined)).toBe("unknown");
    expect(resolveDeploymentPlatform("future-runtime")).toBe("unknown");
  });
});
