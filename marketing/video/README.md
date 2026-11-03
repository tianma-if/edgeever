# EdgeEver video clip library

[简体中文](README.zh-CN.md)

This is an editable source library for individual promotional clips, not an automatically assembled film. Export the clips you need and assemble them in your editing software. Sound, pacing and final transitions belong to the edit.

## First clip

`clips/logo-reveal/` is a silent, six-second, 1920 × 1080, 30 fps brand lockup on white. The first second is blank; the logo and wordmark enter between 1 and 2.25 seconds; the complete lockup holds through the last frame, including a one-second final handle. This is an opaque card, not a transparent overlay.

Requires Node.js 22+, npm and FFmpeg. Run from the clip directory (running npm commands at the product root can encounter its unrelated overrides):

```sh
cd marketing/video/clips/logo-reveal
npm run check
npm run snapshot
npm run dev
```

After reviewing the preview, export a clip:

```sh
npm run render
```

The output goes to the clip's ignored `renders/` directory. The CLI version is pinned in the clip scripts; no `npm install` or product dependency change is needed. The first command downloads the CLI into npm's cache. Browser setup may download Chromium if no usable browser is available. Preview and render work locally; no cloud publishing or automatic rendering workflow is configured.

## Adding clips

Create one self-contained project under `clips/<name>/`, with its own `index.html`, `hyperframes.json`, `compositions/`, `assets/` and metadata. Copy the first project's scripts and pin the same CLI version. There are no per-clip installed dependencies today; only add a local dependency manifest and lockfile if additional packages become necessary. Never add video tools to the product's root dependencies or its `apps/*` / `packages/*` workspaces.

For every clip, record dimensions, fps, duration, audio, background/alpha, timing handles, editable fields, asset provenance and export instructions. Start with 1920 × 1080 at 30 fps unless the shot calls for another format. Check and inspect opening, motion and final-hold snapshots before exporting. Verify actual alpha and target-editor import before describing a future clip as a transparent overlay.

## Source control and assets

Commit HTML/CSS/JS, plans, metadata, pinned commands and small necessary licensed assets. Keep raw recordings, rendered videos, snapshots, caches and editing-software projects outside Git; `raw/`, `renders/` and generated tool directories are ignored. Large shared source media should live in external storage, with a stable location and license recorded here. Do not commit private screens, credentials or restricted third-party media.

The first clip freezes a small copy of `assets/brand/edgeever-mark.svg` into its local assets so it remains independently renderable. Refresh that copy deliberately when the brand changes; do not edit the product logo through this project. Future shared media can be catalogued under this library, but copy only the required assets into each clip's render root.

## Self-hosting boundary

- This directory is outside product workspaces and TypeScript inputs. Product dependency manifests and the root lockfile remain unchanged.
- Docker excludes this directory. Video-only changes are ignored by the product test workflow; mixed changes still trigger it. No video Actions or installation hooks are added.
- Existing native release planning does not treat this directory as a runtime input.
- The Cloudflare Workers Builds setup script excludes `marketing/video/*` for newly configured or reconfigured triggers. Existing remote triggers do not update merely by pulling this commit; their owners must apply the same exclusion in Cloudflare if desired. No remote settings are changed by this project setup.
- Other externally configured pipelines may still watch every commit. Git-tracked source also adds a small amount to every fork's clone; generated media is excluded to keep that growth limited.
