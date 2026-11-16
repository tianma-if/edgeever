import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sources, sourceState, ensurePosterThumbnails, thumbnailsCurrent } from "./prepare-poster-thumbnails.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "poster-thumbnail-test-"));
  roots.push(root);
  for (const source of sources) {
    const file = path.join(root, source === "apps/web/src/lib/poster-design" ? `${source}/templates.ts` : source);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source.endsWith("package.json") ? '{"dependencies":{"fabric":"1"}}' : source);
  }
  const output = path.join(root, "apps/web/src/assets/poster-template-previews");
  const catalog = [{ id: "one", recommended: true }, { id: "two", recommended: false }];
  const documents = new Map();
  const rendered = [];
  let opened = 0, failed = false;
  const options = { root, output, log() {}, renderer: async () => {
    opened++;
    return {
      list: async () => structuredClone(catalog),
      prepare: async (id, language) => JSON.stringify({ id, language, body: documents.get(id) ?? "initial" }),
      render: async (id, language) => {
        rendered.push(`${id}.${language}`);
        if (failed) throw new Error("font download failed");
        return Buffer.from(`RIFF0000WEBP${id}.${language}.${documents.get(id) ?? "initial"}`).toString("base64");
      },
      close: async () => {},
    };
  } };
  const change = async () => writeFile(path.join(root, "apps/web/src/lib/poster-design/templates.ts"), String(Date.now()) + Math.random());
  return { root, output, options, catalog, documents, rendered, change, opened: () => opened, fail: () => { failed = true; } };
}

test("fresh builds skip the browser; editing one template renders only its two languages", async () => {
  const f = await fixture();
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(4);
  f.rendered.length = 0;
  expect(await ensurePosterThumbnails(f.options)).toMatchObject({ generated: 0, skipped: true });
  const testFile = path.join(f.root, "apps/web/src/lib/poster-design/templates.test.mjs");
  await writeFile(testFile, "test-only input");
  expect((await ensurePosterThumbnails(f.options)).skipped).toBe(true);
  await rm(testFile);
  expect((await ensurePosterThumbnails(f.options)).skipped).toBe(true);
  expect(f.opened()).toBe(1);
  const before = await readFile(path.join(f.output, "two.zh.webp"));
  f.documents.set("one", "new layout");
  await f.change();
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(2);
  expect(f.rendered).toEqual(["one.zh", "one.en"]);
  expect(await readFile(path.join(f.output, "two.zh.webp"))).toEqual(before);
});

test("new templates get images and removed templates lose orphaned thumbnails", async () => {
  const f = await fixture();
  await ensurePosterThumbnails(f.options);
  f.rendered.length = 0;
  f.catalog.push({ id: "three", recommended: true });
  await f.change();
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(2);
  expect(f.rendered).toEqual(["three.zh", "three.en"]);
  f.catalog.splice(0, 1);
  await f.change();
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(0);
  expect(await readdir(f.output)).not.toContain("one.zh.webp");
});

test("missing or corrupt images repair only themselves; painter changes refresh all", async () => {
  const f = await fixture();
  await ensurePosterThumbnails(f.options);
  await rm(path.join(f.output, "one.en.webp"));
  await writeFile(path.join(f.output, "two.zh.webp"), "corrupt");
  f.rendered.length = 0;
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(2);
  expect(f.rendered).toEqual(["one.en", "two.zh"]);
  await writeFile(path.join(f.root, "apps/web/src/lib/poster-canvas.ts"), "new painter");
  expect((await ensurePosterThumbnails(f.options)).generated).toBe(4);
});

test("failed generation preserves previous assets and manifest, and releases the lock", async () => {
  const f = await fixture();
  await ensurePosterThumbnails(f.options);
  const before = await readFile(path.join(f.output, "manifest.json"));
  const image = await readFile(path.join(f.output, "one.zh.webp"));
  f.documents.set("one", "changed");
  f.fail();
  await f.change();
  await expect(ensurePosterThumbnails(f.options)).rejects.toThrow("font download failed");
  expect(await readFile(path.join(f.output, "manifest.json"))).toEqual(before);
  expect(await readFile(path.join(f.output, "one.zh.webp"))).toEqual(image);
  expect(await readdir(path.join(f.root, "node_modules/.cache/edgeever"))).toEqual([]);
});

test("simultaneous dev/build requests serialize and render once", async () => {
  const f = await fixture();
  const results = await Promise.all([ensurePosterThumbnails(f.options), ensurePosterThumbnails(f.options)]);
  expect(results.map(result => result.generated).sort()).toEqual([0, 4]);
  expect(f.opened()).toBe(1);
});

test("Windows CRLF checkouts remain current without regeneration", async () => {
  const f = await fixture();
  const file = path.join(f.root, "apps/web/src/lib/poster-design/templates.ts");
  await writeFile(file, "line one\nline two\n");
  await ensurePosterThumbnails(f.options);
  await writeFile(file, "line one\r\nline two\r\n");
  expect(await thumbnailsCurrent(f.output, await sourceState(f.root))).toBe(true);
  expect((await ensurePosterThumbnails(f.options)).skipped).toBe(true);
});

test("a save during generation cannot publish a manifest for stale sources", async () => {
  const f = await fixture();
  await ensurePosterThumbnails(f.options);
  const before = await readFile(path.join(f.output, "manifest.json"));
  await f.change();
  const original = f.options.renderer;
  f.options.renderer = async () => {
    const runtime = await original();
    const prepare = runtime.prepare;
    runtime.prepare = async (...args) => { await f.change(); return prepare(...args); };
    return runtime;
  };
  await expect(ensurePosterThumbnails(f.options)).rejects.toThrow("sources changed during generation");
  expect(await readFile(path.join(f.output, "manifest.json"))).toEqual(before);
});
