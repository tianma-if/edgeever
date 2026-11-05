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
    "/guides/evernote-migration": "/blog/note-migration-guide",
    "/guides/memos-migration": "/blog/note-migration-guide",
    "/guides/notion-migration": "/blog/note-migration-guide",
    "/blog/evernote-migration-guide": "/blog/note-migration-guide",
    "/blog/memos-migration-guide": "/blog/note-migration-guide",
    "/blog/notion-migration-guide": "/blog/note-migration-guide",
    "/blog/flomo-migration-guide": "/blog/note-migration-guide",
    "/en/guides/evernote-migration": "/en/blog/note-migration-guide",
    "/en/guides/memos-migration": "/en/blog/note-migration-guide",
    "/en/guides/notion-migration": "/en/blog/note-migration-guide",
    "/en/blog/evernote-migration-guide": "/en/blog/note-migration-guide",
    "/en/blog/memos-migration-guide": "/en/blog/note-migration-guide",
    "/en/blog/notion-migration-guide": "/en/blog/note-migration-guide",
    "/en/blog/flomo-migration-guide": "/en/blog/note-migration-guide",
    "/ja/guides/evernote-migration": "/ja/blog/note-migration-guide",
    "/ja/guides/memos-migration": "/ja/blog/note-migration-guide",
    "/ja/guides/notion-migration": "/ja/blog/note-migration-guide",
    "/ja/blog/evernote-migration-guide": "/ja/blog/note-migration-guide",
    "/ja/blog/memos-migration-guide": "/ja/blog/note-migration-guide",
    "/ja/blog/notion-migration-guide": "/ja/blog/note-migration-guide",
    "/ja/blog/flomo-migration-guide": "/ja/blog/note-migration-guide",
    "/pl/guides/evernote-migration": "/pl/blog/note-migration-guide",
    "/pl/guides/memos-migration": "/pl/blog/note-migration-guide",
    "/pl/guides/notion-migration": "/pl/blog/note-migration-guide",
    "/pl/blog/evernote-migration-guide": "/pl/blog/note-migration-guide",
    "/pl/blog/memos-migration-guide": "/pl/blog/note-migration-guide",
    "/pl/blog/notion-migration-guide": "/pl/blog/note-migration-guide",
    "/pl/blog/flomo-migration-guide": "/pl/blog/note-migration-guide",
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