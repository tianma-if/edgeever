import { describe, expect, test } from "bun:test";
import { downloadGithubExtension, parseGithubRepositoryUrl } from "./github-plugin-distribution.ts";

const manifest = {
  type: "plugin",
  id: "org.edgeever.github-test",
  name: "GitHub Test",
  version: "1.2.3",
  apiVersion: "1",
  entry: "./main.js",
  permissions: ["ui:notices"],
};

describe("GitHub plugin distribution", () => {
  test("accepts only canonical public GitHub repository URLs", () => {
    expect(parseGithubRepositoryUrl("https://github.com/example/edgeever-plugin.git")).toEqual({
      owner: "example",
      repository: "edgeever-plugin",
      repositoryUrl: "https://github.com/example/edgeever-plugin",
    });
    expect(parseGithubRepositoryUrl("https://github.com/example/edgeever-plugin/tree/main")).toBeNull();
    expect(parseGithubRepositoryUrl("https://gitlab.com/example/edgeever-plugin")).toBeNull();
  });

  test("downloads the versioned release bundle and falls back to a v-prefixed tag", async () => {
    const calls = [];
    const request = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/contents/manifest.json")) return Response.json(manifest);
      if (url.endsWith("/releases/tags/1.2.3")) return new Response(null, { status: 404 });
      if (url.endsWith("/releases/tags/v1.2.3")) {
        return Response.json({
          tag_name: "v1.2.3",
          draft: false,
          assets: [
            { id: 1, name: "manifest.json", size: 512, url: "https://api.github.com/assets/1", browser_download_url: "https://github.com/download/manifest.json" },
            { id: 2, name: "main.js", size: 128, url: "https://api.github.com/assets/2", browser_download_url: "https://github.com/download/main.js" },
          ],
        });
      }
      return new Response(null, { status: 500 });
    };
    const downloadAsset = async (_coordinates, asset) => new TextEncoder().encode(
      asset.id === 1 ? JSON.stringify(manifest) : "export default { activate() {} };",
    ).buffer;

    const downloaded = await downloadGithubExtension("https://github.com/example/edgeever-plugin", request, downloadAsset);

    expect(downloaded.releaseTag).toBe("v1.2.3");
    expect(downloaded.pluginPackage?.pluginId).toBe("org.edgeever.github-test");
    expect(downloaded.pluginPackage?.mainJs).toContain("activate");
    expect(downloaded.checksums.mainJs).toHaveLength(64);
    expect(calls).toContain("https://api.github.com/repos/example/edgeever-plugin/contents/manifest.json");
    expect(calls).toContain("https://api.github.com/repos/example/edgeever-plugin/releases/tags/1.2.3");
    expect(calls).not.toContain("https://api.github.com/assets/1");
  });

  test("rejects a release without a bundled main.js asset", async () => {
    const request = async (input) => {
      const url = String(input);
      if (url.endsWith("/contents/manifest.json")) return Response.json(manifest);
      if (url.endsWith("/releases/tags/1.2.3")) {
        return Response.json({ tag_name: "1.2.3", draft: false, assets: [{ id: 1, name: "manifest.json", size: 512, url: "asset", browser_download_url: "asset" }] });
      }
      return new Response(null, { status: 404 });
    };
    await expect(downloadGithubExtension("https://github.com/example/edgeever-plugin", request)).rejects.toThrow("missing main.js");
  });

  test("rejects release permissions that differ from the repository manifest", async () => {
    const request = async (input) => {
      const url = String(input);
      if (url.endsWith("/contents/manifest.json")) return Response.json(manifest);
      if (url.endsWith("/releases/tags/1.2.3")) {
        return Response.json({
          tag_name: "1.2.3",
          draft: false,
          assets: [
            { id: 1, name: "manifest.json", size: 512, url: "asset", browser_download_url: "manifest-asset" },
            { id: 2, name: "main.js", size: 128, url: "asset", browser_download_url: "main-asset" },
          ],
        });
      }
      return new Response(null, { status: 404 });
    };
    const releaseManifest = { ...manifest, permissions: [...manifest.permissions, "network"], networkHosts: ["api.example.com"] };
    const downloadAsset = async (_coordinates, asset) => new TextEncoder().encode(
      asset.id === 1 ? JSON.stringify(releaseManifest) : "export default { activate() {} };",
    ).buffer;

    await expect(downloadGithubExtension("https://github.com/example/edgeever-plugin", request, downloadAsset))
      .rejects.toThrow("does not match the repository manifest");
  });
});
