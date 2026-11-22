import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  captureDisplayScreenshot,
  captureRegionScreenToNote,
  clampRegionSelection,
  createScreenshotCaptureGuard,
  cropRectForDisplay,
  isScreenshotCancelledExit,
  macScreencaptureArgs,
  normalizeIpcBytes,
  readCapturedScreenshot,
  screenshotFileName,
  screenshotImportIpcPayload,
  screenshotNoteTitle,
} from "./screenshot-capture.mjs";

const mainSource = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const preloadSource = readFileSync(new URL("../preload/index.cjs", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../../../web/src/components/WorkspaceApp.tsx", import.meta.url), "utf8");

describe("screenshot capture helpers", () => {
  test("opens the macOS interactive region selector and writes a png", () => {
    expect(macScreencaptureArgs("/tmp/capture.png")).toEqual(["-i", "-x", "-t", "png", "/tmp/capture.png"]);
  });

  test("clamps a dragged region and maps it onto the captured pixels", () => {
    expect(clampRegionSelection({ x: -5, y: 1, width: 30, height: 20 }, { width: 100, height: 50 })).toEqual({
      x: 0, y: 1, width: 25, height: 20,
    });
    expect(clampRegionSelection({ x: 0, y: 0, width: 4, height: 4 }, { width: 100, height: 50 })).toBeNull();
    expect(clampRegionSelection({ full: true }, { width: 100, height: 50 })).toEqual({ full: true });
    expect(cropRectForDisplay({
      selection: { x: 10, y: 5, width: 20, height: 10 },
      displaySize: { width: 100, height: 50 },
      imageSize: { width: 200, height: 100 },
    })).toEqual({ x: 20, y: 10, width: 40, height: 20 });
  });

  test("treats screencapture cancel exit codes as a quiet abort", () => {
    expect(isScreenshotCancelledExit({ code: 1 })).toBe(true);
    expect(isScreenshotCancelledExit({ code: 2 })).toBe(true);
    expect(isScreenshotCancelledExit({ code: "ENOENT" })).toBe(false);
  });

  test("captures the display under the cursor without a crop overlay", async () => {
    const bytes = await captureDisplayScreenshot({
      screen: {
        getCursorScreenPoint: () => ({ x: 10, y: 10 }),
        getDisplayNearestPoint: () => ({
          id: 2,
          size: { width: 100, height: 50 },
          scaleFactor: 2,
        }),
      },
      desktopCapturer: {
        getSources: async (options) => {
          expect(options).toEqual({ types: ["screen"], thumbnailSize: { width: 200, height: 100 } });
          return [{
            display_id: "2",
            thumbnail: {
              isEmpty: () => false,
              toPNG: () => Buffer.from("png"),
            },
          }];
        },
      },
    });
    expect(bytes).toEqual(Buffer.from("png"));
  });

  test("returns null when the user cancelled before a file was written", async () => {
    const bytes = await readCapturedScreenshot("/missing.png", {
      readFile: async () => Buffer.from("png"),
      unlink: async () => {},
      stat: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    });
    expect(bytes).toBeNull();
  });

  test("localizes the generated note title", () => {
    const date = new Date(2026, 8, 14, 11, 8, 3);
    expect(screenshotNoteTitle("zh-CN", date)).toBe("截图 2026-09-14 11:08");
    expect(screenshotNoteTitle("en-US", date)).toBe("Screenshot 2026-09-14 11:08");
    expect(screenshotNoteTitle("pl", date)).toBe("Zrzut ekranu 2026-09-14 11:08");
    expect(screenshotNoteTitle("ru-RU", date)).toBe("Снимок экрана 2026-09-14 11:08");
    expect(screenshotFileName(date)).toBe("screenshot-20260914-110803.png");
  });

  test("restores Electron Buffer JSON instead of constructing an empty typed array", () => {
    const encoded = { type: "Buffer", data: [137, 80, 78, 71] };
    expect(new Uint8Array(encoded).byteLength).toBe(0);
    expect(Array.from(normalizeIpcBytes(encoded))).toEqual([137, 80, 78, 71]);
    expect(screenshotImportIpcPayload({
      captureId: "shot-1",
      name: "screenshot.png",
      type: "image/png",
      title: "截图",
      bytes: Buffer.from([1, 2, 3]),
    })).toMatchObject({
      captureId: "shot-1",
      name: "screenshot.png",
      title: "截图",
    });
    expect(Array.from(screenshotImportIpcPayload({
      captureId: "shot-1",
      name: "screenshot.png",
      type: "image/png",
      title: "截图",
      bytes: Buffer.from([1, 2, 3]),
    }).bytes)).toEqual([1, 2, 3]);
  });
});

describe("region screenshot to note", () => {
  const display = {
    id: 2,
    size: { width: 100, height: 50 },
    scaleFactor: 2,
    bounds: { x: 0, y: 0, width: 100, height: 50 },
  };
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 200, height: 100 }),
    crop: (rect) => ({
      isEmpty: () => false,
      toPNG: () => Buffer.from(`crop:${rect.x},${rect.y},${rect.width},${rect.height}`),
    }),
    toPNG: () => Buffer.from("full"),
  };
  const input = {
    locale: "zh-CN",
    now: new Date(2026, 8, 14, 11, 8, 3),
    screen: {
      getCursorScreenPoint: () => ({ x: 1, y: 1 }),
      getDisplayNearestPoint: () => display,
    },
    desktopCapturer: {
      getSources: async () => [{ display_id: "2", thumbnail: image }],
    },
  };

  test("crops the selected region into a note payload", async () => {
    const selected = await captureRegionScreenToNote({
      ...input,
      selectRegion: async () => ({ x: 10, y: 5, width: 20, height: 10 }),
    });
    expect(Buffer.from(selected.bytes).toString()).toBe("crop:20,10,40,20");
    expect(selected.title).toBe("截图 2026-09-14 11:08");
    expect(selected.type).toBe("image/png");
  });

  test("keeps the whole display when the user double-clicks", async () => {
    const selected = await captureRegionScreenToNote({
      ...input,
      selectRegion: async () => ({ full: true }),
    });
    expect(Buffer.from(selected.bytes).toString()).toBe("full");
  });

  test("returns null when the selection is cancelled", async () => {
    const cancelled = await captureRegionScreenToNote({
      ...input,
      selectRegion: async () => null,
    });
    expect(cancelled).toBeNull();
  });
});

describe("screenshot capture guard", () => {
  test("rejects a second capture until the cooldown elapses", () => {
    const timers = [];
    const guard = createScreenshotCaptureGuard({
      cooldownMs: 20,
      schedule: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      cancel: () => {},
    });
    expect(guard.tryBegin()).toBe(true);
    expect(guard.tryBegin()).toBe(false);
    guard.end();
    expect(guard.tryBegin()).toBe(false);
    timers.at(-1)();
    expect(guard.tryBegin()).toBe(true);
  });

  test("releases immediately after a region selection instead of keeping the cooldown", () => {
    const guard = createScreenshotCaptureGuard({
      cooldownMs: 20,
      schedule: () => 1,
      cancel: () => {},
    });
    expect(guard.tryBegin()).toBe(true);
    guard.release();
    expect(guard.tryBegin()).toBe(true);
  });
});

describe("desktop screenshot to note wiring", () => {
  test("replaces the tray sync and backup actions with screenshot capture", () => {
    expect(mainSource).toContain("captureScreenshotToNote");
    expect(mainSource).toContain("captureScreenToNote");
    expect(mainSource).toContain("captureRegionScreenToNote");
    expect(mainSource).toContain("openScreenshotRegionSelector");
    expect(mainSource).toContain("cancelScreenshotRegionSelection");
    expect(mainSource).toContain("desktop:set-screenshot-shortcut");
    expect(mainSource).toContain("parseStoredGlobalShortcuts");
    expect(mainSource).not.toContain("JSON.stringify({ binding })");
    expect(mainSource).toContain("createScreenshotCaptureGuard");
    expect(mainSource).toContain("sentScreenshotCaptureIds");
    expect(mainSource).toContain("pendingScreenshotImport = null");
    expect(mainSource).not.toContain("overlay.html");
    expect(mainSource).toContain("screenshot-region.html");
    expect(mainSource).toContain("copy.screenshotToNote");
    expect(mainSource).toContain("formatGlobalShortcutForHumans");
    expect(mainSource).not.toContain('label: copy.syncNow, click: () => sendDesktopCommand("sync-now")');
    expect(mainSource).not.toContain('label: copy.backupNow, click: () => sendDesktopCommand("backup-now")');
    expect(preloadSource).toContain("setScreenshotShortcut");
    expect(preloadSource).toContain("onImportScreenshot");
    expect(preloadSource).toContain("screenshotImportListener");
    expect(preloadSource).toContain("rendererReadySent");
    expect(preloadSource).toContain("removeAllListeners");
    expect(preloadSource).toContain('value.type === "Buffer"');
    expect(workspaceSource).toContain("importDesktopScreenshot(payload");
    expect(workspaceSource).not.toContain("setPendingEditorInsert");
  });

  test("subscribes to screenshots before the preload can flush a queued capture", () => {
    const screenshotListener = workspaceSource.indexOf("bridge.onImportScreenshot");
    const markdownListener = workspaceSource.indexOf("bridge.onImportMarkdown");
    expect(screenshotListener).toBeGreaterThan(-1);
    expect(markdownListener).toBeGreaterThan(screenshotListener);
  });
});
