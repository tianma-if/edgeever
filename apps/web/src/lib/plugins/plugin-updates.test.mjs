import { describe, expect, test } from "bun:test";
import { checkInstalledExtensionUpdate, checkPluginUpdates } from "./plugin-updates.ts";

const pluginManifest = {
  type: "plugin",
  id: "org.edgeever.update-test",
  name: "Update Test",
  version: "1.0.0",
  apiVersion: "1",
  entry: "./main.js",
  permissions: ["ui:notices"],
};

const installed = (overrides = {}) => ({
  manifestUrl: "https://example.com/plugin/manifest.json",
  manifest: pluginManifest,
  enabled: true,
  installedAt: "2026-08-16T00:00:00.000Z",
  error: null,
  source: { kind: "manifest", verified: false },
  ...overrides,
});

describe("plugin update checks", () => {
  test("detects a manifest update and reports added access", async () => {
    const request = async () => Response.json({
      ...pluginManifest,
      version: "1.1.0",
      permissions: ["ui:notices", "network"],
      networkHosts: ["api.example.com"],
    });

    const update = await checkInstalledExtensionUpdate(installed(), [], request);

    expect(update?.latestVersion).toBe("1.1.0");
    expect(update?.addedPermissions).toEqual(["network"]);
    expect(update?.addedNetworkHosts).toEqual(["api.example.com"]);
  });

  test("uses the verified registry version for marketplace installs", async () => {
    const entry = {
      id: pluginManifest.id,
      name: pluginManifest.name,
      description: "Verified plugin",
      author: "EdgeEver",
      category: "Productivity",
      repositoryUrl: "https://github.com/example/plugin",
      distribution: { type: "manifest", manifestUrl: "https://example.com/verified/manifest.json" },
      verification: { version: "1.2.0" },
    };
    const request = async () => Response.json({ ...pluginManifest, version: "1.2.0" });

    const update = await checkInstalledExtensionUpdate(installed({ source: { kind: "marketplace", verified: true } }), [entry], request);

    expect(update?.latestVersion).toBe("1.2.0");
    expect(update?.marketplaceEntry).toEqual(entry);
  });

  test("does not offer the same or an older version", async () => {
    const request = async () => Response.json(pluginManifest);
    expect(await checkInstalledExtensionUpdate(installed(), [], request)).toBeNull();
  });

  test("isolates a failed source while checking other extensions", async () => {
    const broken = installed({ manifest: { ...pluginManifest, id: "org.edgeever.broken" }, manifestUrl: "https://broken.example/manifest.json" });
    const request = async (input) => String(input).includes("broken")
      ? new Response(null, { status: 503 })
      : Response.json({ ...pluginManifest, version: "2.0.0" });

    const result = await checkPluginUpdates([broken, installed()], [], request);

    expect(result.updates.map((update) => update.pluginId)).toEqual([pluginManifest.id]);
    expect(result.errors["org.edgeever.broken"]).toContain("503");
  });
});
