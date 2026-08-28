import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("desktop abnormal-exit recovery", () => {
  test("exposes the previous abnormal session to the renderer before workspace startup", () => {
    const mainSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
    const preloadSource = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");

    expect(mainSource).toContain("recoveredAfterAbnormalExit = existsSync(crashMarkerPath())");
    expect(mainSource).toContain('ipcMain.on("desktop:recovered-after-abnormal-exit-sync"');
    expect(preloadSource).toContain('recoveredAfterAbnormalExit: ipcRenderer.sendSync("desktop:recovered-after-abnormal-exit-sync")');
  });
});
