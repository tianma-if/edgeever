import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolveAppVersion, resolveDeploymentMethod, resolveDeploymentTrigger, resolveReleaseTimestamp } from "./build-metadata";

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
const appVersion = resolveAppVersion(readPackageVersion(), gitDescription);
const releaseTimestamp = resolveReleaseTimestamp(process.env.EDGE_EVER_RELEASED_AT) || readLatestReleaseCommitTimestamp();
const deploymentTrigger = resolveDeploymentTrigger(
  process.env.EDGE_EVER_DEPLOYMENT_TRIGGER
    ?? (process.env.WORKERS_CI_COMMIT_SHA ? "main_push" : undefined)
);
const deploymentMethod = resolveDeploymentMethod(
  process.env.EDGE_EVER_DEPLOYMENT_METHOD
    ?? (process.env.WORKERS_CI_COMMIT_SHA
      ? "cloudflare_workers_builds"
      : process.env.GITHUB_ACTIONS
        ? "github_actions"
        : undefined)
);

export default defineConfig({
  root: "apps/web",
  define: {
    __EDGEEVER_APP_VERSION__: JSON.stringify(appVersion),
    __EDGEEVER_BUILD_ID__: JSON.stringify(buildId),
    __EDGEEVER_BUILD_LABEL__: JSON.stringify(buildId === "local" ? "local" : buildId.slice(0, 7)),
    __EDGEEVER_RELEASED_AT__: JSON.stringify(releaseTimestamp),
    __EDGEEVER_DEPLOYMENT_TRIGGER__: JSON.stringify(deploymentTrigger),
    __EDGEEVER_DEPLOYMENT_METHOD__: JSON.stringify(deploymentMethod),
  },
  plugins: [
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
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp\//, /^\/mobile-edit\.html$/, /^\/tiptap-ime-test\.html$/],
        runtimeCaching: [
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
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        "mobile-edit": fileURLToPath(new URL("./mobile-edit.html", import.meta.url)),
        "tiptap-ime-test": fileURLToPath(new URL("./tiptap-ime-test.html", import.meta.url)),
      },
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/,
              priority: 40,
            },
            {
              name: "vendor-prosemirror",
              test: /node_modules[\\/](prosemirror-|orderedmap|rope-sequence)[\\/]/,
              priority: 38,
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
              test: /node_modules[\\/]@tiptap[\\/](extension-|extensions)[\\/]/,
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
            },
            {
              name: "vendor-mermaid-render",
              test: /[\\/](?:@mermaid-js[\\/](?:parser|tiny)|katex|dompurify|stylis|dayjs|@iconify[\\/]utils)(?:@|[\\/])/,
              priority: 11,
            },
            {
              name: "vendor-beautiful-mermaid",
              test: /[\\/](?:beautiful-mermaid|elkjs|entities)(?:@|[\\/])/,
              priority: 13,
            },
            {
              name: "ui-primitives",
              test: /src[\\/]components[\\/]ui[\\/]/,
              priority: 10,
            },
            {
              name: "vendor",
              // Keep Mermaid's internally lazy-loaded diagram modules out of the
              // catch-all vendor chunk so they remain on-demand.
              test: /^(?!.*(?:[\\/]mermaid@|node_modules[\\/]mermaid[\\/])).*node_modules[\\/]/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
});
