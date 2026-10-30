import { afterEach, expect, test } from "bun:test";
import { normalizeImgBedEndpoint, normalizeImgBedFolder, normalizeImgBedToken, testImgBedConnection, uploadImgBedImage } from "./imgbed.mjs";

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
    expect(url.searchParams.get("serverCompress")).toBe("false");
    expect(request.headers.get("authorization")).toBe("Bearer imgbed-token");
    const file = (await request.formData()).get("file");
    expect(file.name).toBe("截图.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    return Response.json([{ src: "/file/abc_截图.png", publicUrl: "https://cdn.example.com/abc.png" }]);
  });
  expect(await uploadImgBedImage(image(endpoint, { nameType: "short", uploadChannel: "cfr2", serverCompress: false }))).toEqual({ url: "https://cdn.example.com/abc.png" });
});

test("resolves src against the ImgBed site and omits an empty folder", async () => {
  const endpoint = serve((request) => {
    const params = new URL(request.url).searchParams;
    expect(params.has("uploadFolder")).toBe(false);
    // Unset options follow the ImgBed API defaults.
    expect(params.get("uploadChannel")).toBe("telegram");
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
