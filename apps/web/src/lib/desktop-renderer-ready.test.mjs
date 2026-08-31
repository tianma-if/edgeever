import { afterEach, describe, expect, test } from "bun:test";
import { reportDesktopRendererReadyAfterPaint } from "./desktop-renderer-ready.ts";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

describe("desktop renderer readiness", () => {
  test("reports readiness only after UI exists across two animation frames", () => {
    const frames = [];
    let reports = 0;
    globalThis.window = {
      edgeeverDesktop: { rendererBootstrapReady: () => { reports += 1; } },
      requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelAnimationFrame: () => {},
    };
    globalThis.document = {
      documentElement: { dataset: {} },
      querySelector: (selector) => selector === "#root > *" ? {} : null,
    };

    reportDesktopRendererReadyAfterPaint();
    expect(reports).toBe(0);
    frames.shift()(16);
    expect(reports).toBe(0);
    frames.shift()(32);

    expect(reports).toBe(1);
    expect(document.documentElement.dataset.edgeeverRendererReady).toBe("true");
  });
});
