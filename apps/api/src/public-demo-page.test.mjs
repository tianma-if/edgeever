import { expect, test } from "bun:test";
import worker from "./index.ts";
import { servePublicDemoRequest } from "./public-demo-page.ts";
import { configureDemoAssetRouting } from "../../../scripts/wrangler-runner.mjs";
import { readFileSync } from "node:fs";

const shell = () => new Response("<!doctype html><html><head><title>EdgeEver</title></head><body></body></html>", {
  headers: { "Content-Type": "text/html", ETag: '"asset"', "Content-Length": "85" },
});

test("Demo HTTP permanently redirects before assets or storage, preserving method, path and query", async () => {
  for (const path of ["/", "/assets/app.js?v=1", "/api/v1/memos?limit=10", "/share/example"]) {
    const response = await worker.fetch(new Request(`http://demo.edgeever.org${path}`, { method: "POST", body: "test" }), {}, {});
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(`https://demo.edgeever.org${path}`);
  }
});

test("Demo HTTPS shell declares one clean canonical in HTML and response headers without a redirect loop", async () => {
  for (const path of ["/", "/?utm_source=test", "/index.html"]) {
    const response = await worker.fetch(new Request(`https://demo.edgeever.org${path}`, {
      headers: { "X-Forwarded-Proto": "http" },
    }), { ASSETS: { fetch: shell } }, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe('<https://demo.edgeever.org/>; rel="canonical"');
    expect(await response.text()).toContain('<link rel="canonical" href="https://demo.edgeever.org/" />');
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Content-Length")).toBeNull();
  }
});

test("HEAD has canonical headers and no body", async () => {
  const response = await servePublicDemoRequest(new Request("https://demo.edgeever.org/", { method: "HEAD" }), async () => shell());
  expect(response.headers.get("Link")).toContain('rel="canonical"');
  expect(await response.text()).toBe("");
  expect(response.headers.get("Content-Length")).toBeNull();
});

test("cached Demo homepage responses also declare the canonical", async () => {
  const response = await servePublicDemoRequest(new Request("https://demo.edgeever.org/"), async () => new Response(null, { status: 304 }));
  expect(response.status).toBe(304);
  expect(response.headers.get("Link")).toBe('<https://demo.edgeever.org/>; rel="canonical"');
});

test("other instances, published pages and non-HTML responses retain their own indexing behavior", async () => {
  for (const url of ["http://localhost:8787/", "http://notes.example/", "https://demo.edgeever.org/share/example", "https://demo.edgeever.org/s/site/"]) {
    const original = shell();
    expect(await servePublicDemoRequest(new Request(url), async () => original)).toBe(original);
  }
  const original = Response.json({ ok: true });
  expect(await servePublicDemoRequest(new Request("https://demo.edgeever.org/"), async () => original)).toBe(original);
});

test("only generated demo configurations run the Worker before every static asset", () => {
  const config = readFileSync(new URL("../../../wrangler.toml", import.meta.url), "utf8");
  expect(configureDemoAssetRouting(config, false)).toBe(config);
  const demo = configureDemoAssetRouting(config, true);
  expect(demo).toContain("run_worker_first = true");
  expect(demo.replace("run_worker_first = true", config.match(/^run_worker_first = .+$/m)[0])).toBe(config);
});
