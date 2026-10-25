import { afterEach, expect, test } from "bun:test";
import { PICGO_STORAGE_KEY, DEFAULT_PICGO_ENDPOINT, readPicGoPreference, shouldUploadWithPicGo, takePicGoServerKey, uploadImageWithPicGo, writePicGoPreference } from "./picgo.ts";

const previousWindow = globalThis.window;
afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
const setup = (upload) => {
  const storage = new Map();
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    edgeeverDesktop: upload ? { uploadPicGoImage: upload, testPicGoConnection: async () => true } : undefined,
  };
  return storage;
};
const copy = { title: "Failed", message: "Retry?", retry: "Retry", fallback: "EdgeEver", cancel: "Cancel" };
const file = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

test("default, corrupt settings and ordinary Web runtime retain attachment uploads", async () => {
  const storage = setup();
  expect(readPicGoPreference()).toEqual({ provider: "edgeever", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });
  storage.set(PICGO_STORAGE_KEY, "corrupt");
  expect(shouldUploadWithPicGo()).toBe(false);
  writePicGoPreference({ provider: "picgo", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });
  expect(shouldUploadWithPicGo()).toBe(false);
  expect(await uploadImageWithPicGo(file(), copy)).toBeNull();
});

test("configured but disabled PicGo never sends an image", async () => {
  setup(() => { throw new Error("Should not upload"); });
  writePicGoPreference({ provider: "edgeever", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });
  expect(shouldUploadWithPicGo()).toBe(false);
  expect(await uploadImageWithPicGo(file(), copy)).toBeNull();
});

test("enabled PicGo passes actual bytes and returns an external image for either editor mode", async () => {
  setup(async (input) => {
    expect(input.endpoint).toBe(DEFAULT_PICGO_ENDPOINT);
    expect(input.serverKey).toBe("");
    expect(input.bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(input.copy).toEqual(copy);
    return { url: "https://images.example.com/image.png" };
  });
  writePicGoPreference({ provider: "picgo", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });
  expect(shouldUploadWithPicGo()).toBe(true);
  expect(await uploadImageWithPicGo(file(), copy)).toEqual({
    kind: "image", url: "https://images.example.com/image.png", filename: "image.png", mimeType: "image/png", byteSize: 4,
  });
});

test("only explicit fallback returns to attachment storage; cancellation stays a failure", async () => {
  setup(async () => ({ fallback: true }));
  writePicGoPreference({ provider: "picgo", endpoint: DEFAULT_PICGO_ENDPOINT, serverKey: "" });
  expect(await uploadImageWithPicGo(file(), copy)).toBeNull();
  window.edgeeverDesktop.uploadPicGoImage = async () => { throw new Error("Cancelled"); };
  await expect(uploadImageWithPicGo(file(), copy)).rejects.toThrow("Cancelled");
});

test("keeps an older saved address and lifts a pasted PicList key out of the address", () => {
  const storage = setup();
  storage.set(PICGO_STORAGE_KEY, JSON.stringify({ provider: "picgo", endpoint: "https://piclist.example.com/upload" }));
  expect(readPicGoPreference()).toEqual({ provider: "picgo", endpoint: "https://piclist.example.com/upload", serverKey: "" });
  expect(takePicGoServerKey("https://piclist.example.com/upload?key=nas-key")).toEqual({
    endpoint: "https://piclist.example.com/upload", serverKey: "nas-key",
  });
  expect(takePicGoServerKey("https://piclist.example.com/upload?key=nas-key&picbed=s3")).toEqual({
    endpoint: "https://piclist.example.com/upload?key=nas-key&picbed=s3",
  });
  setup(async (input) => {
    expect(input.serverKey).toBe("nas-key");
    return { url: "https://images.example.com/image.png" };
  });
  writePicGoPreference({ provider: "picgo", endpoint: "https://piclist.example.com/upload", serverKey: "nas-key" });
  return uploadImageWithPicGo(file(), copy);
});
