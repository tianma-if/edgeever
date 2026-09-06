import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  // The shared workspace package is linked from outside EditorSource. Preserve
  // that symlink so Vite resolves its TipTap imports from this package's clean
  // install as well as from a fully installed monorepo checkout.
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    outDir: "../EditorBundle",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: "index.html",
    },
  },
});
