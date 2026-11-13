import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { downloadGithubExtension, downloadPinnedGithubExtension, loadGithubInstallableManifest, loadGithubRepositoryManifest, parseGithubRepositoryUrl, sha256Hex } from "./github-plugin-distribution.ts";
import { createHash } from "node:crypto";
import { verifyCommunityRegistrySignature } from "./community-registry-keys.ts";
import { stubUnavailableGithubInstance } from "./github-plugin-test-api.mjs";

let restoreGithubInstance;
beforeAll(() => { restoreGithubInstance = stubUnavailableGithubInstance(); });
afterAll(() => { restoreGithubInstance?.(); });

const manifest = {
  type: "plugin",
  id: "org.edgeever.github-test",
  name: "GitHub Test",
  version: "1.2.3",
  apiVersion: "2",
  settingsUi: "host",
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
    const assetDownloads = [];
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      assetDownloads.push([releaseTag, asset.name]);
      return new TextEncoder().encode(
        asset.id === 1 ? JSON.stringify(manifest) : "export default { activate() {} };",
      ).buffer;
    };

    const downloaded = await downloadGithubExtension("https://github.com/example/edgeever-plugin", request, downloadAsset);

    expect(downloaded.releaseTag).toBe("v1.2.3");
    expect(downloaded.pluginPackage?.pluginId).toBe("org.edgeever.github-test");
    expect(downloaded.pluginPackage?.mainJs).toContain("activate");
    expect(downloaded.checksums.mainJs).toHaveLength(64);
    expect(assetDownloads).toEqual([
      ["v1.2.3", "manifest.json"],
      ["v1.2.3", "main.js"],
    ]);
    expect(calls).toContain("https://api.github.com/repos/example/edgeever-plugin/contents/manifest.json");
    expect(calls).toContain("https://api.github.com/repos/example/edgeever-plugin/releases/tags/1.2.3");
    expect(calls).not.toContain("https://api.github.com/assets/1");
  });

  test("downloads public release assets when GitHub's REST API rate-limits the browser", async () => {
    const request = async (input) => {
      const url = String(input);
      if (url.endsWith("/contents/manifest.json")) return Response.json(manifest);
      if (url.includes("/releases/tags/")) return new Response("rate limited", { status: 403 });
      throw new Error(`Unexpected request: ${url}`);
    };
    const calls = [];
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      calls.push([releaseTag, asset.name]);
      if (releaseTag === "1.2.3") throw new Error(`GitHub asset ${asset.name} failed with HTTP 404.`);
      return new TextEncoder().encode(
        asset.name === "manifest.json" ? JSON.stringify(manifest) : "export default { activate() {} };",
      ).buffer;
    };

    const downloaded = await downloadGithubExtension("https://github.com/example/edgeever-plugin", request, downloadAsset);

    expect(downloaded.releaseTag).toBe("v1.2.3");
    expect(downloaded.pluginPackage?.mainJs).toContain("activate");
    expect(calls[0]).toEqual(["1.2.3", "manifest.json"]);
    expect(calls).toContainEqual(["v1.2.3", "main.js"]);
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
    const downloadAsset = async (_coordinates, _releaseTag, asset) => new TextEncoder().encode(
      asset.id === 1 ? JSON.stringify(releaseManifest) : "export default { activate() {} };",
    ).buffer;

    await expect(downloadGithubExtension("https://github.com/example/edgeever-plugin", request, downloadAsset))
      .rejects.toThrow("does not match the repository manifest");
  });

  test("reads an installable plugin from the latest GitHub Release without using the REST API", async () => {
    const calls = [];
    const request = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.github.com")) throw new Error(`should not use GitHub REST: ${url}`);
      if (url === "https://github.com/example/edgeever-plugin/releases/latest/download/manifest.json") {
        return new Response(JSON.stringify(manifest));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const loaded = await loadGithubInstallableManifest("https://github.com/example/edgeever-plugin", request);

    expect(loaded.manifest.version).toBe("1.2.3");
    expect(calls).toEqual([
      "https://github.com/example/edgeever-plugin/releases/latest/download/manifest.json",
    ]);
  });

  test("falls back to raw GitHub when the latest Release download is rate-limited", async () => {
    const calls = [];
    const request = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.github.com")) throw new Error(`should not use GitHub REST: ${url}`);
      if (url.includes("/releases/latest/download/manifest.json")) {
        return new Response("rate limited", { status: 403 });
      }
      if (url === "https://raw.githubusercontent.com/example/edgeever-plugin/HEAD/manifest.json") {
        return new Response(JSON.stringify(manifest));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const loaded = await loadGithubInstallableManifest("https://github.com/example/edgeever-plugin", request);

    expect(loaded.manifest.version).toBe("1.2.3");
    expect(calls).toContain("https://raw.githubusercontent.com/example/edgeever-plugin/HEAD/manifest.json");
    expect(calls.some((url) => url.includes("api.github.com"))).toBe(false);
  });

  test("reads the repository manifest from raw GitHub when the REST API rate-limits the browser", async () => {
    const calls = [];
    const request = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/contents/manifest.json")) return new Response("rate limited", { status: 403 });
      if (url === "https://raw.githubusercontent.com/example/edgeever-plugin/HEAD/manifest.json") {
        return new Response(JSON.stringify(manifest));
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const loaded = await loadGithubRepositoryManifest("https://github.com/example/edgeever-plugin", request);

    expect(loaded.manifest.version).toBe("1.2.3");
    expect(calls).toContain("https://raw.githubusercontent.com/example/edgeever-plugin/HEAD/manifest.json");
  });

  test("explains a renderer network failure instead of showing Failed to fetch", async () => {
    const request = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(downloadGithubExtension("https://github.com/example/edgeever-plugin", request, async () => new ArrayBuffer(0)))
      .rejects.toThrow("Could not read this GitHub plugin from this device or your EdgeEver instance");
  });

  test("installs a marketplace GitHub plugin from the pinned release without calling GitHub's REST API", async () => {
    const calls = [];
    const assets = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer,
      "main.js": new TextEncoder().encode("export default { activate() {} };").buffer,
      "styles.css": new TextEncoder().encode(".ai-rss {}").buffer,
    };
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      calls.push([releaseTag, asset.name]);
      const buffer = assets[asset.name];
      if (!buffer) throw new Error(`GitHub asset ${asset.name} failed with HTTP 404.`);
      return buffer;
    };

    const downloaded = await downloadPinnedGithubExtension("https://github.com/example/edgeever-plugin", "1.2.3", {
      downloadAssetBytes: downloadAsset,
      requireStyles: true,
    });

    expect(downloaded.releaseTag).toBe("1.2.3");
    expect(downloaded.manifest.id).toBe("org.edgeever.github-test");
    expect(downloaded.pluginPackage?.mainJs).toContain("activate");
    expect(downloaded.checksums.stylesCss).toHaveLength(64);
    expect(calls[0]).toEqual(["1.2.3", "manifest.json"]);
    expect(calls).toContainEqual(["1.2.3", "main.js"]);
    expect(calls).toContainEqual(["1.2.3", "styles.css"]);
  });

  test("falls back to a v-prefixed marketplace release tag when the instance reports the GitHub release was not found", async () => {
    const calls = [];
    const assets = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer,
      "main.js": new TextEncoder().encode("export default { activate() {} };").buffer,
    };
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      calls.push([releaseTag, asset.name]);
      if (releaseTag === "1.2.3") throw new Error("GitHub release was not found.");
      const buffer = assets[asset.name];
      if (!buffer) throw new Error(`GitHub asset ${asset.name} failed with HTTP 404.`);
      return buffer;
    };

    const downloaded = await downloadPinnedGithubExtension("https://github.com/example/edgeever-plugin", "1.2.3", {
      downloadAssetBytes: downloadAsset,
    });

    expect(downloaded.releaseTag).toBe("v1.2.3");
    expect(calls[0]).toEqual(["1.2.3", "manifest.json"]);
    expect(calls).toContainEqual(["v1.2.3", "main.js"]);
  });

  test("falls back to a v-prefixed marketplace release tag when the unprefixed tag is missing", async () => {
    const calls = [];
    const assets = {
      "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)).buffer,
      "main.js": new TextEncoder().encode("export default { activate() {} };").buffer,
    };
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      calls.push([releaseTag, asset.name]);
      if (releaseTag === "1.2.3") throw new Error(`GitHub asset ${asset.name} failed with HTTP 404.`);
      const buffer = assets[asset.name];
      if (!buffer) throw new Error(`GitHub asset ${asset.name} failed with HTTP 404.`);
      return buffer;
    };

    const downloaded = await downloadPinnedGithubExtension("https://github.com/example/edgeever-plugin", "1.2.3", {
      downloadAssetBytes: downloadAsset,
    });

    expect(downloaded.releaseTag).toBe("v1.2.3");
    expect(calls[0]).toEqual(["1.2.3", "manifest.json"]);
    expect(calls).toContainEqual(["v1.2.3", "main.js"]);
  });

  test("installs the live resolved marketplace version, not a frozen bundled registry pin", async () => {
    const liveManifest = { ...manifest, version: "0.5.4" };
    const downloadAsset = async (_coordinates, releaseTag, asset) => {
      expect(releaseTag).toBe("0.5.4");
      return new TextEncoder().encode(
        asset.name === "manifest.json" ? JSON.stringify(liveManifest) : "export default { activate() {} };",
      ).buffer;
    };

    const downloaded = await downloadPinnedGithubExtension("https://github.com/example/edgeever-plugin", "0.5.4", {
      downloadAssetBytes: downloadAsset,
    });

    expect(downloaded.manifest.version).toBe("0.5.4");
  });
});

// An HTTP LAN origin exposes crypto.getRandomValues, but not crypto.subtle.
test("SHA-256 retains byte-for-byte integrity checks without SubtleCrypto", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  try {
    // A missing crypto API must never accept an unverified community catalog.
    expect(await verifyCommunityRegistrySignature(new Uint8Array([1]), new Uint8Array(64), [new Uint8Array(32)])).toBe(false);
    for (const value of ["", "abc", "插件完整性校验 🔒", "a".repeat(100000)]) {
      expect(await sha256Hex(value)).toBe(createHash("sha256").update(value).digest("hex"));
    }
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(await sha256Hex(bytes.buffer)).toBe(createHash("sha256").update(bytes).digest("hex"));
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

test("a native hashing failure is not silently ignored", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
    subtle: { digest: async () => { throw new Error("hashing failed"); } },
  } });
  try {
    await expect(sha256Hex("abc")).rejects.toThrow("hashing failed");
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});
