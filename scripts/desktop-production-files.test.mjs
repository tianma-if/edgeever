import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertDesktopProductionFiles } from "./desktop-production-files.mjs";

const desktopRequire = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const builderRequire = createRequire(createRequire(desktopRequire.resolve("electron-builder")).resolve("app-builder-lib"));
const { FileMatcher, getNodeModuleFileMatcher } = builderRequire("./fileMatcher.js");
const { load } = createRequire(desktopRequire.resolve("electron-updater"))("js-yaml");
const config = load(readFileSync(new URL("../apps/desktop/electron-builder.yml", import.meta.url), "utf8"));
const appDir = resolve("apps/desktop");
const applicationFilter = new FileMatcher(appDir, "/unused", (value) => value, config.files).createFilter();
const dependencyFilter = getNodeModuleFileMatcher(appDir, "/unused", (value) => value, {}, {
  config, debugLogger: { isEnabled: false },
}).createFilter();

describe("desktop production archive", () => {
  test("electron-builder removes development files in app code and nested dependencies", () => {
    for (const file of [
      "src/main/example.test.mjs", "src/main/example.spec.cjs",
      "src/main/__tests__/helper.js", "src/main/example.mjs.map",
      "node_modules/@agentclientprotocol/sdk/dist/acp.test.js",
      "node_modules/npm/node_modules/example/dist/tests/helper.js",
      "node_modules/zod/index.d.cts", "node_modules/example/index.d.mts",
      "node_modules/example/index.js.map", "node_modules/zod/src/index.ts",
    ]) {
      const filter = file.startsWith("node_modules/") ? dependencyFilter : applicationFilter;
      expect(filter(join(appDir, file), { isDirectory: () => false })).toBe(false);
    }
  });

  test("preserves runtime commands, Python support, schemas and license notices", () => {
    for (const file of [
      "src/main/index.mjs", "src/preload/index.cjs",
      "node_modules/npm/lib/commands/test.js", "node_modules/npm/bin/npm-cli.js",
      "node_modules/node-gyp/gyp/gyp_main.py",
      "node_modules/@agentclientprotocol/sdk/dist/acp.js",
      "node_modules/@agentclientprotocol/sdk/schema/schema.json",
      "node_modules/@agentclientprotocol/sdk/LICENSE-APACHE",
      "node_modules/@edgeever/image-host/src/imgbed-client.mjs",
      "node_modules/zod/index.js", "node_modules/zod/index.cjs",
      "node_modules/electron-updater/out/main.js",
      "node_modules/npm/docs/output/commands/npm-install.html",
    ]) {
      const filter = file.startsWith("node_modules/") ? dependencyFilter : applicationFilter;
      expect(filter(join(appDir, file), { isDirectory: () => false })).toBe(true);
    }
  });

  test("rejects an archive with omitted runtime files or leaked development files", () => {
    expect(() => assertDesktopProductionFiles(["/src/main/index.mjs"])).toThrow("missing runtime file");
    expect(() => assertDesktopProductionFiles(["/node_modules/sdk/dist/acp.test.js"])).toThrow("development files");
  });

  test("excludes renderer source maps while retaining every font format", () => {
    const web = config.extraResources.find((resource) => resource.to === "web");
    const root = resolve("apps/web/dist");
    const filter = new FileMatcher(root, "/unused", (value) => value, web.filter).createFilter();
    expect(filter(join(root, "assets/app.js.map"), { isDirectory: () => false })).toBe(false);
    for (const file of ["index.html", "assets/app.js", "assets/font.woff2", "poster-fonts/font.ttf", "poster-fonts/LICENSE.txt"]) {
      expect(filter(join(root, file), { isDirectory: () => false })).toBe(true);
    }
  });
});
