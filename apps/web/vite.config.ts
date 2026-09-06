import react from "@vitejs/plugin-react";
import { resolveDeploymentBuildMetadata } from "@edgeever/shared/deployment-metadata";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { localDevelopmentAuth } from "./local-dev-auth";
import { resolveAppVersion, resolveReleaseTimestamp } from "./build-metadata";

const readPackageVersion = () => {
  try {
    const packagePath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      version?: string;
    };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const readReleaseSummary = (packageVersion: string) => {
  const summaryPath = fileURLToPath(new URL("../../release-summary.json", import.meta.url));
  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
    version?: unknown;
    changes?: unknown;
  };
  const localizedChanges = summary.changes && typeof summary.changes === "object" && !Array.isArray(summary.changes)
    ? Object.entries(summary.changes)
    : [];
  if (
    summary.version !== packageVersion ||
    localizedChanges.length === 0 ||
    !localizedChanges.every(([locale, changes]) =>
      /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale) &&
      Array.isArray(changes) &&
      changes.length > 0 &&
      changes.every((item) => typeof item === "string" && item.trim())
    ) ||
    !localizedChanges.some(([locale]) => locale.toLowerCase() === "en-us")
  ) {
    throw new Error(`release-summary.json must contain valid localized changes and an en-US fallback for package version ${packageVersion}.`);
  }
  return summary as { version: string; changes: Record<string, string[]> };
};

const readGitCommit = () => {
  try {
    return execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const readGitDescription = () => {
  try {
    return execSync('git describe --tags --long --match "v[0-9]*.[0-9]*.[0-9]*" HEAD', { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

const readLatestReleaseCommitTimestamp = () => {
  try {
    const releaseTag = execSync('git describe --tags --abbrev=0 --match "v[0-9]*.[0-9]*.[0-9]*" HEAD', { encoding: "utf8" }).trim();
    return execSync(`git log -1 --format=%cI ${releaseTag}`, { encoding: "utf8" }).trim();
  } catch {
    // Workers Builds may check out the source without fetching tags. The
    // package version is updated in the release-preparation commit, so its
    // timestamp is the best local fallback for self-hosted builds.
    try {
      return execSync("git log -1 --format=%cI -- package.json", { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  }
};

const buildId = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 12)
  ?? process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12)
  ?? process.env.GITHUB_SHA?.slice(0, 12)
  ?? readGitCommit()
  ?? "local";
const gitDescription = readGitDescription();
const packageVersion = readPackageVersion();
const appVersion = resolveAppVersion(packageVersion, gitDescription);
const releaseSummary = readReleaseSummary(packageVersion);
const OPTIONAL_CHUNK_WARNING_LIMIT_KB = 1_700;
const TARGET_VENDOR_CHUNK_BYTES = 450 * 1024;
const releaseTimestamp = resolveReleaseTimestamp(process.env.EDGE_EVER_RELEASED_AT) || readLatestReleaseCommitTimestamp();
const deploymentMetadata = resolveDeploymentBuildMetadata(process.env);
const isDesktopBuild = process.env.EDGE_EVER_DESKTOP_BUILD === "1";
const developmentServiceWorkerReset: Plugin = {
  name: "edgeever-development-service-worker-reset",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== "/sw.js") {
        next();
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/javascript; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(`
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    await self.clients.claim();
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`);
    });
  },
};

export default defineConfig({
  root: "apps/web",
  // Packaged Electron apps load index.html via file://, so root-absolute
  // asset URLs resolve to the filesystem root and leave a blank window.
  base: isDesktopBuild ? "./" : "/",
  define: {
    __EDGEEVER_APP_VERSION__: JSON.stringify(appVersion),
    __EDGEEVER_BUILD_ID__: JSON.stringify(buildId),
    __EDGEEVER_BUILD_LABEL__: JSON.stringify(buildId === "local" ? "local" : buildId.slice(0, 7)),
    __EDGEEVER_RELEASED_AT__: JSON.stringify(releaseTimestamp),
    __EDGEEVER_RELEASE_SUMMARY__: JSON.stringify(releaseSummary),
    __EDGEEVER_DEPLOYMENT_TRIGGER__: JSON.stringify(deploymentMetadata.trigger),
    __EDGEEVER_DEPLOYMENT_METHOD__: JSON.stringify(deploymentMetadata.method),
    __EDGEEVER_DEVELOPMENT_PROFILE__: JSON.stringify(process.env.EDGE_EVER_DEVELOPMENT_PROFILE ?? ""),
    __EDGEEVER_DESKTOP_BUILD__: JSON.stringify(isDesktopBuild),
  },
  plugins: [
    localDevelopmentAuth(),
    developmentServiceWorkerReset,
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeManifestIcons: false,
      manifest: {
        name: "EdgeEver",
        short_name: "EdgeEver",
        description: "EdgeEver：基于 Cloudflare 全家桶自托管的开源印象笔记。",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        lang: "zh-CN",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        cleanupOutdatedCaches: true,
        additionalManifestEntries: [
          {
            revision: buildId,
            url: `/index.html?edgeever-offline-shell=${encodeURIComponent(buildId)}`,
          },
        ],
        globIgnores: [
          "index.html",
          // Noto Sans SC is used only by the on-demand print entry. Precaching every
          // CJK unicode-range shard adds ~4.5 MiB to every PWA installation.
          "**/noto-sans-sc-*.woff2",
          "**/*beautiful-mermaid*.js",
          "**/*mermaid.core-*.js",
          "**/vendor-mermaid-*.js",
          "**/*Diagram-*.js",
          "**/*DiagramEditorPane-*.js",
          "**/vendor-x6-*.js",
          "**/vendor-codemirror-*.js",
          // PDF.js is loaded only when a PDF preview or thumbnail is rendered.
          // Keep its runtime out of the install-time app-shell precache and cache
          // it after first use instead.
          "**/vendor~pdf-*.js",
        ],
        navigateFallback: null,
        navigationPreload: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              !["/mobile-edit.html", "/note-print.html", "/tiptap-ime-test.html"].includes(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "edgeever-app-shell",
              networkTimeoutSeconds: 5,
              cacheableResponse: {
                statuses: [0, 200],
              },
              precacheFallback: {
                fallbackURL: `/index.html?edgeever-offline-shell=${encodeURIComponent(buildId)}`,
              },
            },
          },
          {
            urlPattern: ({ url }) => /^\/api\/v1\/resources\/[^/]+\/blob$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "edgeever-resource-blobs",
              cacheableResponse: {
                statuses: [0, 200],
              },
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 90,
              },
            },
          },
          {
            urlPattern: ({ url }) => /\/assets\/(?:.*beautiful-mermaid|vendor-mermaid|.*mermaid\.core|.*Diagram-|vendor-x6|vendor-codemirror)/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "edgeever-optional-diagrams",
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ url }) => /\/assets\/(?:vendor~pdf-|pdf\.worker\.min-)/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "edgeever-optional-pdf",
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/mcp/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/mcp": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // ELK is distributed as one ~1.6 MiB module by beautiful-mermaid. It is
    // loaded only when a diagram is rendered and is excluded from HTML
    // modulepreload and PWA precache; verify-web-performance.mjs enforces
    // those constraints for every chunk above Vite's default 500 KiB limit.
    chunkSizeWarningLimit: OPTIONAL_CHUNK_WARNING_LIMIT_KB,
    modulePreload: isDesktopBuild
      ? false
      : {
          resolveDependencies: (_filename, dependencies) => dependencies.filter((dependency) =>
            !/(?:vendor-code-highlight|vendor-(?:mermaid|D3|tiptap|prosemirror|floating|codemirror|x6|zod)|vendor-radix(?!-slot)|ui-primitives|ui-button-tooltip)/.test(dependency),
          ),
        },
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        "mobile-edit": fileURLToPath(new URL("./mobile-edit.html", import.meta.url)),
        "note-print": fileURLToPath(new URL("./note-print.html", import.meta.url)),
        "tiptap-ime-test": fileURLToPath(new URL("./tiptap-ime-test.html", import.meta.url)),
        ...(isDesktopBuild
          ? {
              "desktop-renderer-test": fileURLToPath(
                new URL("./desktop-renderer-test.html", import.meta.url)
              ),
            }
          : {}),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-code-highlight",
              test: /node_modules[\\/](?:lowlight|highlight\.js)[\\/]/,
              priority: 50,
              // lowlight registers highlight.js languages through a cyclic
              // module graph. Splitting this group by size can evaluate a
              // language before its constructor is initialized in packaged
              // file:// desktop builds, leaving the entire window blank. Keep
              // that graph atomic, but leave TipTap's lightweight adapter in
              // the regular extension group so plain mobile code blocks do not
              // inherit the highlighter as a startup dependency.
            },
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/,
              priority: 40,
            },
            {
              name: "vendor-x6",
              test: /node_modules[\\/]@antv[\\/]x6[\\/]/,
              priority: 39,
              // X6 initializes registries and plugins through a cyclic module
              // graph. Size-based splitting can evaluate clipboard storage
              // before Config is initialized, crashing the lazy diagram editor.
              // Keep the graph atomic and defer the resulting chunk instead.
            },
            {
              name: "vendor-prosemirror",
              test: /node_modules[\\/](prosemirror-|orderedmap|rope-sequence)[\\/]/,
              priority: 38,
            },
            {
              name: "vendor-codemirror",
              test: /[\\/]node_modules[\\/](?:@codemirror|@lezer|@uiw[\\/](?:react-)?codemirror|@uiw[\\/]codemirror-themes|codemirror)[\\/]/,
              priority: 37,
            },
            {
              name: "vendor-tiptap-pm",
              test: /node_modules[\\/]@tiptap[\\/]pm[\\/]/,
              priority: 36,
            },
            {
              name: "vendor-tiptap-core",
              test: /node_modules[\\/]@tiptap[\\/]core[\\/]/,
              priority: 34,
            },
            {
              name: "vendor-tiptap-react",
              test: /node_modules[\\/]@tiptap[\\/]react[\\/]/,
              priority: 32,
            },
            {
              name: "vendor-tiptap-extensions",
              test: /node_modules[\\/](?:@tiptap[\\/](?:extension-|extensions)|tiptap-)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor-tiptap-starter",
              test: /node_modules[\\/]@tiptap[\\/]starter-kit[\\/]/,
              priority: 29,
            },
            {
              name: "vendor-linkify",
              test: /node_modules[\\/]linkifyjs[\\/]/,
              priority: 29,
            },
            {
              name: "vendor-floating",
              test: /node_modules[\\/](@floating-ui|tippy\.js)[\\/]/,
              priority: 28,
            },
            {
              name: "vendor-query",
              test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              priority: 25,
            },
            {
              name: "vendor-zod",
              test: /node_modules[\\/]zod[\\/]/,
              priority: 22,
            },
            {
              name: "vendor-i18n",
              test: /node_modules[\\/](i18next|react-i18next)[\\/]/,
              priority: 21,
            },
            {
              name: "vendor-storage",
              test: /node_modules[\\/](dexie|workbox-window)[\\/]/,
              priority: 20,
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 18,
            },
            {
              name: "vendor-radix-slot",
              test: /node_modules[\\/]@radix-ui[\\/](?:react-slot|react-compose-refs)[\\/]/,
              priority: 17,
              // Button needs Slot in the app shell. Keep this tiny primitive
              // separate from overlays that are loaded with lazy screens.
            },
            {
              name: "vendor-radix",
              test: /node_modules[\\/](@radix-ui|cmdk|vaul)[\\/]/,
              priority: 15,
            },
            {
              name: "vendor-ui-utils",
              test: /node_modules[\\/](class-variance-authority|clsx|tailwind-merge)[\\/]/,
              priority: 12,
            },
            {
              name: "vendor-mermaid-d3",
              test: /[\\/](?:d3(?:-[^\\/@]+)?|internmap|delaunator|robust-predicates)(?:@|[\\/])/,
              priority: 11,
            },
            {
              name: "vendor-mermaid-layout",
              test: /[\\/](?:cytoscape(?:-[^\\/@]+)?|dagre-d3-es|graphlib|roughjs|khroma|@upsetjs[\\/]venn\.js)(?:@|[\\/])/,
              priority: 11,
              maxSize: TARGET_VENDOR_CHUNK_BYTES,
            },
            {
              name: "vendor-mermaid-render",
              test: /[\\/](?:@mermaid-js[\\/](?:parser|tiny)|katex|dompurify|stylis|dayjs|@iconify[\\/]utils)(?:@|[\\/])/,
              priority: 11,
              maxSize: TARGET_VENDOR_CHUNK_BYTES,
            },
            {
              name: "vendor-beautiful-mermaid",
              test: /[\\/](?:beautiful-mermaid|elkjs|entities)(?:@|[\\/])/,
              priority: 13,
              maxSize: TARGET_VENDOR_CHUNK_BYTES,
            },
            {
              name: "ui-button",
              test: /src[\\/]components[\\/]ui[\\/]button\.tsx$/,
              priority: 12,
            },
            {
              name: "ui-button-tooltip",
              test: /src[\\/]components[\\/]ui[\\/]button-tooltip\.tsx$/,
              priority: 12,
            },
            {
              name: "ui-primitives",
              test: /src[\\/]components[\\/]ui[\\/]/,
              priority: 10,
            },
            {
              name: "vendor",
              // Keep Mermaid's internally lazy-loaded diagram modules out of the
              // catch-all vendor chunk so they remain on-demand. Entry-aware
              // splitting also prevents dependencies used only by lazy settings,
              // export, and template screens from leaking into the app entry.
              test: /^(?!.*(?:[\\/]mermaid@|node_modules[\\/]mermaid[\\/])).*node_modules[\\/]/,
              priority: 5,
              entriesAware: true,
              maxSize: TARGET_VENDOR_CHUNK_BYTES,
            },
          ],
        },
      },
    },
  },
});
