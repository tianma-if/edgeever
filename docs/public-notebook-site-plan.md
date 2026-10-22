# Public notebook site improvement plan

[简体中文](public-notebook-site-plan.zh-CN.md)

Related: [Issue #591](https://github.com/tianma-if/edgeever/issues/591). Updated: 2026-10-21.

Status: R01–R13 are implemented. Site settings expand in the notebook share dialog; original-note controls manage per-site visibility, and a separate search picker selects the homepage. Local and independent Cloudflare acceptance are recorded in the [implementation checklist](changes/2026-10-21-public-notebook-site.md). Baseline: official `5d1a0661`. Historical ablations used `4ad082b5` and remain separate from product validation. Real crawlers, native devices and Docker containers remain unverified.

## 1. Design choices and boundaries

**Use an explicit per-note exclusion control for the current site: add one exclusion relation table and two columns on `notebook_shares`.** Authors select notes that visitors to this site must not access. Chapters keep existing or natural title/number order. Keep live sharing without editorial review, publication snapshots, or a site builder.

Explicit per-site exclusion is a relation between a share and a note, independent of classification tags. Retain its minimum relation table without manual ordering or a general item-override model. Earlier tag-based experiments establish filtering feasibility but do not validate this exclusion model.

The resulting behavior and limits are:

- The original note-share dialog and note-list context menu provide per-site switches for excluding or restoring individual notes. Exclusion applies only to the current share. Parent sites and independent child sites each have their own settings; note content, tags, and other shares retain their access rules. Start with no exclusions, preserving old public scope by default.
- Keep existing order and title/number order, without site-specific drag ordering or changes to notebook hierarchy.
- Derive the site name from the root notebook and descriptions from a visible homepage or article excerpt; do not add independent name/description overrides.
- Reuse the device appearance preference. The public site and same-origin app share that local preference without writing to the author's account.
- Keep server metadata and the indexing switch in the first version; defer complete article SSR and sitemap. This reduces non-JavaScript body crawlability and proactive discovery; equivalent SEO outcomes have not been established.

The benefits remain better reading, body search, and site presentation. Principal risks remain incomplete public-visibility filtering, incorrect indexing policy, and rollback to an older server that ignores new policies. Delivery now includes the plan, retained historical experiments, and product implementation. Migration compatibility was verified locally; a separate Cloudflare acceptance database also applied 0001–0072.

## 2. Minimum implementation of the 13 requirements

| ID | Requirement | Minimum implementation and ablation decision |
| --- | --- | --- |
| R01 | Article outline | Keep body H1–H4, scrollspy, and smooth positioning. Distinguish duplicate anchors, support direct fragment reloads, and do not edit note content. Removing it loses an explicit requirement. |
| R02 | Dark mode | Reuse ThemeProvider and `edgeever.theme` with light/dark/system choices. Do not introduce another preference controller or storage key. Articles, code, and diagrams use the same resolved theme. |
| R03 | Code blocks | Reuse copying/highlighting; add language labels and collapse controls. Collapsed blocks still copy complete source; collapse state is not persisted. |
| R04 | Internal previews | Keep bounded on-demand title/excerpt reads for hover and keyboard focus. Removing previews loses a requirement; fetching complete articles is not an equivalent lightweight replacement. |
| R05 | Images and diagrams | Reuse the lightbox, gesture zoom, X6 fitting, and reader. Add single-click enlargement, fit, and fullscreen without a second viewer or duplicate reset tools. |
| R06 | Body search | Reuse existing FTS, Chinese matching, and excerpt logic with a shortcut dialog, highlighting, pagination, and error feedback. Title filtering does not replace body search. |
| R07 | Tag aggregation | Clicking an article tag filters through the same search endpoint and can combine with keywords. Do not add a global tag cloud, counts, or another aggregation API. |
| R08 | Homepage | Store one homepage note ID and retain a directory entry. Hidden, deleted, or out-of-scope homepages fall back without disclosing their titles or excerpts. |
| R09 | Exclude notes from the site | Authors explicitly select “Exclude from this site”; the server denies access to that note through this site. Start with no exclusions. Do not add global draft status or use `#draft` tags to control public scope. |
| R10 | Custom ordering | Choose the title/number alternative allowed by the issue. One site `sortMode` selects existing or natural title order; numeric 2 precedes 10, and IDs break equal-title ties. |
| R11 | URL alias | Keep an instance-unique alias, original token links, and one revocation boundary. Resolving aliases identifies shares without granting access. |
| R12 | Branding | Keep HTTPS logos, structured header links, and plain-text footers in a small settings object. Do not add asset uploads or arbitrary HTML. |
| R13 | SEO and cards | Keep explicit indexing permission, server HTML head, canonical URLs, and OpenGraph / Twitter Card metadata. Articles retain SPA rendering; complete SSR and sitemap are outside the first delivery. |

Desktop retains the header, left chapters, central article, and a wide-screen right outline. Mobile uses drawers for chapters and article headings. Reuse article/image/diagram renderers, author fonts, font size, line height, palette, and sanitized article CSS. Tooltip and HoverCard support keyboard interaction; positioning respects reduced motion.

Use one `Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })` helper to order same-type siblings. Navigation, homepage contents, and previous/next links share the result. Ordering affects site presentation only, not stored hierarchy or author notebook order.

## 3. Reduced persistence and interfaces

### 3.1 Two site columns and one exclusion table

| Table and column | Type and default | Purpose |
| --- | --- | --- |
| `notebook_shares.site_slug` | `TEXT NULL` | Optional alias; unique index on non-NULL `lower(site_slug)`. Normalize to lowercase letters, digits, and hyphens. |
| `notebook_shares.site_settings_json` | `TEXT NOT NULL DEFAULT '{}'` | Small site settings; constrain to a valid JSON object. The API limits the merged object to 16 KiB. |

Add `notebook_share_excluded_memos`, containing excluded notes only:

| Column | Constraint and purpose |
| --- | --- |
| `share_id` | `TEXT NOT NULL`, referencing `notebook_shares.id` with cascade deletion when the share is deleted. |
| `memo_id` | `TEXT NOT NULL`, referencing `memos.id` with cascade deletion when the note is physically deleted. |

Use `(share_id, memo_id)` as the composite primary key and index `memo_id`. A row means excluded from this site; restoring inclusion deletes the row. Do not add a boolean, chapter type, ordering, or version fields. The absence of a row still requires existing workspace, live-subtree, and deletion checks; it does not grant unconditional public access.

Before setting an exclusion, validate the author's share-management permission and the note's workspace, live-subtree membership, and deletion state. Live-scope checks deny notes moved outside or soft-deleted. Retained exclusion rows take effect again when a note is restored and re-enters scope. Revoking and recreating a share creates a new share ID without inheriting old exclusions.

The site settings object contains only these six keys. Do not store per-note lists, manual-rank maps, or article bodies:

| Key | Default | Behavior |
| --- | --- | --- |
| `homeMemoId` | `null` | Validate an explicit selection against this site's exclusion rows and revalidate on every public read. |
| `logoUrl` | `null` | HTTPS image URL, with the existing icon as fallback. |
| `headerLinks` | `[]` | Link labels and HTTPS destinations. |
| `footerText` | `''` | Plain-text footer. |
| `allowIndexing` | `false` | Effective permission always requires explicit opt-in and no current password. |
| `sortMode` | `'existing'` | Only `existing` or `title`; existing behavior remains the default. |

Do not add separate `site_title`, `site_description`, `home_memo_id`, logo/header/footer, indexing, excluded-tag, or two sort-mode columns. The exclusion table relates this site to notes without a general item-override model. Use the root notebook name and visible homepage/article excerpts for metadata; without a homepage, use the root notebook name as the description.

An invalid `homeMemoId` is one bounded pointer. After moves, soft deletion, or physical deletion, reads fall back to the directory without a foreign key, new cleanup job, or database writes from public GETs. The shared service still enforces workspace and live-subtree scope.

Apply partial configuration writes with database-side `json_patch`, preserving other fields, and reuse `updated_at`. Setting or rotating a password writes JSON `false` to `allowIndexing`; removing a password does not re-enable it. Preserve password hashes, ciphertext, tokens, and cookie paths.

Reuse `memos`, `memo_contents`, `memo_tags`, `memo_search_documents`, `memos_fts`, and `resources`. The plan baseline ended at `0071`; implementation adds `0072_public_notebook_sites.sql` without editing earlier migrations.

### 3.2 Eight new API operations; reuse the rest

| Interface | Handling |
| --- | --- |
| Existing `GET /api/v1/notebooks/:id/share` | Include owner-managed site settings; do not add another site GET. |
| Existing share create/revoke/password PATCH | Preserve meaning. Password PATCH continues to handle password operations only; configuration saves do not enter that branch. |
| `PATCH /api/v1/notebooks/:id/share/site` | New. Save an alias and partial settings and return the merged configuration, without generating or clearing passwords. |
| `GET /api/v1/notebooks/:id/share/excluded-memos` | Retain the first-version endpoint for paginated excluded IDs/titles accessible to the author. The current UI does not display a separate exclusions list. Do not return complete bodies or put the list in site settings. |
| `GET /api/v1/notebooks/:id/share/memos` | Retain filtered owner pagination, now used only by the included-note homepage picker without rendering a separate management list. |
| `GET /api/v1/memos/:id/notebook-sites` | New. Return applicable live direct/ancestor site names, notebook IDs, and independent exclusion states for the current user's note, without bodies/passwords/tokens or creating shares. |
| `PATCH /api/v1/notebooks/:id/share/memos/:memoId` | New. Accept `{ excluded: boolean }`. Idempotently insert the exclusion for `true` or delete it for `false`; return this note's exclusion state in this site. |
| `GET /api/public/notebook-shares/:token/search` | New. Combine keyword/tag filtering and pagination; return titles, matching excerpts, and highlights. Build chapter paths from the existing directory. |
| `GET /api/public/notebook-shares/:token/memos/:memoId/preview` | New. Fetch title/existing short excerpt on demand without reading complete bodies or adding previews to every initial directory entry. |
| `GET /api/public/notebook-sites/:slug/resolve` | New, making the previously implicit identity operation explicit. Return only `{ token }`; then use canonical token APIs and password gates. Do not expose protected site names, bodies, or settings. |
| Existing public directory/article/resource endpoints | Return required visitor settings and consistently enforce live scope and per-note exclusions. Do not expose the list of excluded notes to visitors. |

Use dedicated exclusion reads/writes rather than growing site settings JSON. Read accurate states for the current note's applicable sites without scanning directories or partially loaded exclusion pages. Do not add a general item-override model, manual-order PUT, or redundant site GET. Existing unlock cookies remain scoped to canonical token API paths, which aliases continue to use without changing the password protocol.

### 3.3 Service boundaries that remain necessary

- Share workspace, live-subtree, deletion, and current-share exclusion checks across directory, articles, resources, search, previews, internal links, homepage, and metadata. Filter before pagination on the server, not through client-side hiding. Tags remain classification and search metadata rather than publishing controls.
- Reuse full-text indexing and Chinese matching rather than another client index or full-body download. Internal links resolve only currently visible site targets, without bypasses through independent shares.
- Reuse the current 30-second refresh and query-error handling. Do not add polling, WebSockets, site versions, or an event bus. The next server request denies invalid targets; clients clear views on failed requests or refresh, without promising instantaneous recall of downloaded text.
- Cloudflare and Docker share visibility and metadata services, with thin template/static-resource/entry adapters. Individual note shares and public forms retain existing policy.

### 3.4 Minimum indexing boundary

Only alias pages of unprotected sites with explicit permission are indexable. Token pages retain the complete shared noindex policy and canonical points to the alias when configured. Protected initial HTML always contains generic sharing information. Indexing defaults off, JSON APIs remain non-indexable, and pages/APIs retain `private, no-store` and `no-referrer`. The client preserves server robots until the selected article request completes; errors and non-indexable pages use the complete shared policy. Other sharing types retain their existing policy.

Initial server HTML contains escaped title, description, canonical URL, and social metadata. Inaccessible articles return a real unavailable status and no-index headers. Use an available logo as the card image or existing brand resources; do not build a screenshot-generation service.

SPA body rendering is a tradeoff, not experimentally equivalent SEO. [Google documentation](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) describes JavaScript rendering and notes that not every crawler executes JavaScript; eligible initial responses must not start with noindex and rely on client removal. Put [Open Graph](https://ogp.me/) metadata in the initial head. A [sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview) can improve discovery, but no measured crawler need establishes it for this iteration, so defer it. Do not promise that every article is or will be indexed.

### 3.5 Author sharing and site management

Notebook context and more menus consistently use “Share notebook.” Directly shared notebooks keep the more button visible. Reopening reuses the original URL/token, with copying, password controls, and Advanced settings that expand in place. Personal settings retain an overview entry. Advanced settings start collapsed and contain homepage, logo, navigation, ordering, and indexing configuration. Collapsing/reopening retains unsaved input. The share dialog has no note management list.

Per-note controls appear in the original note-share dialog and note-list context submenu as “Show in the ‘name’ site.” Parent and child sites have distinct switches, and changes apply immediately without affecting other sites or individual-note shares. Read errors offer retry; failed writes retain the original state. Opening the dialog no longer creates an individual-note share automatically: authors explicitly click “Create individual note link.” Existing links retain copying, passwords, and revocation.

Settings save explicitly. The separate homepage picker searches included notes, supports directory home, and returns to the share dialog when closed. It replaces20 rows per page and supports body-keyword search without a second management list. The historical `/notebooks/:notebookId/site` address retains direct access and refresh, while the share dialog no longer navigates there. This revision adds no tables or columns.

## 4. Whole-plan ablation evidence

The following scripts and raw results remain historical comparisons for the previous tag-filtered, zero-new-table plan. They were neither rerun nor rewritten when explicit exclusions were selected or during implementation. They do not verify the current exclusion table, management endpoints, or UI; see the implementation checklist for product acceptance.

Script: [public-notebook-site-plan-ablation.mjs](../scripts/public-notebook-site-plan-ablation.mjs). Raw results and 42 individual decisions: [public-notebook-site-plan-ablation.json](public-notebook-site-plan-ablation.json). Run `bun scripts/public-notebook-site-plan-ablation.mjs > docs/public-notebook-site-plan-ablation.json`.

### 4.1 Executed comparisons

An in-memory SQLite database built from actual migrations `0001`–`0071` passed **26 model checks and reproduced three expected failures after removing behavior**. Checks include two-column/zero-table migration shape, legacy row fields, tag filtering, body/Chinese-substring search, combined tags, natural ordering, homepage moves/deletion, partial settings writes, alias uniqueness, password/indexing policy, metadata escaping, and payload sizes.

The three counterexamples are: removing server exclusion returns a draft; title-only search loses body matches; filtering after pagination returns an empty page despite visible matches. Retain these behaviors rather than removing them for simplicity.

For a fixed sample of the old tag-based plan, settings occupy 256 bytes at 100/1,000/10,000/50,000 associated notes. This measures the old configuration encoding, not the current six-key object or runtime performance at 50,000 notes. Current exclusion relations are stored separately as rows that grow with the number of excluded notes.

| Synthetic payload | 1,000 notes | 10,000 notes |
| --- | --- | --- |
| Basic directory JSON | 123,894 bytes | 1,248,895 bytes |
| Short excerpts added to every directory item | 229,894 bytes | 2,308,895 bytes |
| One on-demand preview | 125 bytes | 125 bytes |

The same synthetic long article produces a 210,140-byte full response. Keeping lightweight previews has a measured payload rationale: removing the endpoint transfers cost to the initial directory or complete article reads. These are uncompressed JSON sizes; real request counts, compression, network latency, and hover behavior were not measured.

Keep the previous [script](../scripts/public-notebook-site-schema-ablation.mjs) and [raw results](public-notebook-site-schema-ablation.json) unchanged. Its 19 common scenarios and 12 timing groups were not rerun for this review. Its preference for one override table applies only when per-item state is retained.

### 4.2 Requirement mapping and design judgments

The 42 decisions cover section 2's 13 requirement groups, the original 11 fields, override tables, management/public interfaces, SSR/sitemap, theme, renderers, indexing, refresh, caching, cross-runtime design, and verification. Each raw decision identifies executed evidence, source facts, issue alternatives, official documentation, or judgment. Do not describe every decision as a passing runtime test.

The original decisions to remove per-note override storage and the exclusion endpoint are superseded by the explicit-exclusion decision; keep the raw JSON unchanged. Still remove or merge the general item-override model, manual-order endpoints, independent site name/description, scattered display columns, dual ordering settings, redundant site GET, duplicate themes/viewers/indexes, additional refresh, and publication versions.

Retain the selected path for all 13 requirements, current-site per-note exclusions and management operations, live server access filtering, filtering before pagination, existing password protocols, alias uniqueness/resolution, lightweight previews, server metadata, and thin Cloudflare/Docker adapters. Full article SSR, sitemap, and standalone asset upload remain future capabilities, not features proven worthless.

These historical experiments did not verify real UI, password upgrades, page handling through both runtimes, remote D1, crawlers, or concurrency races. Subsequent implementation separately verified local UI, old-route migration compatibility, and both runtime entries. The implementation checklist records that coverage and its remaining limits; model checks do not extend those conclusions.

## 5. Implementation and minimum acceptance

| Phase | Delivery | Acceptance focus |
| --- | --- | --- |
| 1. Reading | Outline, reused theme, code blocks, image/diagram interaction | One real desktop/mobile reading flow covers positioning, copying, zooming, keyboard actions, and focus restoration. No database changes. |
| 2. Settings and discovery | Migration for two columns and the exclusion table, excluded-note management, natural order, homepage, search, preview, and settings saves | Existing-share upgrade and author-to-anonymous-readback flows; real access boundaries and Chinese search. |
| 3. Branding and public pages | Logo/header/footer, aliases, initial metadata, and indexing switch | Token/alias/password/HTML policies agree; each runtime needs only its entry-specific checks. |

After implementation, verify three real flows without automatically stacking per-component unit tests, full integration suites, and repeated reviews:

1. **Old-version upgrade and reading:** fix real old data and expected public content, migrate, then check original tokens, passwords, and grants. Exercise article/code/image/diagram controls in the actual page. Layout may change; defaults must not change existing public scope.
2. **Author edits to visitor readback:** exclude a note and verify no disclosure through directory, direct article, resources, search, previews, links, homepage, or metadata; remove the exclusion and verify normal access returns. Ordinary tag edits must not change exclusion state. The same note in an independent child share follows that share's own settings. Reuse the fixture for exclusions surviving moves out and back, cascade deletion, revocation/recreation, management permissions, and workspace boundaries. Check numeric ordering and filtered pagination; HTTP 200 alone is insufficient.
3. **Aliases and indexing:** check collisions, resolution, canonical API-cookie unlocking, and canonical URLs. Request raw HTML for metadata/status/privacy. Reuse shared-service checks, checking each Cloudflare/Docker entry and its headers; builds do not establish crawler acceptance.

Reuse existing tests and still-applicable results, adding checks only for concrete gaps. Run required `bun run typecheck`, `bun run typecheck:mobile`, and `bun run build:web` when relevant premises change, not repeatedly for documentation or unchanged inputs. Any Android native debugging must use a USB-connected physical device, not an emulator.

Add columns, the exclusion table, and relevant indexes; migrate before deploying the server and preserve shares/tokens. Start with an empty exclusion table. Back up the database and password encryption root. Phase 1 can revert presentation commits. Once per-note exclusions are enabled, an older server ignoring the exclusion table can republish content; retain filtering on rollback or revoke affected sites first. Disabling indexing cannot guarantee immediate removal from external indexes.

Track implementation, automated checks, browser acceptance, commits, pushes, deployment, and release separately. This document records the plan and historical model experiments; the task's change checklist records implementation and acceptance results.
