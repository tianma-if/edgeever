import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const distDirectory = join(process.cwd(), "apps", "web", "dist");
const indexHtml = readFileSync(join(distDirectory, "index.html"), "utf8");
const serviceWorker = readFileSync(join(distDirectory, "sw.js"), "utf8");
const staticHeaders = readFileSync(join(distDirectory, "_headers"), "utf8");
assert.match(serviceWorker, /edgeever-resource-blobs/, "PWA must provide a runtime cache for resource bytes");
assert.match(serviceWorker, /CacheFirst/, "PWA resource bytes must use a cache-first runtime strategy");
assert.match(serviceWorker, /edgeever-app-shell/, "PWA navigation must use a dedicated app-shell runtime cache");
assert.match(serviceWorker, /NetworkFirst/, "PWA navigation must prefer the current deployment over cached HTML");
assert.match(serviceWorker, /PrecacheFallbackPlugin/, "PWA navigation must retain an offline app-shell fallback");
assert.doesNotMatch(serviceWorker, /NavigationRoute/, "PWA navigation must not always serve the precached HTML shell");
assert.match(staticHeaders, /\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/, "Service worker updates must not use stale browser cache");
assert.match(staticHeaders, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/, "Fingerprinted assets must use immutable browser caching");
const precacheStart = serviceWorker.indexOf("precacheAndRoute(");
const precacheEnd = serviceWorker.indexOf("cleanupOutdatedCaches", precacheStart);
assert.ok(precacheStart >= 0 && precacheEnd > precacheStart, "Web service worker must contain a precache manifest");

const precacheManifest = serviceWorker.slice(precacheStart, precacheEnd);
assert.doesNotMatch(precacheManifest, /\{url:"index\.html",/, "Current HTML must not be served by a cache-first precache route");
assert.match(precacheManifest, /index\.html\?edgeever-offline-shell=/, "PWA must retain a versioned offline HTML shell");
const optionalDiagramPattern = /(?:beautiful-mermaid|vendor-mermaid|mermaid\.core|vendor-codemirror|[^"']*Diagram-)[^"']*\.js/;
assert.doesNotMatch(precacheManifest, optionalDiagramPattern, "Optional diagram chunks must remain out of the initial PWA precache");
assert.doesNotMatch(precacheManifest, /noto-sans-sc-[^"']*\.woff2/, "Print-only Noto Sans SC shards must remain out of the PWA precache");

const precacheURLs = [...precacheManifest.matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]);
const entryCount = precacheURLs.length;
assert.ok(entryCount > 0, "Web service worker precache manifest must not be empty");
const precacheBytes = precacheURLs
  .filter((url) => !url.startsWith("/") && !url.includes("?"))
  .map((url) => statSync(join(distDirectory, url)).size)
  .reduce((total, size) => total + size, 0);
const PRECACHE_BUDGET = 5 * 1024 * 1024;
assert.ok(precacheBytes <= PRECACHE_BUDGET, `PWA precache budget exceeded: ${precacheBytes} > ${PRECACHE_BUDGET}`);
const modulePreloads = indexHtml.match(/<link rel="modulepreload"[^>]+>/g)?.join("\n") ?? "";
const initialOptionalPattern = /vendor-code-highlight|vendor-D3|beautiful-mermaid|vendor-(?:mermaid|tiptap|prosemirror|floating|codemirror)|ui-primitives|mermaid\.core|[^"']*Diagram-/;
assert.doesNotMatch(modulePreloads, initialOptionalPattern, "Optional editor and diagram chunks must remain out of the initial HTML modulepreload list");
assert.doesNotMatch(modulePreloads, /ui-button-tooltip/, "Button tooltips must load only when a titled button is rendered");
assert.doesNotMatch(modulePreloads, /vendor-radix(?!-slot)/, "Radix overlays must remain out of the initial HTML modulepreload list");
const initialModulePreloadBytes = [...indexHtml.matchAll(/<link rel="modulepreload"[^>]+href="([^"]+)"[^>]*>/g)]
  .map((match) => statSync(join(distDirectory, match[1].replace(/^\//, ""))).size)
  .reduce((total, size) => total + size, 0);
const INITIAL_MODULE_PRELOAD_BUDGET = 700 * 1024;
assert.ok(initialModulePreloadBytes <= INITIAL_MODULE_PRELOAD_BUDGET, `Initial modulepreload budget exceeded: ${initialModulePreloadBytes} > ${INITIAL_MODULE_PRELOAD_BUDGET}`);

const DEFAULT_CHUNK_WARNING_BYTES = 500 * 1024;
const allowedLargeChunkPattern = /^(?:vendor-(?:code-highlight|beautiful-mermaid|mermaid-(?:layout|render)|codemirror)|.*Diagram-).*\.js$/;
const largeChunks = readdirSync(join(distDirectory, "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => ({ name, size: statSync(join(distDirectory, "assets", name)).size }))
  .filter(({ size }) => size > DEFAULT_CHUNK_WARNING_BYTES);
assert.ok(
  largeChunks.every(({ name }) => allowedLargeChunkPattern.test(name)),
  `Unexpected JavaScript chunks exceed 500 KiB: ${largeChunks
    .filter(({ name }) => !allowedLargeChunkPattern.test(name))
    .map(({ name, size }) => `${name} (${size})`)
    .join(", ")}`,
);
assert.ok(
  largeChunks.every(({ name }) => !modulePreloads.includes(name)),
  "Large optional chunks must not be module-preloaded by the app entry",
);
const nonPrecachedLargeChunks = largeChunks.filter(({ name }) => !name.startsWith("vendor-code-highlight-"));
assert.ok(
  nonPrecachedLargeChunks.every(({ name }) => !precacheManifest.includes(name)),
  "Large optional diagram chunks must not be included in the PWA precache",
);

console.log(JSON.stringify({
  ok: true,
  precacheEntries: entryCount,
  precacheBytes,
  precacheBudget: PRECACHE_BUDGET,
  initialModulePreloadBytes,
  initialModulePreloadBudget: INITIAL_MODULE_PRELOAD_BUDGET,
  largeDeferredChunks: largeChunks,
  resourceBytesCache: "cache-first",
  optionalDiagramChunksDeferred: true,
  optionalInitialChunksDeferred: true,
}));
