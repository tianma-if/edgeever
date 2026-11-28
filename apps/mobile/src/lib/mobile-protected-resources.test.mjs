import { describe, expect, test } from "bun:test";
import {
  createOnceProtectedResourceFailureNotifier,
  isProtectedResourceSource,
  loadProtectedResourceDataUrl,
  normalizeProtectedResourcePath,
  toProtectedResourceLoadFailure,
  toProtectedResourceLoadPath,
} from "./mobile-protected-resources.ts";

describe("normalizeProtectedResourcePath", () => {
  test("adds /blob when missing", () => {
    expect(normalizeProtectedResourcePath("/api/v1/resources/res_1")).toBe(
      "/api/v1/resources/res_1/blob"
    );
  });

  test("keeps existing /blob and strips query", () => {
    expect(normalizeProtectedResourcePath("/api/v1/resources/res_1/blob?x=1")).toBe(
      "/api/v1/resources/res_1/blob"
    );
  });

  test("strips instance base URL", () => {
    expect(
      normalizeProtectedResourcePath(
        "https://demo.example.com/api/v1/resources/res_9",
        "https://demo.example.com"
      )
    ).toBe("/api/v1/resources/res_9/blob");
  });

  test("leaves external URLs alone", () => {
    expect(normalizeProtectedResourcePath("https://cdn.example.com/cat.png")).toBe(
      "https://cdn.example.com/cat.png"
    );
  });
});

describe("toProtectedResourceLoadPath", () => {
  test("returns null for non-resource sources", () => {
    expect(toProtectedResourceLoadPath("https://mmbiz.qpic.cn/x.jpg")).toBeNull();
    expect(toProtectedResourceLoadPath("data:image/png;base64,aa")).toBeNull();
  });

  test("normalizes protected sources", () => {
    expect(
      toProtectedResourceLoadPath(
        "https://app.example/api/v1/resources/res_a",
        "https://app.example"
      )
    ).toBe("/api/v1/resources/res_a/blob");
  });
});

describe("isProtectedResourceSource", () => {
  test("matches relative and absolute resource URLs", () => {
    expect(isProtectedResourceSource("/api/v1/resources/res_1/blob")).toBe(true);
    expect(
      isProtectedResourceSource("https://x.test/api/v1/resources/res_1/blob", {
        baseUrl: "https://x.test",
      })
    ).toBe(true);
    expect(isProtectedResourceSource("https://other.test/img.png", { baseUrl: "https://x.test" })).toBe(
      false
    );
  });
});

const withFakeFileReader = async (run) => {
  const OriginalFileReader = globalThis.FileReader;
  class FakeFileReader {
    result = null;
    onerror = null;
    onloadend = null;
    readAsDataURL(blob) {
      void blob;
      this.result = "data:image/png;base64,AQID";
      queueMicrotask(() => this.onloadend?.());
    }
  }
  globalThis.FileReader = FakeFileReader;
  try {
    return await run();
  } finally {
    globalThis.FileReader = OriginalFileReader;
  }
};

describe("loadProtectedResourceDataUrl", () => {
  test("fetches the blob path and returns a data URL", async () => {
    await withFakeFileReader(async () => {
      const calls = [];
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
      const dataUrl = await loadProtectedResourceDataUrl("/api/v1/resources/res_z", {
        getResourceBlob: async (path) => {
          calls.push(path);
          return blob;
        },
      });
      expect(calls).toEqual(["/api/v1/resources/res_z/blob"]);
      expect(dataUrl?.startsWith("data:")).toBe(true);
    });
  });

  test("reports failures and returns null without throwing", async () => {
    const failures = [];
    const dataUrl = await loadProtectedResourceDataUrl("/api/v1/resources/res_z/blob", {
      getResourceBlob: async () => {
        const error = new Error("Resource download failed");
        error.status = 401;
        throw error;
      },
      onFailure: (failure) => failures.push(failure),
    });
    expect(dataUrl).toBeNull();
    expect(failures).toEqual([
      {
        message: "Resource download failed",
        path: "/api/v1/resources/res_z/blob",
        status: 401,
      },
    ]);
  });

  test("reuses cache entries and drops failed ones", async () => {
    await withFakeFileReader(async () => {
      let hits = 0;
      const cache = new Map();
      const blob = new Blob([new Uint8Array([9])], { type: "image/png" });
      const options = {
        cache,
        getResourceBlob: async () => {
          hits += 1;
          return blob;
        },
        token: "tok",
      };
      const first = loadProtectedResourceDataUrl("/api/v1/resources/res_c/blob", options);
      const second = loadProtectedResourceDataUrl("/api/v1/resources/res_c/blob", options);
      expect(await first).toBe(await second);
      expect(hits).toBe(1);
    });

    const failCache = new Map();
    await loadProtectedResourceDataUrl("/api/v1/resources/res_bad/blob", {
      cache: failCache,
      getResourceBlob: async () => {
        throw new Error("gone");
      },
    });
    expect(failCache.size).toBe(0);
  });
});

describe("failure helpers", () => {
  test("extracts status from Api-like errors", () => {
    expect(
      toProtectedResourceLoadFailure("/api/v1/resources/x/blob", Object.assign(new Error("nope"), { status: 404 }))
    ).toEqual({
      message: "nope",
      path: "/api/v1/resources/x/blob",
      status: 404,
    });
  });

  test("notifies only once", () => {
    const seen = [];
    const notify = createOnceProtectedResourceFailureNotifier((f) => seen.push(f.path));
    notify({ message: "a", path: "/a" });
    notify({ message: "b", path: "/b" });
    expect(seen).toEqual(["/a"]);
  });
});
