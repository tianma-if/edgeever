import { describe, expect, test } from "bun:test";
import { downloadGithubReleaseAsset } from "./plugin-distribution-routes.ts";

describe("GitHub plugin release asset proxy", () => {
  test("downloads a supported release asset on the server", async () => {
    const calls = [];
    const buffer = await downloadGithubReleaseAsset({
      owner: "example",
      repository: "edgeever-plugin",
      assetId: "42",
      assetName: "main.js",
      request: async (input) => {
        calls.push(String(input));
        return new Response("export default {};", { headers: { "content-length": "18" } });
      },
    });

    expect(new TextDecoder().decode(buffer)).toBe("export default {};");
    expect(calls).toEqual(["https://api.github.com/repos/example/edgeever-plugin/releases/assets/42"]);
  });

  test("rejects an oversized release asset", async () => {
    await expect(downloadGithubReleaseAsset({
      owner: "example",
      repository: "edgeever-plugin",
      assetId: "42",
      assetName: "manifest.json",
      request: async () => new Response("", { headers: { "content-length": String(300 * 1024) } }),
    })).rejects.toThrow("exceeds the allowed package size");
  });
});
