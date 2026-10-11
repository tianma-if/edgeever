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
assert.match(serviceWorker, /edgeever-optional-pdf/, "PWA must cache the optional PDF runtime after first use");
assert.match(serviceWorker, /edgeever-optional-locales/, "PWA must cache the Japanese catalog after first use");
assert.match(serviceWorker, /NetworkFirst/, "PWA navigation must prefer the current deployment over cached HTML");
assert.doesNotMatch(serviceWorker, /PrecacheFallbackPlugin/, "PWA navigation must not fall back to an install-time HTML shell");
assert.doesNotMatch(serviceWorker, /NavigationRoute/, "PWA navigation must not always serve a cached HTML shell");
assert.match(staticHeaders, /\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/, "Service worker updates must not use stale browser cache");
assert.match(staticHeaders, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/, "Fingerprinted assets must use immutable browser caching");
const precacheStart = serviceWorker.indexOf("precacheAndRoute(");
assert.ok(precacheStart >= 0, "Web service worker must still register a precache route so outdated caches can be cleaned up");
const precacheCall = serviceWorker.slice(precacheStart, serviceWorker.indexOf(");", precacheStart) + 2);
const precacheURLs = [...precacheCall.matchAll(/\{url:"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(
  precacheURLs,
  ["manifest.webmanifest"],
  `Install-time PWA precache may only keep the web manifest, found: ${precacheURLs.join(", ")}`,
);
assert.doesNotMatch(serviceWorker, /edgeever-offline-shell/, "PWA must not retain a versioned offline HTML shell");
const modulePreloads = indexHtml.match(/<link rel="modulepreload"[^>]+>/g)?.join("\n") ?? "";
const initialOptionalPattern = /vendor-code-highlight|vendor-D3|beautiful-mermaid|vendor-(?:mermaid|tiptap|prosemirror|floating|codemirror|x6|infographic|streamdown)|vendor~(?:wasm|emacs-lisp)-|ui-primitives|mermaid\.core|[^"']*Diagram(?:EditorPane)?-/;
assert.doesNotMatch(modulePreloads, initialOptionalPattern, "Optional editor and diagram chunks must remain out of the initial HTML modulepreload list");
assert.doesNotMatch(modulePreloads, /mathlive-loader|i18n-ja-/, "MathLive and the Japanese catalog must remain deferred");
assert.doesNotMatch(modulePreloads, /ui-button-tooltip/, "Button tooltips must load only when a titled button is rendered");
assert.doesNotMatch(modulePreloads, /vendor-radix(?!-slot)/, "Radix overlays must remain out of the initial HTML modulepreload list");
const initialModulePreloadBytes = [...indexHtml.matchAll(/<link rel="modulepreload"[^>]+href="([^"]+)"[^>]*>/g)]
  .map((match) => statSync(join(distDirectory, match[1].replace(/^\//, ""))).size)
  .reduce((total, size) => total + size, 0);
// The current Web entry preloads ~765 KiB; retain a bounded budget with a
// small growth allowance. Desktop builds do not emit modulepreload links.
const INITIAL_MODULE_PRELOAD_BUDGET = 775 * 1024;
assert.ok(initialModulePreloadBytes <= INITIAL_MODULE_PRELOAD_BUDGET, `Initial modulepreload budget exceeded: ${initialModulePreloadBytes} > ${INITIAL_MODULE_PRELOAD_BUDGET}`);

const DEFAULT_CHUNK_WARNING_BYTES = 500 * 1024;
// Shiki, loaded with the infographic conversation, keeps the Oniguruma wasm
// engine and the Emacs Lisp grammar above 500 KiB. AntV Infographic stays one
// atomic deferred chunk so its registries initialize in order. Streamdown
// keeps the unified/micromark parser graph atomic for the same reason; it
// loads with the note editor. All of these stay off the initial modulepreload list.
const allowedLargeChunkPattern = /^(?:vendor-(?:code-highlight|beautiful-mermaid|mermaid-(?:layout|render)|codemirror|x6|infographic|streamdown)|vendor~(?:wasm|emacs-lisp)-|.*Diagram-).*\.js$/;
// MathLive is loaded only when opening the formula dialog; Japanese is an
// optional locale catalog. Give these atomic chunks explicit size ceilings
// while retaining the initial preload budget and the checks below.
const boundedDeferredChunks = [
  { pattern: /^vendor~mathlive-loader-.*\.js$/, maxBytes: 850 * 1024 },
  // Poster editing adds localized controls; the current catalog is ~527 KiB.
  { pattern: /^i18n-ja-.*\.js$/, maxBytes: 530 * 1024 },
];
const allowedLargeChunk = ({ name, size }) =>
  allowedLargeChunkPattern.test(name) ||
  boundedDeferredChunks.some(({ pattern, maxBytes }) => pattern.test(name) && size <= maxBytes);
const largeChunks = readdirSync(join(distDirectory, "assets"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => ({ name, size: statSync(join(distDirectory, "assets", name)).size }))
  .filter(({ size }) => size > DEFAULT_CHUNK_WARNING_BYTES);
assert.ok(
  largeChunks.every(allowedLargeChunk),
  `Unexpected JavaScript chunks exceed 500 KiB: ${largeChunks
    .filter((chunk) => !allowedLargeChunk(chunk))
    .map(({ name, size }) => `${name} (${size})`)
    .join(", ")}`,
);
assert.ok(
  largeChunks.every(({ name }) => !modulePreloads.includes(name)),
  "Large optional chunks must not be module-preloaded by the app entry",
);

console.log(JSON.stringify({
  ok: true,
  precacheEntries: precacheURLs.length,
  initialModulePreloadBytes,
  initialModulePreloadBudget: INITIAL_MODULE_PRELOAD_BUDGET,
  largeDeferredChunks: largeChunks,
  resourceBytesCache: "cache-first",
  optionalDiagramChunksDeferred: true,
  optionalInitialChunksDeferred: true,
}));
