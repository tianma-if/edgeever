import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";

// createNoteImage drives html-to-image, the font loader and a canvas. The
// fakes below stand in for the browser pieces linkedom does not provide, so
// the export flow (layout, sizing, retries, cancellation, cleanup) runs
// without a real renderer or network access.

// linkedom's window forwards writes to globalThis; every key written through it is restored.
const GLOBAL_KEYS = [
  "window",
  "document",
  "Element",
  "HTMLElement",
  "SVGElement",
  "HTMLCanvasElement",
  "HTMLImageElement",
  "HTMLVideoElement",
  "HTMLIFrameElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "SVGImageElement",
  "getComputedStyle",
  "XMLSerializer",
  "XMLHttpRequest",
  "FileReader",
  "Image",
  "requestAnimationFrame",
  "fetch",
  "location",
  "devicePixelRatio",
  "setTimeout",
];
const originalDescriptors = new Map(
  GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const linkedomWindow = parseHTML("<!DOCTYPE html><html><head></head><body></body></html>");
const { document: linkedomDocument } = linkedomWindow;
linkedomWindow.location = { href: "https://notes.example/app/", protocol: "https:" };
linkedomWindow.devicePixelRatio = 1;
linkedomWindow.setTimeout = (callback) => {
  callback();
  return 0;
};

const emptyComputedStyle = () => {
  const style = [];
  style.getPropertyValue = () => "";
  style.getPropertyPriority = () => "";
  return style;
};
linkedomWindow.getComputedStyle = emptyComputedStyle;

for (const key of [
  "Element",
  "HTMLElement",
  "SVGElement",
  "HTMLCanvasElement",
  "HTMLImageElement",
  "HTMLVideoElement",
  "HTMLIFrameElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLSelectElement",
]) {
  globalThis[key] = linkedomWindow[key];
}
globalThis.SVGImageElement = linkedomWindow.SVGImageElement ?? class SVGImageElement {};
globalThis.window = linkedomWindow;
globalThis.document = linkedomDocument;
globalThis.getComputedStyle = emptyComputedStyle;
globalThis.requestAnimationFrame = (callback) => {
  callback(0);
  return 0;
};
let serializedSnapshot;
globalThis.XMLSerializer = class {
  serializeToString(node) {
    serializedSnapshot = node.outerHTML;
    return serializedSnapshot;
  }
};
// Every font and texture request fails fast, so fonts fall back to defaults.
globalThis.XMLHttpRequest = class {
  open() {}
  abort() {}
  send() {
    queueMicrotask(() => this.onerror?.());
  }
};
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    });
  }
};

globalThis.Image = class {
  set src(value) {
    this.currentSrc = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this.currentSrc;
  }
  decode() {
    return Promise.resolve();
  }
};

// Canvas fake: records the size and encoding of every rendered bitmap.
const canvasLog = [];
let probe = { nullContextHeights: new Set(), failingHeights: new Set() };
let toBlobResults = [];
let onToBlob = () => {};
const createFakeCanvas = () => {
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    getContext() {
      if (probe.nullContextHeights.has(canvas.height)) return null;
      const context = {
        fillStyle: "",
        fillRect() {
          canvas.background = context.fillStyle;
        },
        drawImage() {},
        getImageData: () => {
          if (probe.failingHeights.has(canvas.height)) throw new Error("canvas too large");
          return { data: [0, 0, 0, 255] };
        },
      };
      return context;
    },
    toDataURL: () => "data:image/png;base64,AAAA",
    toBlob(callback, type, quality) {
      onToBlob();
      const result = toBlobResults.length ? toBlobResults.shift() : "ok";
      canvasLog.push({ width: canvas.width, height: canvas.height, background: canvas.background, type, quality, result });
      callback(result === "empty" ? null : new Blob(["image-bytes"], { type }));
    },
  };
  return canvas;
};
const originalCreateElement = linkedomDocument.createElement.bind(linkedomDocument);
linkedomDocument.createElement = (tag, options) => {
  if (tag === "canvas") return createFakeCanvas();
  return originalCreateElement(tag, options);
};

// linkedom never loads images. html-to-image waits for the inlined copy to
// load, so report every src assignment as loaded.
const imagePrototype = linkedomWindow.HTMLImageElement.prototype;
const imageSrcDescriptor = Object.getOwnPropertyDescriptor(imagePrototype, "src");
Object.defineProperty(imagePrototype, "src", {
  ...imageSrcDescriptor,
  set(value) {
    imageSrcDescriptor.set.call(this, value);
    queueMicrotask(() => this.onload?.());
  },
});

// linkedom has no layout engine; report a configurable rendered height.
let renderedHeight = 640.2;
linkedomWindow.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 800, height: renderedHeight, top: 0, left: 0, right: 800, bottom: renderedHeight };
};

afterAll(() => {
  delete linkedomWindow.HTMLElement.prototype.getBoundingClientRect;
  Object.defineProperty(imagePrototype, "src", imageSrcDescriptor);
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

// The module caches the canvas size probe and serializes renders, so each test
// gets a fresh instance and a default probe where only 65,535px fails.
let mod;
let moduleInstance = 0;
beforeEach(async () => {
  mod = await import(`./note-image-export.ts?instance=${++moduleInstance}`);
  probe = { nullContextHeights: new Set([65_535]), failingHeights: new Set() };
  canvasLog.length = 0;
  toBlobResults = [];
  onToBlob = () => {};
  renderedHeight = 640.2;
  globalThis.fetch = async () => {
    throw new TypeError("network disabled in tests");
  };
});

const baseOptions = {
  bodyHtml: "<p>Hello <strong>world</strong></p>",
  title: "Weekly: plan",
  notebook: "Work",
  tags: ["focus"],
  updatedAt: "2026-05-01",
  fallbackTitle: "Untitled",
  format: "png",
  styles: ".probe{}",
};

const expectAbortError = async (promise) => {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught?.name).toBe("AbortError");
  expect(caught?.message).toBe("Image export cancelled");
};

describe("createNoteImage", () => {
  test("replaces characters that would invalidate the SVG while preserving Unicode text", async () => {
    await mod.createNoteImage({
      ...baseOptions,
      bodyHtml: "<p data-label=\"a\u000Cb\">中文\u000B😀\uD800 end</p>",
      title: "Title\u001F with emoji 😀",
      showTitle: true,
    });

    expect(serializedSnapshot).toContain('data-label="a�b"');
    expect(serializedSnapshot).toContain("中文�😀� end");
    expect(serializedSnapshot).toContain("Title� with emoji 😀");
  });

  test("renders a PNG at twice the card width when every canvas size probe fails", async () => {
    probe = { nullContextHeights: new Set(), failingHeights: new Set([65_535, 32_767, 16_384, 8_192, 4_096]) };
    const statuses = [];
    const result = await mod.createNoteImage({
      ...baseOptions,
      onFontLoadStatus: (status) => statuses.push(status),
    });

    expect(result.filename).toBe("Weekly- plan.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.blob.type).toBe("image/png");
    // 800px card at pixel ratio 2; the 640.2px layout height rounds up to 641.
    expect({ width: result.width, height: result.height }).toEqual({ width: 1600, height: 1282 });
    expect(result.images).toEqual({ total: 0, embedded: 0, failed: 0 });
    // Fonts are unreachable here, so the export falls back instead of failing.
    expect(statuses).toEqual(["loading", "error"]);
    expect(result.fontFallback).toBe(true);
    expect(canvasLog).toEqual([{
      width: 1600,
      height: 1282,
      background: mod.NOTE_IMAGE_BACKGROUND_COLORS[mod.resolveTheme()],
      type: "image/png",
      quality: 1,
      result: "ok",
    }]);
    // The off-screen render host is removed after rendering.
    expect(document.body.children).toHaveLength(0);
  });

  test("renders a JPEG for a legacy theme at the selected card width and reports embedded images", async () => {
    probe = { nullContextHeights: new Set([65_535]), failingHeights: new Set() };
    const result = await mod.createNoteImage({
      ...baseOptions,
      title: "",
      fallbackTitle: "Untitled",
      format: "jpeg",
      theme: "editorial",
      cardWidth: "standard",
      bodyHtml: '<p>Pic</p><img src="data:image/png;base64,AAAA"><img src="https://offline.example/x.png">',
    });

    expect(result.filename).toBe("Untitled.jpg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.images).toEqual({ total: 2, embedded: 1, failed: 1 });
    expect(result.width).toBe(mod.NOTE_IMAGE_CARD_WIDTH_PIXELS.standard * 2);
    expect(canvasLog).toHaveLength(1);
    expect(canvasLog[0]).toMatchObject({
      type: "image/jpeg",
      quality: 0.92,
      background: mod.NOTE_IMAGE_BACKGROUND_COLORS.frame,
    });
  });

  test("falls back to the wide card for an unknown width", async () => {
    const result = await mod.createNoteImage({ ...baseOptions, cardWidth: "gigantic" });
    expect(result.width).toBe(mod.NOTE_IMAGE_CARD_WIDTH_PIXELS.wide * 2);
  });

  test("scales tall notes to the canvas limit and retries within the smaller area limit", async () => {
    renderedHeight = 20_000;
    toBlobResults = ["empty", "ok"];
    const result = await mod.createNoteImage(baseOptions);

    // First attempt uses the 32,767px probe result, the retry caps at 16,384px and 16 MP.
    expect(canvasLog.map(({ result: outcome }) => outcome)).toEqual(["empty", "ok"]);
    expect(canvasLog[0].height).toBeCloseTo(32_767, 6);
    expect(canvasLog[1].height).toBeCloseTo(16_384, 6);
    expect(canvasLog[1].width).toBeCloseTo(800 * (16_384 / 20_000), 6);
    expect(result.height).toBeCloseTo(16_384, 6);
  });

  test("rejects when the retry also produces an empty file and still removes the render host", async () => {
    toBlobResults = ["empty", "empty"];
    let caught;
    try {
      await mod.createNoteImage(baseOptions);
    } catch (error) {
      caught = error;
    }
    expect(caught?.message).toBe("Image renderer returned an empty file");
    expect(canvasLog).toHaveLength(2);
    expect(document.body.children).toHaveLength(0);
  });

  test("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectAbortError(mod.createNoteImage({ ...baseOptions, signal: controller.signal }));
    expect(canvasLog).toHaveLength(0);
  });

  test("stops before rendering when cancelled while fonts load", async () => {
    const controller = new AbortController();
    await expectAbortError(mod.createNoteImage({
      ...baseOptions,
      signal: controller.signal,
      onFontLoadStatus: (status) => {
        if (status === "loading") controller.abort();
      },
    }));
    expect(canvasLog).toHaveLength(0);
    expect(document.body.children).toHaveLength(0);
  });

  test("does not retry when cancelled during the first capture", async () => {
    const controller = new AbortController();
    toBlobResults = ["empty", "ok"];
    onToBlob = () => controller.abort();
    await expectAbortError(mod.createNoteImage({ ...baseOptions, signal: controller.signal }));
    expect(canvasLog).toHaveLength(1);
    expect(document.body.children).toHaveLength(0);
  });

  test("serializes overlapping exports", async () => {
    const [first, second] = await Promise.all([
      mod.createNoteImage({ ...baseOptions, title: "First" }),
      mod.createNoteImage({ ...baseOptions, title: "Second", format: "jpeg" }),
    ]);
    expect([first.filename, second.filename]).toEqual(["First.png", "Second.jpg"]);
    expect(canvasLog.map(({ type }) => type)).toEqual(["image/png", "image/jpeg"]);
  });
});

describe("downloading note images", () => {
  const installDownloadFakes = () => {
    const events = [];
    URL.createObjectURL = (blob) => {
      events.push({ created: blob.type });
      return "blob:https://notes.example/image-1";
    };
    URL.revokeObjectURL = (url) => events.push({ revoked: url });
    const createElement = document.createElement;
    document.createElement = (tag, options) => {
      const element = createElement(tag, options);
      if (tag === "a") {
        element.click = () => events.push({
          clicked: element.href,
          // linkedom percent-encodes the download attribute; browsers keep it verbatim.
          download: decodeURIComponent(element.download),
          hidden: element.hidden,
          attached: element.parentNode === document.body,
        });
      }
      return element;
    };
    return {
      events,
      restore: () => {
        document.createElement = createElement;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      },
    };
  };

  test("downloadPreparedNoteImage clicks a hidden temporary link and revokes the URL", () => {
    const { events, restore } = installDownloadFakes();
    try {
      mod.downloadPreparedNoteImage({ blob: new Blob(["x"], { type: "image/png" }), filename: "My note.png" });
      expect(events).toEqual([
        { created: "image/png" },
        {
          clicked: "blob:https://notes.example/image-1",
          download: "My note.png",
          hidden: true,
          attached: true,
        },
        { revoked: "blob:https://notes.example/image-1" },
      ]);
      expect(document.body.querySelector("a")).toBeNull();
    } finally {
      restore();
    }
  });

  test("downloadNoteImage renders, downloads and returns the prepared image", async () => {
    const { events, restore } = installDownloadFakes();
    try {
      const prepared = await mod.downloadNoteImage({ ...baseOptions, title: "Trip", format: "jpeg" });
      expect(prepared.filename).toBe("Trip.jpg");
      expect(events.map((event) => Object.keys(event)[0])).toEqual(["created", "clicked", "revoked"]);
      expect(events[1].download).toBe("Trip.jpg");
    } finally {
      restore();
    }
  });
});
