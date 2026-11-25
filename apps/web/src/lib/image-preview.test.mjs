import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import {
  imagePreviewCacheSize,
  loadImagePreview,
  peekImagePreview,
  resourceBlobPath,
} from "./image-preview.ts";

// Bun runs test files in one process: restore the globals we stub so other
// suites keep their real fetch/document/URL implementations.
const originals = {
  fetch: globalThis.fetch,
  createImageBitmap: globalThis.createImageBitmap,
  document: globalThis.document,
  createObjectURL: URL.createObjectURL,
  revokeObjectURL: URL.revokeObjectURL,
};

afterAll(() => {
  globalThis.fetch = originals.fetch;
  globalThis.createImageBitmap = originals.createImageBitmap;
  if (originals.document === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originals.document;
  }
  URL.createObjectURL = originals.createObjectURL;
  URL.revokeObjectURL = originals.revokeObjectURL;
});

const installStubs = (options = {}) => {
  const stubs = { fetchCalls: 0, bitmapCalls: 0, createObjectUrlCalls: 0, lastFetchUrl: null };
  const mimeType = options.mimeType ?? "image/png";

  globalThis.fetch = async (input) => {
    stubs.fetchCalls += 1;
    stubs.lastFetchUrl = String(input);
    return {
      ok: !options.failFetch,
      status: options.failFetch ? 404 : 200,
      blob: async () => new Blob([new Uint8Array(64)], { type: mimeType }),
    };
  };

  globalThis.createImageBitmap = async (_blob, init) => {
    stubs.bitmapCalls += 1;
    const width = init?.resizeWidth ?? 512;
    return { width, height: Math.max(1, Math.round(width * 2)), close: () => undefined };
  };

  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toBlob: (callback) => callback(new Blob(["webp"], { type: "image/webp" })),
    }),
  };

  URL.createObjectURL = () => {
    stubs.createObjectUrlCalls += 1;
    return `blob:test/${stubs.createObjectUrlCalls}`;
  };
  URL.revokeObjectURL = () => undefined;

  return stubs;
};

describe("image previews", () => {
  beforeEach(() => {
    installStubs();
  });

  test("builds one downscaled preview per resource and width", async () => {
    const stubs = installStubs();
    const first = loadImagePreview("res_dedupe", 400);
    const second = loadImagePreview("res_dedupe", 400);
    expect(peekImagePreview("res_dedupe", 400)).toBeNull();

    const [urlA, urlB] = await Promise.all([first, second]);

    expect(urlA).toBe("blob:test/1");
    expect(urlB).toBe("blob:test/1");
    expect(stubs.fetchCalls).toBe(1);
    expect(stubs.bitmapCalls).toBe(1);
    expect(stubs.lastFetchUrl).toBe(resourceBlobPath("res_dedupe"));
    expect(peekImagePreview("res_dedupe", 400)).toBe("blob:test/1");

    expect(await loadImagePreview("res_dedupe", 400)).toBe("blob:test/1");
    expect(stubs.fetchCalls).toBe(1);
  });

  test("encodes each width bucket separately", async () => {
    const stubs = installStubs();
    await loadImagePreview("res_buckets", 96);
    await loadImagePreview("res_buckets", 400);

    expect(stubs.bitmapCalls).toBe(2);
    expect(stubs.createObjectUrlCalls).toBe(2);
    expect(peekImagePreview("res_buckets", 96)).toBe("blob:test/1");
    expect(peekImagePreview("res_buckets", 400)).toBe("blob:test/2");
  });

  test("keeps animation and vector sources untouched", async () => {
    const stubs = installStubs({ mimeType: "image/gif" });
    const url = await loadImagePreview("res_gif", 400);

    expect(url).toBe("blob:test/1");
    expect(stubs.bitmapCalls).toBe(0);
  });

  test("returns null when the resource cannot be read", async () => {
    const stubs = installStubs({ failFetch: true });
    const url = await loadImagePreview("res_missing", 400);

    expect(url).toBeNull();
    expect(stubs.bitmapCalls).toBe(0);
    expect(peekImagePreview("res_missing", 400)).toBeNull();
  });

  test("caches nothing for blank resource ids", async () => {
    const before = imagePreviewCacheSize();
    const stubs = installStubs();

    expect(await loadImagePreview("   ", 400)).toBeNull();
    expect(stubs.fetchCalls).toBe(0);
    expect(imagePreviewCacheSize()).toBe(before);
  });
});
