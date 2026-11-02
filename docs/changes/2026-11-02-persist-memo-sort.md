# Remember the last memo sort mode

[简体中文](2026-11-02-persist-memo-sort.zh-CN.md)

## Problem and outcome

The desktop/Web workspace initializes `memoSortMode` to `updated-desc` on every mount and never saves the selected value. Reopening the app therefore loses the choice even when the user did not change the sort setting. Remember the last selection on the current device, using the same local-preference mechanism as notebook sorting.

Use local persistence because the goal is to remember a device's display preference, without requiring cross-device consistency. Reuse the existing `localStorage` mechanism rather than introducing server-side settings tables, endpoints or a server upgrade dependency.

## Allowed changes and acceptance

1. Persist the existing four modes (`updated-desc`, `created-desc`, `title-asc`, `title-desc`) in `edgeever.memoSort`. Keep one workspace-wide choice per browser origin/desktop profile, matching the current in-memory scope; do not introduce per-notebook/account settings or cloud synchronization.
2. Read the preference in the workspace state's lazy initializer, before the first list query. Write once when the user chooses a sort option, not during note saves, rendering, polling or startup effects. Keep the existing sorting, cache and pagination algorithms, including the #750 repair.
3. Missing/invalid stored values retain the existing `updated-desc` default. If local storage is unavailable, reading uses that default and writing does not block the in-session selection. Do not change or clear other preferences.
4. Add a focused browser regression before implementing the fix: select each mode, reopen the workspace and check the restored selection; any initial network list queries must use that mode (an initialized local mirror can serve lists without a request). Cover an absent/invalid preference and unavailable preference storage. Reuse the existing browser CI job for this test without adding runners or changing check identities. Run the required Web/mobile type checks and Web build.
5. Reuse the confirmed official v2.16.1 restart behavior as the baseline. Exercise a desktop candidate across a full quit/relaunch with a persistent profile, and distinguish actual macOS/Cloudflare validation from browser reloads, package/release acceptance and unverified platforms. Keep user notes, existing workspaces and backup settings intact.

## Boundaries, risks and recovery

The benefit is avoiding a manual sort reset on every launch. The change only adds a small local preference read at workspace initialization and a write after an explicit selection; it adds no database/network read, scan, migration, dependency or background task. Filtering, notebook selection, account/authentication, native Android/iOS clients, backups, installation and updates are unchanged.

The main failure mode is an unavailable local preference store, in which case the current session remains usable and later launches use the old default. Revert the preference wiring to roll back; older versions ignore the additional key and no data migration is required. Windows/Linux native UI and packaged cross-version validation must be reported separately from macOS/browser checks.

## Implementation and acceptance

- `app-helpers.ts` reads, validates and writes the preference; `WorkspaceApp.tsx` connects it to state initialization and the existing sort-selection callback. Sorting, cache, pagination and server code are unchanged. The browser regression uses the existing CI job without additional runners or dependencies. The actual changes match the scope above.
- Before the fix, the focused browser case reproduced the missing preference after selecting A–Z. After the fix, all seven Chromium end-to-end cases passed, covering reopening with each sort mode, absent/invalid values, unavailable storage and preservation of existing preferences.
- The macOS candidate reused the official v2.16.1 native main process and Sidecar, loaded the candidate Web build through a file entry and connected to a real Cloudflare workspace. After choosing A–Z, fully quitting and relaunching, the menu retained A–Z and the workspace showed a synced state. The official client was restored afterward; the installed package was not replaced.
- `bun run typecheck`, `bun run typecheck:mobile`, `EDGE_EVER_DESKTOP_BUILD=1 bun run build:web` and lint for the changed files passed.
- Windows/Linux native UI, packaged cross-version upgrades and remote CI remain unverified. This change has not deployed the server or released a client.
