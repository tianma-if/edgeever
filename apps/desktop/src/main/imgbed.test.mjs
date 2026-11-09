import { afterEach, expect, test } from "bun:test";
import { normalizeImgBedChannelName, resolveImgBedAutoRetry, normalizeImgBedEndpoint, normalizeImgBedFolder, normalizeImgBedToken, testImgBedConnection, uploadImgBedImage } from "./imgbed.mjs";

const servers = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const serve = (handler) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
};
const image = (endpoint, extra = {}) => ({
  endpoint, token: "imgbed-token", uploadFolder: "notes/2026/10", nameType: "default",
  filename: "截图.png", mimeType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]), ...extra,
});

test("posts the image with bearer token, folder and naming, and prefers publicUrl", async () => {
  const endpoint = serve(async (request) => {
    const url = new URL(request.url);
    expect(url.pathname).toBe("/upload");
    expect(url.searchParams.get("uploadFolder")).toBe("notes/2026/10");
    expect(url.searchParams.get("uploadNameType")).toBe("short");
    expect(url.searchParams.get("uploadChannel")).toBe("cfr2");
    expect(url.searchParams.get("channelName")).toBe("R2 备用");
    expect(url.searchParams.get("autoRetry")).toBe("false");
    expect(url.searchParams.get("serverCompress")).toBe("false");
    expect(request.headers.get("authorization")).toBe("Bearer imgbed-token");
    const file = (await request.formData()).get("file");
    expect(file.name).toBe("截图.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    return Response.json([{ src: "/file/abc_截图.png", publicUrl: "https://cdn.example.com/abc.png" }]);
  });
  expect(await uploadImgBedImage(image(endpoint, { nameType: "short", uploadChannel: "cfr2", channelName: " R2 备用 ", serverCompress: false }))).toEqual({ url: "https://cdn.example.com/abc.png" });
});

test("resolves src against the ImgBed site and omits an empty folder", async () => {
  const endpoint = serve((request) => {
    const params = new URL(request.url).searchParams;
    expect(params.has("uploadFolder")).toBe(false);
    // Unset options follow the ImgBed API defaults.
    expect(params.get("uploadChannel")).toBe("telegram");
    expect(params.has("channelName")).toBe(false);
    // Without a channel name the default keeps ImgBed's own retry.
    expect(params.get("autoRetry")).toBe("true");
    expect(params.get("serverCompress")).toBe("true");
    return Response.json([{ src: "/file/notes/abc.png" }]);
  });
  expect(await uploadImgBedImage(image(`${endpoint}/upload`, { uploadFolder: "" }))).toEqual({ url: `${endpoint}/file/notes/abc.png` });
});

test("connection test uploads a tiny PNG to the configured folder", async () => {
  const seen = [];
  const endpoint = serve(async (request) => {
    const file = (await request.formData()).get("file");
    const bytes = new Uint8Array(await file.arrayBuffer());
    seen.push([new URL(request.url).searchParams.get("uploadFolder"), file.name, file.type, Array.from(bytes.slice(0, 4))]);
    return Response.json([{ src: "/file/notes/edgeever-connection-test.png" }]);
  });
  expect(await testImgBedConnection({ endpoint, token: "imgbed-token", uploadFolder: "notes", nameType: "default" })).toBe(true);
  expect(seen).toEqual([["notes", "edgeever-connection-test.png", "image/png", [137, 80, 78, 71]]]);
});

test("connection test checks the channel name against /api/channels before uploading", async () => {
  const requests = [];
  let expectedName = "Backup R2";
  const endpoint = serve(async (request) => {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}`);
    if (url.pathname === "/imgbed/api/channels") {
      expect(request.headers.get("authorization")).toBe("Bearer imgbed-token");
      return Response.json({ telegram: [{ name: "Main R2" }], cfr2: [{ name: "Main R2" }, { name: "Backup R2" }] });
    }
    expect(url.searchParams.get("channelName")).toBe(expectedName);
    return Response.json([{ src: "/file/edgeever-connection-test.png" }]);
  });
  const input = { endpoint: `${endpoint}/imgbed`, token: "imgbed-token", uploadFolder: "", nameType: "default", uploadChannel: "cfr2" };
  expect(await testImgBedConnection({ ...input, channelName: " Backup R2 " })).toBe(true);
  expect(requests).toEqual(["GET /imgbed/api/channels", "POST /imgbed/upload"]);

  // An unknown name, or one under another upload channel type, fails without uploading.
  requests.length = 0;
  for (const channelName of ["backup r2", "Missing"]) {
    await expect(testImgBedConnection({ ...input, channelName })).rejects.toThrow("IMGBED_CHANNEL_NAME:");
  }
  await expect(testImgBedConnection({ ...input, uploadChannel: "s3", channelName: "Main R2" })).rejects.toThrow("IMGBED_CHANNEL_NAME:");
  expect(requests).toEqual(["GET /imgbed/api/channels", "GET /imgbed/api/channels", "GET /imgbed/api/channels"]);

  // Without a name, the channel list is not requested.
  requests.length = 0;
  expectedName = null;
  expect(await testImgBedConnection(input)).toBe(true);
  expect(requests).toEqual(["POST /imgbed/upload"]);
});

test("a named channel that fails to write is reported instead of retried elsewhere", async () => {
  let uploads = 0;
  // Mimics ImgBed: with autoRetry on, a failed write on the named channel falls
  // through to another channel and still returns that channel's link.
  const endpoint = serve((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/channels") return Response.json({ s3: [{ name: "Broken S3" }] });
    uploads += 1;
    if (url.searchParams.get("autoRetry") === "false") return new Response("Error: S3 upload failed", { status: 500 });
    return Response.json([{ src: "/file/from-telegram.png" }]);
  });
  const input = { endpoint, token: "imgbed-token", uploadFolder: "", nameType: "default", uploadChannel: "s3", channelName: "Broken S3" };
  await expect(testImgBedConnection(input)).rejects.toThrow("HTTP 500");
  await expect(uploadImgBedImage(image(endpoint, { uploadChannel: "s3", channelName: "Broken S3" }))).rejects.toThrow("HTTP 500");
  expect(uploads).toBe(2);
});

test("uploads follow the retry setting, but a named connection test never retries", async () => {
  const seen = [];
  const endpoint = serve((request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/channels") return Response.json({ s3: [{ name: "Main S3" }] });
    seen.push(`${url.searchParams.get("channelName") ?? "-"} ${url.searchParams.get("autoRetry")}`);
    return Response.json([{ src: "/file/a.png" }]);
  });
  const upload = (extra) => uploadImgBedImage(image(endpoint, { uploadChannel: "s3", ...extra }));
  await upload({ channelName: "Main S3", autoRetry: true });
  await upload({ channelName: "Main S3", autoRetry: false });
  await upload({ autoRetry: false });
  await upload({});
  const test = (extra) => testImgBedConnection({ endpoint, token: "imgbed-token", uploadFolder: "", nameType: "default", uploadChannel: "s3", ...extra });
  await test({ channelName: "Main S3", autoRetry: true });
  await test({ autoRetry: false });
  expect(seen).toEqual(["Main S3 true", "Main S3 false", "- false", "- true", "Main S3 false", "- false"]);
  await expect(upload({ autoRetry: "yes" })).rejects.toThrow("retry setting is invalid");
});

test("connection test explains old ImgBed versions and rejected tokens on the channel check", async () => {
  const input = (endpoint) => ({ endpoint, token: "imgbed-token", uploadFolder: "", nameType: "default", channelName: "Main" });
  // Older sites answer unknown routes with 404 or with their HTML app shell.
  for (const response of [() => new Response("missing", { status: 404 }), () => new Response("<!doctype html><title>ImgBed</title>", { headers: { "content-type": "text/html" } })]) {
    await expect(testImgBedConnection(input(serve(response)))).rejects.toThrow("IMGBED_CHANNEL_NAME:");
  }
  // Server errors, rate limits and oversized replies are not blamed on the channel name.
  for (const [response, expected] of [
    [() => new Response("boom", { status: 502 }), "HTTP 502"],
    [() => new Response("slow down", { status: 429 }), "HTTP 429"],
    [() => Response.json({ telegram: [{ name: "x".repeat(70000) }] }), "response is too large"],
  ]) {
    const failure = await testImgBedConnection(input(serve(response))).catch(String);
    expect(failure).toContain(expected);
    expect(failure).not.toContain("IMGBED_CHANNEL_NAME:");
  }
  let failure = "";
  try { await testImgBedConnection(input(serve(() => new Response("nope", { status: 401 })))); }
  catch (error) { failure = String(error); }
  expect(failure).toContain("rejected the API token");
  expect(failure).not.toContain("IMGBED_CHANNEL_NAME:");
});

test("reports rejected tokens and malformed responses without echoing the token", async () => {
  let failure = "";
  try { await uploadImgBedImage(image(serve(() => new Response("nope", { status: 401 })))); }
  catch (error) { failure = String(error); }
  expect(failure).toContain("rejected the API token");
  expect(failure).not.toContain("imgbed-token");
  for (const body of [{ error: "x" }, [], [{}], [{ src: "javascript:alert(1)" }], [{ src: "https://user:pw@example.com/a.png" }], [{ src: "/a" }, { src: "/b" }]]) {
    await expect(uploadImgBedImage(image(serve(() => Response.json(body))))).rejects.toThrow();
  }
});

test("normalizes the address, folder and token and rejects unsafe values", () => {
  expect(normalizeImgBedEndpoint("https://img.example.com").href).toBe("https://img.example.com/upload");
  expect(normalizeImgBedEndpoint("https://img.example.com/").href).toBe("https://img.example.com/upload");
  expect(normalizeImgBedEndpoint("https://img.example.com/upload").href).toBe("https://img.example.com/upload");
  expect(normalizeImgBedEndpoint("https://example.com/imgbed/").href).toBe("https://example.com/imgbed/upload");
  for (const endpoint of ["ftp://img.example.com", "https://u:p@img.example.com", "https://img.example.com/?a=1", "http://169.254.169.254", "not a url"]) {
    expect(() => normalizeImgBedEndpoint(endpoint)).toThrow();
  }
  expect(normalizeImgBedFolder(" /notes//2026/ ")).toBe("notes/2026");
  for (const folder of ["../etc", "a/./b", "a\\b", "a?b", "a#b", "a%2e", "{Y}", "x".repeat(201)]) {
    expect(() => normalizeImgBedFolder(folder)).toThrow();
  }
  expect(resolveImgBedAutoRetry(undefined, "")).toBe(true);
  expect(resolveImgBedAutoRetry(null, "Main")).toBe(false);
  expect(resolveImgBedAutoRetry(true, "Main")).toBe(true);
  expect(resolveImgBedAutoRetry(false, "")).toBe(false);
  expect(normalizeImgBedChannelName(undefined)).toBe("");
  expect(normalizeImgBedChannelName("   ")).toBe("");
  expect(normalizeImgBedChannelName(" Main R2 ")).toBe("Main R2");
  for (const name of [42, "a\nb", "R2\t", "\tR2", "x".repeat(101)]) expect(() => normalizeImgBedChannelName(name)).toThrow();
  expect(normalizeImgBedToken("  token ")).toBe("token");
  for (const token of ["", "two words", 42]) expect(() => normalizeImgBedToken(token)).toThrow();
});

test("only accepts image bytes and refuses link-local hosts before fetching", async () => {
  const endpoint = serve(() => { throw new Error("Should not upload"); });
  await expect(uploadImgBedImage(image(endpoint, { mimeType: "application/pdf" }))).rejects.toThrow();
  await expect(uploadImgBedImage(image(endpoint, { bytes: new Uint8Array() }))).rejects.toThrow();
  await expect(uploadImgBedImage(image(endpoint, { nameType: "random" }))).rejects.toThrow();
  await expect(uploadImgBedImage(image(endpoint, { uploadChannel: "ftp" }))).rejects.toThrow();
  await expect(uploadImgBedImage(image(endpoint, { serverCompress: "yes" }))).rejects.toThrow();
  let fetched = false;
  await expect(uploadImgBedImage(image("https://img.example.com"), {
    lookupImpl: async () => [{ address: "169.254.169.254", family: 4 }],
    fetchImpl: () => { fetched = true; throw new Error("must not fetch"); },
  })).rejects.toThrow();
  expect(fetched).toBe(false);
});
