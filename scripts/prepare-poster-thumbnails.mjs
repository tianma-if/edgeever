// Used by Vite on startup/build and template saves. Fresh assets need no browser.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, mkdtemp, rename, rm, open, realpath } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const sources = [
  "apps/web/src/lib/poster-design", "apps/web/src/lib/poster-canvas.ts",
  "apps/web/package.json", "packages/shared/src/poster.ts",
  "packages/shared/src/poster-design-catalog.ts", "packages/shared/src/poster-fonts.ts",
  "packages/shared/src/font-catalog.ts", "packages/shared/src/font-catalog-data.ts",
  "packages/shared/src/font-loader.ts", "packages/shared/src/font-defaults.ts",
  "packages/shared/src/font-resources.ts", "packages/shared/src/font-assets-registry.ts",
  "packages/shared/src/note-image-asset-urls.ts",
  "scripts/prepare-poster-thumbnails.mjs",
  "tests/browser/poster-thumbnail-generator.html", "tests/browser/poster-thumbnail-generator.ts",
];
const digest = data => createHash("sha256").update(data).digest("hex");
const languages = ["zh", "en"];
const assetName = /^[a-z0-9-]+\.(zh|en)\.webp$/;
const readJson = file => readFile(file, "utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
const sourceFiles = async (root, relative) => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(error => {
    if (error.code === "ENOTDIR") return undefined;
    throw error;
  });
  if (!entries) return [relative];
  // Docker omits *.test.* files and they do not affect rendered previews.
  const inputs = entries.filter(entry => !entry.name.startsWith(".") && !entry.name.includes(".test."));
  return (await Promise.all(inputs.map(entry => sourceFiles(root, `${relative}/${entry.name}`)))).flat();
};
export async function sourceState(root = projectRoot) {
  const files = (await Promise.all(sources.map(relative => sourceFiles(root, relative)))).flat().sort();
  const hashes = await Promise.all(files.map(async file => [file, digest((await readFile(path.join(root, file), "utf8")).replace(/\r\n/g, "\n"))]));
  // Template/layout changes are captured in each prepared document. Changes to
  // the painter or font definitions can affect pixels even with identical JSON.
  const painter = hashes.filter(([file]) => file === "apps/web/src/lib/poster-canvas.ts" || /\/font[^/]*\.ts$|\/poster-fonts\.ts$/.test(file));
  const web = await readJson(path.join(root, "apps/web/package.json"));
  return { sourceHash: digest(JSON.stringify(hashes)), painterHash: digest(JSON.stringify([painter, web.dependencies?.fabric])) };
}
async function validAsset(output, asset) {
  if (!asset || !assetName.test(asset.file)) return false;
  return readFile(path.join(output, asset.file)).then(bytes => digest(bytes) === asset.sha256, () => false);
}
export async function thumbnailsCurrent(output, state) {
  const manifest = await readJson(path.join(output, "manifest.json"));
  if (manifest?.version !== 2 || manifest.sourceHash !== state.sourceHash || !manifest.templates?.length) return false;
  const valid = await Promise.all(manifest.templates.flatMap(template => languages.map(language => validAsset(output, template[language]))));
  return valid.every(Boolean);
}

async function launchBrowser(root) {
  const { chromium } = await import("@playwright/test");
  const executablePath = process.env.EDGE_EVER_POSTER_CHROME_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true });
  try { return await chromium.launch({ channel: "chrome", headless: true }); }
  catch { /* Standard desktop/CI Chrome may not be installed. */ }
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    if (!/executable.*doesn.t exist/i.test(String(error))) throw error;
    console.log("[poster thumbnails] Preparing the build browser");
    const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
    await promisify(execFile)(process.execPath, [cli, "install", "chromium"], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    return chromium.launch({ headless: true });
  }
}
async function cacheGeneratorFonts(root, page) {
  const directory = path.join(root, "node_modules/.cache/edgeever/poster-thumbnail-fonts");
  await mkdir(directory, { recursive: true });
  const cacheable = bytes => bytes.length > 48 && bytes.length <= 24_000_000 &&
    ([0x774f4632, 0x00010000, 0x4f54544f].includes(bytes.readUInt32BE(0)) || bytes.toString("utf8").includes("@font-face"));
  await page.route("**/*", async route => {
    const request = route.request();
    if (!request.url().startsWith("https:") || !["xhr", "font"].includes(request.resourceType())) return route.continue();
    const file = path.join(directory, `${digest(request.url())}.json`);
    const respond = (body, contentType) => route.fulfill({ status: 200, body, contentType, headers: { "access-control-allow-origin": "*" } });
    try {
      const cached = await readJson(file).catch(() => undefined);
      if (cached) {
        const body = Buffer.from(cached.base64, "base64");
        if (digest(body) === cached.sha256 && cacheable(body)) return respond(body, cached.contentType);
      }
      const response = await route.fetch({ timeout: 20_000, maxRetries: 1 });
      const body = await response.body();
      const contentType = response.headers()["content-type"] ?? "application/octet-stream";
      if (response.ok() && cacheable(body)) {
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ base64: body.toString("base64"), sha256: digest(body), contentType }));
        await rename(temporary, file);
      }
      return route.fulfill({ response, body });
    } catch {
      await route.abort().catch(() => {});
    }
  });
}

export async function openRenderer(root) {
  root = await realpath(root);
  const { build } = await import("vite");
  const bundle = await mkdtemp(path.join(tmpdir(), "edgeever-poster-renderer-"));
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  const server = createHttpServer(async (request, response) => {
    try {
      const file = path.resolve(bundle, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
      if (!file.startsWith(`${bundle}${path.sep}`)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
      response.end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  const closeServer = async () => {
    if (server.listening) await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
    await rm(bundle, { recursive: true, force: true });
  };
  let browser;
  try {
    // Compile a standalone generator, then serve plain static files. A Vite dev
    // server/optimizer can wait on unfinished module requests when closed after
    // a failed render; no live development server is needed for this job.
    await build({
      configFile: false, root, base: "/", logLevel: "error",
      resolve: { alias: { "@": path.join(root, "apps/web/src") } },
      build: { outDir: bundle, emptyOutDir: true, minify: false, rollupOptions: { input: path.join(root, "tests/browser/poster-thumbnail-generator.html") } },
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    browser = await launchBrowser(root);
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);
    await cacheGeneratorFonts(root, page);
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/browser/poster-thumbnail-generator.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.posterThumbnailGenerator, null, { timeout: 30_000 });
    const bounded = async pending => {
      let timer;
      try {
        return await Promise.race([pending, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Poster thumbnail rendering timed out")), 120_000);
        })]);
      } finally { clearTimeout(timer); }
    };
    return {
      list: () => bounded(page.evaluate(() => window.posterThumbnailGenerator.templates)),
      prepare: (id, language) => bounded(page.evaluate(({ id, language }) => window.posterThumbnailGenerator.prepare(id, language === "zh"), { id, language })),
      render: (id, language) => bounded(page.evaluate(({ id, language }) => window.posterThumbnailGenerator.render(id, language === "zh"), { id, language })),
      close: async () => { try { await browser.close(); } finally { await closeServer(); } },
    };
  } catch (error) {
    try { await browser?.close(); } finally { await closeServer(); }
    throw error;
  }
}

async function acquireLock(root) {
  const file = path.join(root, "node_modules/.cache/edgeever/poster-thumbnails.lock");
  await mkdir(path.dirname(file), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(file, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => rm(file, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(await readFile(file, "utf8").catch(() => ""));
      if (pid) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === "ESRCH") { await rm(file, { force: true }); continue; } }
      }
      if (Date.now() - started > 300_000) throw new Error("Timed out waiting for poster thumbnail generation");
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

export async function ensurePosterThumbnails({ root = projectRoot, output = path.join(root, "apps/web/src/assets/poster-template-previews"), renderer = openRenderer, log = console.log } = {}) {
  let state = await sourceState(root);
  if (await thumbnailsCurrent(output, state)) return { generated: 0, skipped: true };
  const release = await acquireLock(root);
  let runtime, temporary;
  try {
    state = await sourceState(root);
    if (await thumbnailsCurrent(output, state)) return { generated: 0, skipped: true };
    const previous = await readJson(path.join(output, "manifest.json"));
    const oldTemplates = new Map(previous?.templates?.map(template => [template.id, template]));
    log("[poster thumbnails] Checking changed templates");
    runtime = await renderer(root);
    const templates = await runtime.list();
    if (!templates.length || new Set(templates.map(template => template.id)).size !== templates.length) throw new Error("Invalid poster template catalog");
    temporary = await mkdtemp(path.join(tmpdir(), "edgeever-poster-thumbnails-"));
    let generated = 0;
    for (const template of templates) {
      if (!/^[a-z0-9-]+$/.test(template.id)) throw new Error("Invalid poster template ID");
      for (const language of languages) {
        const document = await runtime.prepare(template.id, language);
        const renderHash = digest(`${state.painterHash}\0${document}`);
        const previousAsset = oldTemplates.get(template.id)?.[language];
        if (previousAsset?.renderHash === renderHash && await validAsset(output, previousAsset)) {
          template[language] = previousAsset;
          continue;
        }
        const bytes = Buffer.from(await runtime.render(template.id, language), "base64");
        if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`Invalid WebP: ${template.id}`);
        const file = `${template.id}.${language}.webp`;
        await writeFile(path.join(temporary, file), bytes);
        template[language] = { file, sha256: digest(bytes), renderHash };
        generated++;
        log(`[poster thumbnails] Generated ${file}`);
      }
    }
    // A save during generation must not mark old code as synchronized. The dev
    // queue retries the latest source; builds fail rather than publish it.
    if ((await sourceState(root)).sourceHash !== state.sourceHash) throw new Error("Poster sources changed during generation; retrying the latest save is required");
    await mkdir(output, { recursive: true });
    for (const file of await readdir(temporary)) {
      const staged = path.join(output, `.${file}.tmp`);
      await writeFile(staged, await readFile(path.join(temporary, file)));
      await rename(staged, path.join(output, file));
    }
    const manifest = { version: 2, ...state, width: 480, height: 640, templates };
    const stagedManifest = path.join(output, ".manifest.json.tmp");
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(stagedManifest, path.join(output, "manifest.json"));
    const keep = new Set(templates.flatMap(template => languages.map(language => template[language].file)));
    for (const file of await readdir(output)) if (assetName.test(file) && !keep.has(file)) await rm(path.join(output, file));
    log(`[poster thumbnails] Updated ${generated} images; reused ${templates.length * 2 - generated}`);
    return { generated, skipped: false };
  } finally {
    try { await runtime?.close(); }
    finally {
      try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
      finally { await release(); }
    }
  }
}

// Playwright's process/transport lifecycle is supported by Node. Keep browser
// generation out of the application's Vite/Bun process, including Docker builds.
export async function runPosterThumbnailGeneration({ root = projectRoot } = {}) {
  if (await thumbnailsCurrent(path.join(root, "apps/web/src/assets/poster-template-previews"), await sourceState(root))) return { generated: 0, skipped: true };
  const { stdout, stderr } = await promisify(execFile)("node", [fileURLToPath(import.meta.url), "--json", "--root", root], {
    cwd: root, maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr) process.stderr.write(stderr);
  return JSON.parse(stdout);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootIndex = process.argv.indexOf("--root");
  const root = rootIndex < 0 ? projectRoot : path.resolve(process.argv[rootIndex + 1]);
  if (process.argv.includes("--check")) {
    if (!await thumbnailsCurrent(path.join(root, "apps/web/src/assets/poster-template-previews"), await sourceState(root))) throw new Error("Poster thumbnails are stale; normal dev/build will regenerate them automatically.");
    console.log("Poster thumbnails are current");
  } else {
    const json = process.argv.includes("--json");
    const result = process.versions.bun
      ? await runPosterThumbnailGeneration({ root })
      : await ensurePosterThumbnails({ root, log: json ? message => console.error(message) : console.log });
    if (json) console.log(JSON.stringify(result));
    else if (result.skipped) console.log("[poster thumbnails] Already current; no renderer needed");
  }
}
