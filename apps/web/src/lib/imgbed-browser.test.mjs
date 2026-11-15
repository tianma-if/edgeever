import { afterEach, expect, test } from "bun:test";
import { browserImgBed } from "./imgbed-browser.ts";
import { activeExternalImageHost, canUseImgBed, canListImgBedChannels, uploadImageWithPicGo, writePicGoPreference, testImgBedConnection, listImgBedChannels } from "./picgo.ts";

const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
const preference = { endpoint: "https://img.example.com/prefix", token: "test-secret", uploadFolder: "notes/{Y}/{memoId}", nameType: "origin", uploadChannel: "s3", channelName: "Main S3", serverCompress: false, autoRetry: null };
const input = { ...preference, uploadFolder: "notes/2026", autoRetry: false };
const file = () => new File([new Uint8Array([137, 80, 78, 71])], "test.png", { type: "image/png" });
const copy = { title: "Failed", message: "Failed", retry: "Retry", fallback: "Fallback", cancel: "Cancel" };
const setup = () => {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  writePicGoPreference({ provider: "imgbed", endpoint: "", serverKey: "", imgbed: preference });
};

test("browser can test, list and upload directly, preserving the named channel and note folder", async () => {
  setup();
  expect(canUseImgBed()).toBe(true);
  expect(canListImgBedChannels()).toBe(true);
  expect(activeExternalImageHost()).toBe("imgbed");
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push(`${options.method} ${url.pathname}`);
    expect(options.credentials).toBe("omit");
    expect(options.mode).toBe("cors");
    expect(options.redirect).toBe("error");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(options.headers.Authorization).toBe("Bearer test-secret");
    expect(url.href).not.toContain("test-secret");
    if (url.pathname.endsWith("/api/channels")) return Response.json({ s3: [{ name: "Main S3" }, { name: "Main S3" }, { name: " invalid " }] });
    expect(url.searchParams.get("autoRetry")).toBe("false");
    expect(url.searchParams.get("channelName")).toBe("Main S3");
    expect(url.searchParams.get("serverCompress")).toBe("false");
    expect(options.body.get("file").type).toBe("image/png");
    if (options.body.get("file").name === "test.png") {
      expect(url.searchParams.get("uploadFolder")).toBe(`notes/${new Date().getFullYear()}/memo_web`);
      expect(new Uint8Array(await options.body.get("file").arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    } else {
      expect(options.body.get("file").name).toBe("edgeever-connection-test.png");
    }
    return Response.json([{ src: "/images/test.png" }]);
  };
  expect(await listImgBedChannels(input)).toEqual({ channels: { telegram: [], cfr2: [], s3: ["Main S3"], discord: [], huggingface: [], webdav: [] }, skipped: { telegram: 0, cfr2: 0, s3: 1, discord: 0, huggingface: 0, webdav: 0 } });
  expect(await testImgBedConnection(input)).toBe(true);
  expect(await uploadImageWithPicGo(file(), copy, { memoId: "memo_web" })).toMatchObject({ url: "https://img.example.com/images/test.png", filename: "test.png", byteSize: 4 });
  expect(requests).toEqual(["GET /prefix/api/channels", "GET /prefix/api/channels", "POST /prefix/upload", "POST /prefix/upload"]);
});

test("rejects HTTP, embedded credentials, query strings and metadata hosts before any request", async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Should not fetch"); };
  for (const endpoint of ["http://img.example.com", "https://user:secret@img.example.com", "https://img.example.com?token=secret", "https://img.example.com/#fragment", "https://169.254.169.254", "https://metadata.google.internal"]) {
    for (const action of [browserImgBed.listImgBedChannels, browserImgBed.testImgBedConnection]) {
      await expect(Promise.resolve().then(() => action({ ...input, endpoint }))).rejects.toThrow();
    }
  }
  expect(requests).toBe(0);
});

test("bad or missing named channels prevent test writes; rejected tokens keep their marker", async () => {
  let writes = 0;
  globalThis.fetch = async (url) => {
    if (url.pathname.endsWith("/upload")) writes++;
    return Response.json({ s3: [{ name: "Different S3" }] });
  };
  await expect(browserImgBed.testImgBedConnection(input)).rejects.toThrow("IMGBED_CHANNEL_NAME:");
  expect(writes).toBe(0);
  globalThis.fetch = async () => new Response("denied", { status: 403 });
  await expect(browserImgBed.listImgBedChannels(input)).rejects.toThrow("IMGBED_TOKEN_REJECTED:");
});

test("CORS/network errors never trigger automatic retries, fallback or leak underlying errors", async () => {
  setup();
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError("secret test-secret"); };
  await expect(uploadImageWithPicGo(file(), copy)).rejects.toThrow("IMGBED_BROWSER_NETWORK");
  expect(requests).toBe(1);
  expect(await uploadImageWithPicGo(file(), copy, { chooseFailure: async () => "fallback" })).toBeNull();
  expect(requests).toBe(2);
  await expect(uploadImageWithPicGo(file(), copy, { chooseFailure: async () => "cancel" })).rejects.toThrow("cancelled");
  expect(requests).toBe(3);
});

test("only explicit retry resends; navigation cancels retries and fallback", async () => {
  setup();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    if (requests === 1) throw new TypeError("network");
    return Response.json([{ publicUrl: "https://cdn.example.com/test.png" }]);
  };
  expect(await uploadImageWithPicGo(file(), copy, { chooseFailure: async () => "retry" })).toMatchObject({ url: "https://cdn.example.com/test.png" });
  expect(requests).toBe(2);
  let active = true;
  globalThis.fetch = async () => { requests++; throw new TypeError("network"); };
  await expect(uploadImageWithPicGo(file(), copy, { isActive: () => active, chooseFailure: async () => { active = false; return "retry"; } })).rejects.toThrow();
  expect(requests).toBe(3);
});

test("rejects oversized images before reading bytes or sending requests", async () => {
  setup();
  globalThis.fetch = async () => { throw new Error("Should not fetch"); };
  const tooLarge = { size: 50 * 1024 * 1024 + 1, type: "image/png", arrayBuffer: () => { throw new Error("Should not read"); } };
  await expect(uploadImageWithPicGo(tooLarge, copy)).rejects.toThrow("50 MB");
});

test("bounds responses and rejects unsafe URLs without extra requests", async () => {
  for (const body of ["x".repeat(65537), JSON.stringify([{ src: "javascript:alert(1)" }]), JSON.stringify([{ src: "https://user:pass@cdn.example.com/x" }])]) {
    globalThis.fetch = async () => new Response(body);
    await expect(browserImgBed.uploadImgBedImage({ ...input, bytes: new Uint8Array([1]), filename: "a.png", mimeType: "image/png" })).rejects.toThrow();
  }
});
