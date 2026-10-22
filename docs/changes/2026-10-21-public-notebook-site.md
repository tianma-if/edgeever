# Issue 591 public notebook site implementation checklist

[简体中文](2026-10-21-public-notebook-site.zh-CN.md)

Requirements: [Issue #591](https://github.com/tianma-if/edgeever/issues/591). Design: [site plan](../public-notebook-site-plan.md). Baseline: official `e15792d0`. This document records final behavior, boundaries and acceptance.

## Problem, objective and risk

Public sites need article navigation, body search, per-note exclusion, homepages and presentation settings. Implement R01–R13 with exclusions scoped independently to each share; tags retain classification semantics.

Scope includes public Web reading, author sharing, shared API/client types, migration 0072, and Cloudflare/self-hosted page entries. The worst outcome is disclosure of excluded or password-protected content. After exclusions are enabled, rollback must retain filtering or first revoke affected shares; an older server that ignores the exclusion table is unsafe.

## Allowed behavior and acceptance

| ID | Allowed behavior | Acceptance |
| --- | --- | --- |
| C01 | Add the next migration: nullable share `site_slug`, valid-object JSON defaulting to `{}`, and case-insensitive alias uniqueness. Add an exclusion relation with two foreign keys, composite primary key, and physical-delete cascades. Legacy shares start without exclusions. | Upgrade old data with real tokens/passwords, read/unlock existing shares, and verify defaults, collisions, and cascades. |
| C02 | Share settings expose alias, homepage, HTTPS logo, HTTPS header links, plain-text footer, indexing, and existing/title ordering. Accept only the six settings keys; merged JSON is at most 16 KiB. Empty aliases clear; others normalize to lowercase letters/digits/hyphens. Reject invalid URLs, ordering, homepages, and unknown keys. Explicit homepages must be visible; invalid stored references fall back on reads. | API management and real UI saves followed by anonymous readback, invalid inputs, partial writes, and invalidated homepages. |
| C03 | Authors can paginate exclusions and exclude/restore notes. Operations require user identity and an active share in the current workspace; setting an exclusion also requires a live subtree note, while restoring deletes only this share's relation. Both operations are idempotent. Moves/soft deletion retain exclusions; restored notes remain excluded. Recreated shares do not inherit exclusions. | Actual Hono routes covering authorization, independent child shares, moves/restores, deletion, and revocation. |
| C04 | Directory, article, resources, link resolution, search, preview, homepage, and metadata share live-scope/exclusion checks. Tags remain classification/search metadata. Filter before pagination using existing FTS, Chinese substring matching, and pagination limits; return body excerpts/highlights. Preview returns only visible note titles and existing short excerpts. | API-to-database/resource readback covering disclosure, Chinese/body hits, pagination, combined tags, preview, and password gates. |
| C05 | Visitors get a shortcut search dialog, highlights/excerpts, tag filtering, pagination, and retry feedback. Keep directory access alongside custom homepages. Apply natural title/number ordering consistently to navigation, contents, and previous/next. | Real author-to-anonymous-page flow. |
| C06 | Add H1–H4 outlines, duplicate-safe anchors, scrollspy, smooth navigation, and fragment reloads. Support mobile drawers, keyboards, and reduced motion. | Long-article anchors, reload, scroll, mobile viewport, and keyboard checks. |
| C07 | Notebook sites reuse local light/dark/system preference across article/code/diagrams. Code shows language, full-source copying, and collapse; images open a lightbox on click with gesture zoom; reuse diagram fitting/fullscreen. | Actual article/code/image/diagram interactions; preserve individual-note sharing behavior. |
| C08 | Internal links show on-demand HoverCard previews on hover/focus. Use Tooltip instead of native title. Invalid/excluded targets disclose no titles/excerpts or independent-share bypasses. | Actual hover/focus, rejected APIs, and filtered links. |
| C09 | Logo failures fall back to the current icon; render header links/footer. `/s/:slug/:memoId?` resolves only the token and reuses canonical links, password cookies, and revocation. | Canonical/alias links, unlocking, collisions, and invalidated access. |
| C10 | Indexing defaults off and requires an alias URL, no password and explicit opt-in. Token pages always retain the complete shared noindex policy and canonical points to the alias when configured. Render server HTML head/canonical/OG/Twitter; protected pages remain generic. Invalid/excluded articles return unavailable status and the complete noindex policy. The client preserves server robots while identity, directory or the selected article is pending, and uses the complete shared policy after errors or when indexing is disabled. Preserve private/no-store and no-referrer; JSON APIs always remain noindex. Setting/rotating passwords disables indexing; clearing does not re-enable it. Reject enabling indexing with a password. | Raw HTML/headers for alias and Token roots/articles, canonical links, escaping, password changes and privacy; browser regression with delayed successful/failed articles and full noindex readback. The shared page service serves Cloudflare/Docker entries. |


| ID | Author interaction and supporting APIs | Acceptance |
| --- | --- | --- |
| C11 | Notebook context/more menus consistently use Share notebook; directly shared notebooks keep their more button visible. Reopening reuses the token; settings retain the aggregate share entry. | Create, close and reopen from the original location; check token, copying and existing aliases. |
| C12, C19, C23 | Site settings expand in Advanced settings within the share dialog, collapsed by default and preserving unsaved input across collapse. Reuse one settings form; `/notebooks/:notebookId/site` remains directly accessible, while normal sharing stays in place. No second content-management list. | Desktop/390px expansion, retained edits, save-to-anonymous readback, direct access and login boundaries; rerenders retain one password control. |
| C13 | A separate homepage picker selects only notes visible in the current site; selection still requires saving. Invalid stored references show directory fallback; saving unrelated fields preserves an unchanged reference, allowing restoration when visible again. State-read failures show an error and retry. | Select/save, exclude homepage, save other fields, restore and delete; Escape closes only the picker and returns focus. |
| C14–C15 | Author `GET /api/v1/notebooks/:id/share/memos` returns IDs, titles, notebook identity, exclusion state and a cursor, without bodies. Require user identity and an active current-workspace share. Filter keywords/state before pagination. Only all/public/excluded are accepted, default all, otherwise 400; limit defaults to 50 within 1–100, UI pages contain 20, ordered by ID cursor. | Chinese/body search, filtering before pagination, cross-page selection, authorization and inactive shares. Replace each page rather than accumulating list DOM. |
| C16 | `GET /api/v1/memos/:id/notebook-sites` returns only valid direct/ancestor site names, IDs and exclusion states to current-workspace users. It creates no individual share and returns no token or password. | Valid/no sites, independent parent/child sites, moves, deleted ancestors, identity and workspace boundaries. |
| C17–C18 | The original note dialog and list context menu share per-site controls. Disable writes while pending, update on server confirmation, and retain prior state on failure; reads show retry. Hide empty controls without sites, and omit them for trash/local unsynced notes. Opening the dialog no longer creates an individual link; creation is explicit. Existing links, passwords, copying and revocation remain available. Revocation callbacks affect only the original note. | Original-page exclude/restore and anonymous readback, parent/child independence, consistent entries, failure/retry, explicit individual creation/revocation, delayed revocation, narrow viewports and keyboards. |

## Boundaries retained

- Preserve note content, global state, tag semantics, sync, author hierarchy/order, and access rules for independent note shares and public forms.
- Preserve upstream in-note heading-link navigation when integrating the shared reader; keep site outlines and single-click image previews. Verify the existing heading-anchor tests and the browser article click path.
- Preserve existing tokens, password hashes/ciphertext/encryption root, authorization cookie paths and password APIs. Saving settings does not rotate passwords.
- No manual drag ordering, review/scheduled publication, snapshots, full article SSR, sitemap, uploads or screenshot service. Names derive from root notebooks; descriptions derive from visible excerpts.
- Reuse existing 30-second refresh, themes and viewers. Add no polling mechanism or event bus, and promise neither retrieval of downloaded content nor immediate removal from external indexes.
- Cloudflare and self-hosting share business logic with thin runtime entries. Wrangler only adds public-page Worker routing and updates the existing configuration fingerprint; instance binding rules, native runtimes, versions and release workflows remain unchanged. No new dependencies.

## Completion check and validation

R01–R13 and the final behavior above are implemented. Product changes map to this checklist. Main evidence:

| Scope | Completed acceptance |
| --- | --- |
| Migration/compatibility | Real old routes and 0001–0071 data upgraded with 0072 retain tokens, password hashes and unlock cookies. Cover alias conflicts, defaults, cascades and share recreation. |
| Public scope/search | Actual Hono routes and database checks cover workspaces, live subtrees, exclusions, resources, links, homepages, previews, Chinese/body search, tags and pagination; parent exclusions preserve independent child access. |
| Author to visitor | Homepage/settings UI saves followed by anonymous readback; original-note exclude/restore; invalid-home fallback/restoration, read error/retry and late revocation responses. |
| Reading | Local long articles cover H1–H4, duplicate headings, fragment reload/scrollspy, code copy/collapse, themes, images and diagrams. Drawers/dialogs fit a 390px viewport without horizontal overflow. |
| HTML/cache | Local Cloudflare Worker and self-hosted Bun entries verify metadata, canonical URLs, escaping, indexing, passwords and excluded-article 404s. Public pages bypass PWA app-shell caching. C10 regression checks confirm that Token roots/articles keep the complete noindex policy and alias canonical, and delayed successful/failed article requests preserve server robots until completion. |
| Cloudflare | Independent Worker/D1/R2 deployment; 35 real HTTP checks cover Chinese search, R2, exclusions, parent/child independence, homepages, metadata, passwords and unlock cookies. Browser acceptance covers login, share settings, original-note controls and main reading interactions. |

Reproducible required checks:

```sh
bun test apps/api/src/notebook-share-routes.test.mjs tests/note-sharing-menu.test.ts packages/shared/src/i18n/catalog.test.mjs apps/web/src/components/dialogs/ShareQrCode.test.mjs
bun test tests/deployment-entrypoints.test.ts
bun test apps/web/src/lib/editor-heading-anchor.test.mjs
bunx playwright test tests/e2e/public-notebook-indexing.spec.ts
bun run typecheck
bun run typecheck:mobile
bun run build:web
```

These relevant checks passed, together with targeted lint and `git diff --check`. Old-route migration and browser flows are separate acceptance steps; a build or one successful HTTP response does not replace them. Reuse unaffected verification.

C10 corrections are complete: 30 notebook-sharing API tests and 3 browser regressions pass. The browser tests use real sharing APIs and an injected HTML head for Vite's bare app shell; actual local Worker responses also confirm headers, robots and canonical for alias, excluded-article and Token pages. Upstream integration preserves heading-link capture alongside site image controls; 7 existing heading-anchor tests and the browser heading-jump/single-click image flow pass. Changes are limited to metadata policy, reader integration, regression coverage and matching documentation; no data, permission, migration or deployment changes are included.

Remaining limits: CF acceptance uses a separate new database rather than a production upgrade. The self-hosted entry was exercised, but Docker containers, Android/iOS native devices, real search/social crawlers and concurrent writers remain unverified. Articles retain SPA rendering without full SSR or sitemap; indexing outcomes are not guaranteed. The corresponding PR/workflows track merge, CI and release status.
