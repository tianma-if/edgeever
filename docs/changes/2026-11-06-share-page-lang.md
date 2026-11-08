# Language of the shared note in the first HTML response

[简体中文](2026-11-06-share-page-lang.zh-CN.md)

Related Issue: #814

## Problem and outcome

The first HTML response for a public note share is built on the web app shell, which declares `<html lang="zh-CN">`. The server-side note inherited that language, whatever language the note was written in, and the English text the server adds ("Updated … UTC", "Published with EdgeEver") was marked as Chinese as well. Link previews, crawlers, assistants and screen readers that read only this response got the wrong language.

The server-side article now marks its parts explicitly:

- the note title (`<h1>`) and body (`<pre>`) use `lang=""`, so they are treated as unknown and no longer inherit `zh-CN`;
- the update time, the "Published with EdgeEver" footer and the "Shared note" fallback title use `lang="en"`.

The app shell and its `<html lang>` are unchanged. Choosing the page language from the visitor's `Accept-Language` is left for a separate discussion. The shared business code is used by both Cloudflare and Docker.

## Verification

- `apps/api/src/share-page.test.mjs` has a regression test for these attributes and for the untitled fallback title.
- I checked the first HTML response of a share from a self-hosted build of this branch with `curl`.

## Rollback

Revert `share-page.ts`. No data or settings change.
