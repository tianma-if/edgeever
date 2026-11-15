import { describe, expect, test } from "bun:test";
import { createConfiguredPublishImageUploader, createPublishImageUploader, publicPublishImageUrl } from "./publish-image-host.ts";
import { api } from "./api.ts";
import { writePicGoPreference } from "./picgo.ts";
import { readFileSync } from "node:fs";

describe("publication image hosting", () => {
  test("uploads animated containers with their original bytes, MIME types and file extensions", async () => {
    for (const [extension, mime] of [["gif", "image/gif"], ["webp", "image/webp"], ["png", "image/png"], ["avif", "image/avif"]]) {
      const bytes = new Uint8Array(readFileSync(`tests/fixtures/publish-animation/two-frames.${extension}`));
      const upload = createPublishImageUploader({ external: true, baseUrl: "https://notes.example.com", isCurrent: () => true,
        upload: async (file) => {
          expect(file.name).toEndWith(`.${extension}`);
          expect(file.type).toBe(mime);
          expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
          return { url: `https://cdn.example.com/animation.${extension}` };
        },
      });
      expect(await upload(new Blob([bytes], { type: mime }))).toBe(`https://cdn.example.com/animation.${extension}`);
    }
  });
  test("built-in upload returns an anonymous absolute URL and deduplicates identical diagrams", async () => {
    const files = [];
    const upload = createPublishImageUploader({ external: false, baseUrl: "https://notes.example.com", isCurrent: () => true,
      upload: async (file) => { files.push(file); return { url: "/api/public/publish-images/token" }; },
    });
    const image = new Blob(["diagram"], { type: "image/jpeg" });
    const [a, b] = await Promise.all([upload(image), upload(image)]);
    expect(a).toBe("https://notes.example.com/api/public/publish-images/token");
    expect(b).toBe(a);
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe("image/jpeg");
    expect(await files[0].text()).toBe("diagram");
  });
  test("external hosts work from a local instance and retain the returned public address", async () => {
    const upload = createPublishImageUploader({ external: true, baseUrl: "http://127.0.0.1:5173", isCurrent: () => true,
      upload: async () => ({ url: "https://cdn.example.com/diagram.png" }),
    });
    expect(await upload(new Blob(["diagram"], { type: "image/png" }))).toBe("https://cdn.example.com/diagram.png");
  });
  test("unreachable built-in origins fail before uploading instead of copying broken images", async () => {
    for (const baseUrl of ["http://127.0.0.1:5173", "http://localhost", "http://192.168.1.10", "https://notes.local"]) {
      let called = false;
      const upload = createPublishImageUploader({ external: false, baseUrl, isCurrent: () => true,
        upload: async () => { called = true; return { url: "/image" }; },
      });
      await expect(upload(new Blob(["diagram"], { type: "image/png" }))).rejects.toMatchObject({ reason: "address" });
      expect(called).toBe(false);
    }
  });
  test("external host failures and cancellation never silently switch hosts", async () => {
    for (const response of [null, { url: "http://localhost/image.png" }, { url: "data:image/png;base64,broken" }]) {
      const upload = createPublishImageUploader({ external: true, baseUrl: "https://notes.example.com", isCurrent: () => true, upload: async () => response });
      await expect(upload(new Blob(["diagram"], { type: "image/png" }))).rejects.toBeInstanceOf(Error);
    }
    let active = true;
    const upload = createPublishImageUploader({ external: true, baseUrl: "https://notes.example.com", isCurrent: () => active,
      upload: async () => { active = false; return { url: "https://cdn.example.com/image.png" }; },
    });
    await expect(upload(new Blob(["diagram"], { type: "image/png" }))).rejects.toMatchObject({ reason: "upload" });
  });
  test("rejects credential-bearing addresses and normalizes public image URLs", () => {
    expect(() => publicPublishImageUrl("https://secret@cdn.example.com/image.png", "https://notes.example.com")).toThrow();
    expect(publicPublishImageUrl("/image.png", "https://cdn.example.com")).toBe("https://cdn.example.com/image.png");
  });

  test("configured built-in, PicGo, and browser ImgBed adapters all receive generated image bytes", async () => {
    const previousWindow = globalThis.window;
    const previousFetch = globalThis.fetch;
    const previousUpload = api.uploadPublishImage;
    const values = new Map();
    const calls = [];
    globalThis.window = { location: { origin: "https://notes.example.com" }, localStorage: {
      getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    } };
    const preference = (provider) => ({ provider, endpoint: "http://127.0.0.1:36677/upload", serverKey: "", imgbed: {
      endpoint: "https://img.example.com", token: "test-token", uploadFolder: "publish", nameType: "default",
      uploadChannel: "telegram", channelName: "", serverCompress: true, autoRetry: false,
    } });
    try {
      api.uploadPublishImage = async (file) => { calls.push(["builtin", await file.text()]); return { url: "/api/public/publish-images/token" }; };
      writePicGoPreference(preference("edgeever"));
      expect(await createConfiguredPublishImageUploader()(new Blob(["builtin-diagram"], { type: "image/jpeg" })))
        .toBe("https://notes.example.com/api/public/publish-images/token");

      globalThis.window.edgeeverDesktop = { uploadPicGoImage: async ({ bytes }) => { calls.push(["picgo", new TextDecoder().decode(bytes)]); return { url: "https://cdn.example.com/picgo.jpg" }; }, testPicGoConnection: async () => true };
      writePicGoPreference(preference("picgo"));
      expect(await createConfiguredPublishImageUploader()(new Blob(["picgo-diagram"], { type: "image/jpeg" })))
        .toBe("https://cdn.example.com/picgo.jpg");

      delete globalThis.window.edgeeverDesktop;
      globalThis.fetch = async (_url, options) => {
        expect(_url.searchParams.get("serverCompress")).toBe("false");
        const file = options.body.get("file");
        calls.push(["imgbed", await file.text()]);
        return Response.json([{ src: "/imgbed.jpg" }]);
      };
      writePicGoPreference(preference("imgbed"));
      expect(await createConfiguredPublishImageUploader()(new Blob(["imgbed-diagram"], { type: "image/jpeg" })))
        .toBe("https://img.example.com/imgbed.jpg");
      expect(calls).toEqual([["builtin", "builtin-diagram"], ["picgo", "picgo-diagram"], ["imgbed", "imgbed-diagram"]]);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
      globalThis.fetch = previousFetch;
      api.uploadPublishImage = previousUpload;
    }
  });
});
