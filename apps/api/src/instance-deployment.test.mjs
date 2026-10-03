import { expect, test } from "bun:test";
import { resolveDeploymentVersionCreatedAt } from "./instance-deployment";

test("normalizes a runtime-supplied deployment version timestamp and rejects missing or invalid values", () => {
  expect(resolveDeploymentVersionCreatedAt({ deploymentVersionCreatedAt: "2026-10-02T08:00:00+08:00" }))
    .toBe("2026-10-02T00:00:00.000Z");
  expect(resolveDeploymentVersionCreatedAt({})).toBeNull();
  expect(resolveDeploymentVersionCreatedAt({ deploymentVersionCreatedAt: "unknown" })).toBeNull();
});
