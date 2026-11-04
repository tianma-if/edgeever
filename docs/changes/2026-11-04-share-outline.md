# Document outline for read-only share pages

## Problem and goal

Issue #775 requests an editor-like outline for Web read-only share pages: show the heading hierarchy, jump to sections, and provide “Collapse all headings” and “Expand all headings”. Ordinary `/share/:token` pages lack an outline; public notebook sites have a basic H1–H4 outline without bulk folding.

## Allowed changes

- Reuse one read-only outline in ordinary shares and public notebook sites. Include nonempty H1–H6 headings, matching `EDITOR_HEADING_LEVELS`, with smooth navigation and active-section highlighting. This replaces the original H1–H4 limit, which omitted headings supported by the editor.
- Keep the public notebook site's existing anchor algorithm: locale-lowercase heading text, replace non-letter/number runs with `-`, trim surrounding hyphens, and suffix repeated slugs with their occurrence number. Do not apply NFKC normalization. Preserve existing H1–H4 occurrence numbers, including empty headings, when adding H5/H6 entries so previously shared fragments still resolve.
- Show a desktop right rail and a mobile drawer. Keep the desktop rail visible while the document scrolls; public-page body/root wrappers must not become non-scrolling sticky containers. Preserve the image viewer's body-scroll lock. Hide the outline entry when no nonempty headings exist.
- Provide individual and bulk folding of the outline tree only. Do not fold body content or persist the reading state to notes or the server.
- Retain fragment-link semantics for outline entries, including browser copy/open-link actions; ordinary clicks still navigate within the page. When the selected or initially linked heading is inside closed read-only details blocks, open only its enclosing blocks so the section can be read. Exclude headings still hidden inside closed blocks from active-section tracking.
- Preserve the selected heading's highlight during and after a jump, including short final sections that cannot reach the top of the viewport. Resume position-based highlighting when the reader scrolls the document again, rather than after an arbitrary timeout. Keep the fragment URL unchanged when only the active highlight follows scrolling.
- Preserve body rendering, in-note heading links, image preview, site search, and backlink preview.
- Carry only the #775 feature changes onto the upstream `main` baseline, excluding the deployment Fork's snapshot history and unrelated changes.
- Add browser regression tests for both public layouts: H5/H6 navigation and folding, old full-width and duplicate-heading fragments, mobile navigation, documents without headings, link semantics, headings inside nested closed details, and short final-section highlighting. Include this focused spec in the existing WebKit project to verify drawer-close navigation and incoming fragments with Chromium and WebKit. Run affected tests, typechecks, lint, and the Web build.

## Boundaries and risk

- No share API, token, authentication, password-unlock, body-data, dependency, or database changes.
- No changes to editor outline behavior or persistence. Do not normalize public fragments using the editor's in-note text-link matcher; these are different existing contracts.
- The worst affected behavior is broken section navigation or outline layout in read-only Web pages. Reverting the frontend feature restores the previous rendering without data migration.
- Browser checks must cover the candidate on the upstream baseline; results from the original Fork checkout do not establish integration compatibility.

## Completion check

- Both public layouts use the shared H1–H6 outline. Existing H1–H4 fragment text and occurrence numbers are retained, including full-width characters, duplicate headings, and empty-heading slots.
- Eight Chromium and eight WebKit browser regressions pass against the upstream-baseline frontend and the local Demo API, using real notes and shares (16 tests total). Both layouts cover bulk folding without hiding body headings, H5/H6 navigation, copied old fragments, deep-only mobile outlines, individual folding, navigation after the drawer closes, and hiding the outline after headings are removed. They also verify the desktop rail remains in view, image-viewer scroll locking, hyperlink semantics, and revealing nested details without changing the note revision; hidden headings no longer become the active section.
- Jumps to short final sections and incoming fragments retain the target highlight. Reader wheel input and scroll keys resume position-based tracking, including when focus remains on the clicked outline link. Scrolling leaves the fragment URL unchanged.
- The existing public-notebook browser test for successful article loading also passes, including in-note heading links and image preview. Desktop and narrow-screen renders were visually inspected; opening an outline link in another browser tab was exercised directly.
- The screenshots in `evidence/share-outline.png`, `evidence/share-outline-collapsed.png`, and `evidence/share-outline-mobile.png` use a practical long-form note created in the desktop app and synced to a real Cloudflare instance. The local candidate frontend reads that instance's public API and renders all 21 H1–H6 headings; collapsing the outline leaves all 21 body headings intact. The cloud instance still runs its existing version.
- `evidence/share-outline-final-section.png` uses the same real cloud note and shows the selected penultimate section remaining highlighted at the page bottom. Further reader scrolling resumes highlighting the last section while retaining the selected section's URL.
- Nine hierarchy and in-note heading-link tests pass. Root and mobile typechecks, the Web build, changed-file lint, and whitespace checks pass.
- The candidate contains only the feature, its browser regressions, and this bilingual change record; no Fork snapshot changes, API changes, dependency changes, or migrations are included.
