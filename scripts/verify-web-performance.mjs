import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const distDirectory = join(process.cwd(), "apps", "web", "dist");
const indexHtml = readFileSync(join(distDirectory, "index.html"), "utf8");
const serviceWorker = readFileSync(join(distDirectory, "sw.js"), "utf8");
assert.match(serviceWorker, /edgeever-resource-blobs/, "PWA must provide a runtime cache for resource bytes");
assert.match(serviceWorker, /CacheFirst/, "PWA resource bytes must use a cache-first runtime strategy");
const precacheStart = serviceWorker.indexOf("precacheAndRoute(");
const precacheEnd = serviceWorker.indexOf(");", precacheStart);
assert.ok(precacheStart >= 0 && precacheEnd > precacheStart, "Web service worker must contain a precache manifest");

const precacheManifest = serviceWorker.slice(precacheStart, precacheEnd);
const optionalDiagramPattern = /(?:vendor-(?:beautiful-mermaid|mermaid)|mermaid\.core|[^"']*Diagram-)[^"']*\.js/;
assert.doesNotMatch(precacheManifest, optionalDiagramPattern, "Optional diagram chunks must remain out of the initial PWA precache");

const entryCount = (precacheManifest.match(/\{url:/g) ?? []).length;
assert.ok(entryCount > 0, "Web service worker precache manifest must not be empty");
const modulePreloads = indexHtml.match(/<link rel="modulepreload"[^>]+>/g)?.join("\n") ?? "";
const initialOptionalPattern = /vendor-code-highlight|vendor-D3|vendor-(?:beautiful-mermaid|mermaid|tiptap|prosemirror|floating)|ui-primitives|mermaid\.core|[^"']*Diagram-/;
assert.doesNotMatch(modulePreloads, initialOptionalPattern, "Optional editor and diagram chunks must remain out of the initial HTML modulepreload list");
const initialModulePreloadBytes = [...indexHtml.matchAll(/<link rel="modulepreload"[^>]+href="([^"]+)"[^>]*>/g)]
  .map((match) => statSync(join(distDirectory, match[1].replace(/^\//, ""))).size)
  .reduce((total, size) => total + size, 0);
const INITIAL_MODULE_PRELOAD_BUDGET = 700 * 1024;
assert.ok(initialModulePreloadBytes <= INITIAL_MODULE_PRELOAD_BUDGET, `Initial modulepreload budget exceeded: ${initialModulePreloadBytes} > ${INITIAL_MODULE_PRELOAD_BUDGET}`);
console.log(JSON.stringify({ ok: true, precacheEntries: entryCount, initialModulePreloadBytes, initialModulePreloadBudget: INITIAL_MODULE_PRELOAD_BUDGET, resourceBytesCache: "cache-first", optionalDiagramChunksDeferred: true, optionalInitialChunksDeferred: true }));
