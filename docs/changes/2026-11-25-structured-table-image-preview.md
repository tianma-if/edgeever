# Bitable images: covers and thumbnails render from downscaled previews

## Problem and goal

Hovering a kanban card took a noticeable fraction of a second before the shadow appeared. The cause was not the animation: the cover was the original upload — a `2560×27421` PNG (20.3 MB) painted into a `238×96` box, so the browser decoded roughly 280 MB of bitmap. The card also used `transition` (i.e. `all`) with `hover:shadow-md`, so every hover repaint re-composited that giant layer and produced long tasks of 100-180 ms. The 32px attachment thumbnails in the grid and the gallery covers had the same defect.

Goal: paint only a small, display-sized bitmap in cards and thumbnails while keeping click-through, copy and download of the original untouched, and compress new uploads according to the existing workspace preference instead of storing 20 MB originals.

## Allowed changes and acceptance

- New `apps/web/src/lib/image-preview.ts`: caches previews per `resourceId@width`. It fetches the original blob with `credentials: "include"`, downscales during decode with `createImageBitmap(blob, { resizeWidth })` (no full-size bitmap is ever allocated), encodes `image/webp` at 0.82 and returns an object URL. `svg`/`gif`/`apng`/`avif` keep the original blob so animation and vector content survive; the longest edge is capped at 640 with a `resizeHeight` fallback for very tall images. An in-memory cache plus in-flight de-duplication backs `peekImagePreview` (sync) and `loadImagePreview` (promise).
- New `apps/web/src/components/table/ResourceImage.tsx`: renders a same-sized `bg-muted/60` placeholder until the preview resolves (no layout shift), then an `<img loading="lazy" decoding="async">`; test ids `resource-image-placeholder` / `resource-image`.
- Wiring: `AttachmentCell` thumbnails (width bucket 96), kanban covers (400) and gallery covers (480). The original `href` used for opening, copying and downloading is unchanged.
- Paint cost: card `transition` narrowed to `transition-shadow duration-150`; kanban cards also set `contain: paint` so hovering no longer animates every property of the card and its cover layer.
- Upload path: `AttachmentCell` honours the workspace image-compression preference (`readImageCompressionPreference()`) before `uploadMemoResource`, matching the editor upload path; with the preference off the original file is uploaded.

## Unchanged

No server storage, `?w=` thumbnail endpoint or `resources` schema changes: the original stays the only persisted object and previews are browser-side derivatives. The desktop `edgeever-resource://` mapping is untouched (desktop still opens the local original). Non-image attachments and non-image MIME types are unaffected.

## Verification

Measured against the same user data (a `2560×27421` PNG cover) with Playwright + CDP:

| Metric | Before | After |
| --- | --- | --- |
| Decoded cover size | `2560×27421` | `400×4285` (blob URL) |
| Long tasks during hover | `[147, 136]` / `[183, 122]` ms | none |
| Hover to shadow change | hundreds of ms (blocked) | `53 ms` |
| Entering kanban to cover ready | — | `454 ms` |
| JS heap | `100 MB` | `90 MB` |

- New unit test `apps/web/src/lib/image-preview.test.mjs` (five cases: de-duplication, width buckets, animated/vector passthrough, read failure returns null, blank ids are not cached).
- New E2E `tests/e2e/structured-table-image-preview.spec.ts`: after uploading a real PNG, both the grid thumbnail and the kanban cover use `blob:` sources with `naturalWidth ≤ 640` and no placeholder remains.
- `bun run typecheck` and `bun run lint` (0 warnings / 0 errors) pass; the existing structured-table E2E suite passes unchanged.
- Not covered: the server-side `?w=` branch when a Cloudflare Images binding exists (locally there is no `env.IMAGES`, and the route falls back to the original), preview resizing over the desktop resource protocol, and the read-only mobile base view.
