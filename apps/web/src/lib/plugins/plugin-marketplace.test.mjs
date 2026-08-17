import { describe, expect, test } from "bun:test";
import { parseMarketplaceRegistry } from "@edgeever/plugin-api";
import { sha256Hex } from "./github-plugin-distribution.ts";

describe("bundled plugin marketplace", () => {
  test("keeps verified checksums aligned with bundled extension files", async () => {
    const registry = parseMarketplaceRegistry(await Bun.file(new URL("../../../public/extensions/registry.json", import.meta.url)).json());
    expect(registry.entries.map((entry) => entry.id)).not.toContain("org.edgeever.examples.recent-notes");
    expect(registry.entries.map((entry) => entry.id)).not.toContain("org.edgeever.themes.nord-emerald");
    for (const entry of registry.entries) {
      expect(entry.distribution.type).toBe("manifest");
      if (entry.distribution.type !== "manifest") continue;
      const relativeManifestPath = entry.distribution.manifestUrl.replace(/^\/extensions\//, "");
      const manifestFileUrl = new URL(`../../../public/extensions/${relativeManifestPath}`, import.meta.url);
      const manifestFile = Bun.file(manifestFileUrl);
      expect(await sha256Hex(await manifestFile.text())).toBe(entry.verification.checksums?.manifestJson);
      if (entry.verification.checksums?.mainJs) {
        const mainFile = Bun.file(new URL("./main.js", manifestFileUrl));
        expect(await sha256Hex(await mainFile.text())).toBe(entry.verification.checksums.mainJs);
      }
    }
  });
});
