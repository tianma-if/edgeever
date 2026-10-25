import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  site: "https://edgeever.org",
  server: {
    port: 4321,
    host: "127.0.0.1"
  },
  integrations: [
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: "zh-CN",
        locales: {
          "zh-CN": "zh-CN",
          en: "en-US",
          ja: "ja",
          pl: "pl",
        },
      },
    }),
    icon(),
    react(),
  ],
  redirects: {
    "/guides/evernote-migration": "/blog/evernote-migration-guide",
    "/guides/memos-migration": "/blog/memos-migration-guide",
    "/guides/notion-migration": "/blog/notion-migration-guide",
    "/en/guides/evernote-migration": "/en/blog/evernote-migration-guide",
    "/en/guides/memos-migration": "/en/blog/memos-migration-guide",
    "/en/guides/notion-migration": "/en/blog/notion-migration-guide",
    "/ja/guides/evernote-migration": "/en/blog/evernote-migration-guide",
    "/ja/guides/memos-migration": "/en/blog/memos-migration-guide",
    "/ja/guides/notion-migration": "/en/blog/notion-migration-guide",
    "/pl/guides/evernote-migration": "/en/blog/evernote-migration-guide",
    "/pl/guides/memos-migration": "/en/blog/memos-migration-guide",
    "/pl/guides/notion-migration": "/en/blog/notion-migration-guide",
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      fs: {
        allow: ["../.."],
      },
    },
  },
});