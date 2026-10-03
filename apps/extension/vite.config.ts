import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import extensionPackage from "./package.json";
import { buildExtensionManifest, type ExtensionTarget } from "./manifest";

const target: ExtensionTarget = process.env.EDGE_EVER_EXTENSION_TARGET === "firefox"
  ? "firefox"
  : "chromium";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [
    {
      name: "edgeever-extension-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "manifest.json",
          source: `${JSON.stringify(buildExtensionManifest(target, extensionPackage.version), null, 2)}\n`,
        });
      },
    },
  ],
  build: {
    outDir: target === "firefox" ? "dist-firefox" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./popup.html", import.meta.url)),
        options: fileURLToPath(new URL("./options.html", import.meta.url)),
        "image-save": fileURLToPath(new URL("./image-save.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background.ts", import.meta.url)),
        capture: fileURLToPath(new URL("./src/capture.ts", import.meta.url)),
        "capture-image": fileURLToPath(new URL("./src/capture-image.ts", import.meta.url)),
        "capture-tweet": fileURLToPath(new URL("./src/capture-tweet.ts", import.meta.url)),
        "capture-github": fileURLToPath(new URL("./src/capture-github.ts", import.meta.url)),
        "capture-xhs": fileURLToPath(new URL("./src/capture-xhs.ts", import.meta.url)),
        "capture-zhihu": fileURLToPath(new URL("./src/capture-zhihu.ts", import.meta.url)),
        "capture-reddit": fileURLToPath(new URL("./src/capture-reddit.ts", import.meta.url)),
        "tweet-target": fileURLToPath(new URL("./src/tweet-target.ts", import.meta.url)),
        "tweet-save": fileURLToPath(new URL("./tweet-save.html", import.meta.url)),
        "xhs-target": fileURLToPath(new URL("./src/xhs-target.ts", import.meta.url)),
        "xhs-save": fileURLToPath(new URL("./xhs-save.html", import.meta.url)),
        "zhihu-target": fileURLToPath(new URL("./src/zhihu-target.ts", import.meta.url)),
        "reddit-target": fileURLToPath(new URL("./src/reddit-target.ts", import.meta.url)),
        "zhihu-save": fileURLToPath(new URL("./zhihu-save.html", import.meta.url)),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
