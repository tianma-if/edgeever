import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAppVersion } from "../apps/web/build-metadata";
import {
  resolveDeploymentBuildMetadata,
  resolveDeploymentMethod,
  resolveDeploymentTrigger,
} from "@edgeever/shared/deployment-metadata";

const rootPackage = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8")) as {
  version: string;
};

const currentReleaseTag = (() => {
  try {
    return execFileSync(
      "git",
      ["describe", "--tags", "--exact-match", "--match", "v[0-9]*.[0-9]*.[0-9]*"],
      {
        cwd: resolve(import.meta.dir, ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
  } catch {
    return null;
  }
})();

describe("web build metadata", () => {
  test("uses the exact release version on a tagged commit", () => {
    expect(resolveAppVersion("0.1.3", "v0.2.3-0-g2f052fa")).toBe("0.2.3");
  });

  test("identifies commits made after the latest release", () => {
    expect(resolveAppVersion("0.1.3", "v0.2.3-3-g96032af")).toBe("0.2.3+3");
  });

  test("falls back to package metadata when Git tags are unavailable", () => {
    expect(resolveAppVersion("1.5.6", null)).toBe("1.5.6");
    expect(resolveAppVersion("1.5.6", "not-a-release")).toBe("1.5.6");
  });

  test("keeps package metadata aligned on a tagged release commit", () => {
    if (!currentReleaseTag) return;
    expect(rootPackage.version).toBe(currentReleaseTag.replace(/^v/, ""));
  });
});

describe("deployment build metadata", () => {
  test("preserves explicit deployment metadata", () => {
    expect(resolveDeploymentBuildMetadata({
      EDGE_EVER_DEPLOYMENT_TRIGGER: "github_release",
      EDGE_EVER_DEPLOYMENT_METHOD: "github_actions",
    })).toEqual({ trigger: "github_release", method: "github_actions" });
  });

  test("infers standard GitHub Actions triggers", () => {
    expect(resolveDeploymentBuildMetadata({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    })).toEqual({ trigger: "manual", method: "github_actions" });
    expect(resolveDeploymentBuildMetadata({
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF_NAME: "main",
    })).toEqual({ trigger: "main_push", method: "github_actions" });
  });

  test("keeps unsupported or missing values explicit as unknown", () => {
    expect(resolveDeploymentTrigger("scheduled")).toBe("unknown");
    expect(resolveDeploymentMethod(undefined)).toBe("unknown");
    expect(resolveDeploymentBuildMetadata({})).toEqual({ trigger: "unknown", method: "unknown" });
  });
});
