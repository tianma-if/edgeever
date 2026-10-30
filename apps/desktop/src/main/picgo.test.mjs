import { afterEach, expect, test } from "bun:test";
import { createPicGoUploadQueue, isBlockedPicGoAddress, normalizePicGoEndpoint, normalizePicGoServerKey, testPicGoConnection, uploadPicGoImage } from "./picgo.mjs";

const servers = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const serve = (handler) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/upload`;
};
const image = (endpoint) => ({ endpoint, filename: "截图.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) });

test("connection check uses heartbeat and never uploads or reads the clipboard", async () => {
  const requests = [];
  const endpoint = serve(async (request) => {
    requests.push([new URL(request.url).pathname, request.method, await request.text()]);
    return Response.json({ success: true, result: "alive" });
  });
  expect(await testPicGoConnection(endpoint)).toBe(true);
  expect(requests).toEqual([["/heartbeat", "POST", ""]]);
});

test("sends captured image bytes using PicGo multipart protocol and preserves returned URL", async () => {
  const endpoint = serve(async (request) => {
    expect(new URL(request.url).pathname).toBe("/upload");
    const form = await request.formData();
    const file = form.get("files");
    expect(file.name).toBe("截图.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(image("").bytes);
    return Response.json({ success: true, result: ["https://images.example.com/picture.png?q=a%20b"] });
  });
  expect(await uploadPicGoImage(image(endpoint))).toEqual({ url: "https://images.example.com/picture.png?q=a%20b" });
});

test("rejects wrong services, failed uploads and unsafe or ambiguous URLs", async () => {
  const wrong = serve(() => Response.json({ ok: true }));
  await expect(testPicGoConnection(wrong)).rejects.toThrow();
  for (const response of [
    { success: false, result: [] },
    { success: true, result: ["javascript:alert(1)"] },
    { success: true, result: ["https://user:secret@example.com/image.png"] },
    { success: true, result: [null] },
    { success: true, result: ["https://example.com/a", "https://example.com/b"] },
  ]) {
    await expect(uploadPicGoImage(image(serve(() => Response.json(response))))).rejects.toThrow();
  }
});

test("accepts a remote PicList address and keeps its server key on heartbeat and upload", async () => {
  expect(normalizePicGoEndpoint("https://piclist.example.com/upload").origin).toBe("https://piclist.example.com");
  expect(normalizePicGoEndpoint("http://192.168.1.20:36677/upload").hostname).toBe("192.168.1.20");
  expect(normalizePicGoEndpoint("http://[::1]:36677/upload").hostname).toBe("[::1]");
  expect(normalizePicGoServerKey("  nas-key  ")).toBe("nas-key");
  const requests = [];
  const endpoint = serve(async (request) => {
    const url = new URL(request.url);
    requests.push([url.pathname, url.searchParams.get("key"), request.method]);
    if (url.pathname === "/heartbeat") return Response.json({ success: true, result: "alive" });
    return Response.json({ success: true, result: ["https://images.example.com/picture.png"] });
  });
  expect(await testPicGoConnection(endpoint, { serverKey: "nas-key" })).toBe(true);
  expect(await uploadPicGoImage({ ...image(endpoint), serverKey: "nas-key" })).toEqual({ url: "https://images.example.com/picture.png" });
  expect(requests).toEqual([["/heartbeat", "nas-key", "POST"], ["/upload", "nas-key", "POST"]]);
});

test("accepts a reverse-proxied address ending in /upload and keeps the prefix for heartbeat", async () => {
  expect(normalizePicGoEndpoint("https://nas.example.com/piclist/upload").pathname).toBe("/piclist/upload");
  const seen = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    seen.push(parsed.pathname);
    return parsed.pathname.endsWith("/heartbeat")
      ? Response.json({ success: true, result: "alive" })
      : Response.json({ success: true, result: ["https://images.example.com/picture.png"] });
  };
  const lookupImpl = async () => [{ address: "203.0.113.10", family: 4 }];
  await testPicGoConnection("https://nas.example.com/piclist/upload", { fetchImpl, lookupImpl });
  await uploadPicGoImage(image("https://nas.example.com/piclist/upload"), { fetchImpl, lookupImpl });
  expect(seen).toEqual(["/piclist/heartbeat", "/piclist/upload"]);
});

test("resolves a remote name before connecting and refuses link-local targets", async () => {
  const seen = [];
  await testPicGoConnection("https://piclist.example.com:8443/upload", {
    serverKey: "secret",
    lookupImpl: async () => [{ address: "203.0.113.10", family: 4 }],
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      seen.push([parsed.origin, parsed.pathname, parsed.searchParams.get("key"), init.redirect]);
      return Response.json({ success: true, result: "alive" });
    },
  });
  expect(seen).toEqual([["https://piclist.example.com:8443", "/heartbeat", "secret", "error"]]);

  let fetched = false;
  await expect(testPicGoConnection("https://piclist.example.com/upload", {
    serverKey: "secret",
    lookupImpl: async () => [{ address: "169.254.169.254", family: 4 }],
    fetchImpl: () => { fetched = true; throw new Error("must not fetch"); },
  })).rejects.toThrow();
  expect(fetched).toBe(false);
  await expect(uploadPicGoImage({ ...image("http://169.254.169.254/upload"), serverKey: "secret" })).rejects.toThrow();
});

test("rejects unsafe addresses and does not echo the server key", async () => {
  for (const endpoint of [
    "file:///upload",
    "http://169.254.169.254/upload",
    "http://[::ffff:169.254.169.254]/upload",
    "http://0.0.0.0/upload",
    "http://[fe80::1]/upload",
    "http://127.0.0.1/other",
    "http://127.0.0.1/upload/other",
    "http://127.0.0.1/uploads",
    "http://127.0.0.1/my-upload",
    "http://user:pass@localhost/upload",
    "http://localhost/upload?secret=foo",
    "http://localhost/upload?key=hidden",
    "http://localhost/upload#foo",
    "http://2852039166/upload",
    "http://0xa9fea9fe/upload",
    "http://[::ffff:a9fe:a9fe]/upload",
    "https://metadata.google.internal/upload",
  ]) {
    expect(() => normalizePicGoEndpoint(endpoint)).toThrow();
  }
  expect(normalizePicGoEndpoint("http://2130706433/upload").hostname).toBe("127.0.0.1");
  expect(normalizePicGoEndpoint("http://127.0.0.01/upload").hostname).toBe("127.0.0.1");
  expect(normalizePicGoEndpoint("http://[::ffff:c0a8:114]/upload").hostname).toBe("[::ffff:c0a8:114]");
  expect(isBlockedPicGoAddress("192.168.1.20")).toBe(false);
  expect(isBlockedPicGoAddress("10.1.2.3")).toBe(false);
  expect(isBlockedPicGoAddress("::ffff:c0a8:114")).toBe(false);
  expect(() => normalizePicGoServerKey("bad key")).toThrow();
  expect(() => normalizePicGoServerKey("x".repeat(513))).toThrow();
  let failure = "";
  try {
    await testPicGoConnection("http://127.0.0.1:9/upload", {
      serverKey: "nas-key",
      fetchImpl: async (url) => { throw new Error(`connect ECONNREFUSED ${url}`); },
    });
  } catch (error) {
    failure = String(error);
  }
  expect(failure).toContain("could not be reached");
  expect(failure.includes("nas-key")).toBe(false);
});

test("only accepts image bytes", async () => {
  const endpoint = serve(() => { throw new Error("Should not send non-images"); });
  await expect(uploadPicGoImage({ ...image(endpoint), mimeType: "application/pdf" })).rejects.toThrow();
  await expect(uploadPicGoImage({ ...image(endpoint), bytes: new Uint8Array() })).rejects.toThrow();
});

test("does not follow redirects or wait indefinitely", async () => {
  let reached = false;
  const target = serve(() => { reached = true; return Response.json({ success: true, result: ["https://example.com/a"] }); });
  await expect(uploadPicGoImage(image(serve(() => Response.redirect(target))))).rejects.toThrow();
  expect(reached).toBe(false);
  const slow = serve(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); return Response.json({ success: true, result: "alive" }); });
  await expect(testPicGoConnection(slow, { timeoutMs: 10 })).rejects.toThrow();
});

test("retries only on explicit choice, serializes batches and recovers after cancellation", async () => {
  const calls = [];
  const choices = [0, 1, 2];
  const upload = createPicGoUploadQueue({
    isActive: () => true,
    upload: async (input) => {
      calls.push(input);
      await Promise.resolve();
      if (input !== "success") throw new Error("Unavailable");
      return { url: "https://example.com/image.png" };
    },
    chooseFailure: async () => choices.shift(),
  });
  const first = upload("fallback");
  const second = upload("cancel");
  const third = upload("success");
  expect(await first).toEqual({ fallback: true });
  await expect(second).rejects.toThrow("cancelled");
  expect(await third).toEqual({ url: "https://example.com/image.png" });
  expect(calls).toEqual(["fallback", "fallback", "cancel", "success"]);
});

test("closed editor stops queued work before uploading or prompting", async () => {
  const upload = createPicGoUploadQueue({
    isActive: () => false,
    upload: () => { throw new Error("Must not upload"); },
    chooseFailure: () => { throw new Error("Must not prompt"); },
  });
  await expect(upload(image(""))).rejects.toThrow("editor closed");
});
