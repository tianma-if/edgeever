import { describe, expect, test } from "bun:test";
import { resolveSystemInfoDeploymentMetadata } from "./deployment-metadata.ts";

const clientBuildDeployment = {
  trigger: "manual",
  method: "github_actions",
};

describe("system information deployment metadata", () => {
  test("uses metadata reported by the connected instance", () => {
    expect(resolveSystemInfoDeploymentMetadata(
      { trigger: "github_release", method: "github_actions" },
      clientBuildDeployment,
      false,
    )).toEqual({ trigger: "github_release", method: "github_actions" });
  });

  test("does not present a desktop build as the connected instance deployment", () => {
    expect(resolveSystemInfoDeploymentMetadata(undefined, clientBuildDeployment, false))
      .toEqual({ trigger: "unknown", method: "unknown" });
  });

  test("keeps the bundled fallback for web clients connected to an older instance", () => {
    expect(resolveSystemInfoDeploymentMetadata(undefined, clientBuildDeployment, true))
      .toEqual(clientBuildDeployment);
  });
});
