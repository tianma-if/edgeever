# Keep desktop workspaces available during server outages

## Problem and change

Desktop startup previously reused a cached authenticated session only when `navigator.onLine` reported offline. A reachable server returning HTTP 500/503 therefore prevented access to the existing local workspace. A separate session confirmation path treated failed requests and malformed responses as confirmation of session loss and could clear the cached identity and secure token.

`App` now loads its session through one tested workspace loader. An established desktop account remains available on server 5xx, request timeout responses, throttling, network failures and malformed session responses, without relying on the operating system's connectivity flag. Local editing continues through the existing SQLite repository and durable outbox. The server must still authenticate every remote request; this fallback grants no remote permissions.

Startup probes return their own unauthenticated result without clearing their in-flight query. Background revocation retains the observed session query while clearing other account queries, avoiding a stuck startup screen. Session-loss confirmation requires an explicit rejection. Unknown results preserve the cached identity and credential. Confirmation requests are deduplicated per instance/credential, and late responses cannot invalidate replacement credentials or a switched instance. A valid unauthenticated session or explicit session-endpoint 401 still requires login. First launch without a cached account does not gain offline access.

## Risk and rollback

The main risk is using an incorrect account identity or retaining it after confirmed revocation. Instance/credential checks and existing account-scope isolation remain authoritative. Cache format, secure credential storage, local schema, migrations, synchronization protocol and installer/updater code are unchanged. Revert the loader and confirmation changes to roll back; do not delete local profiles or pending outbox records.

## Verification

The reusable native regression runs a real authenticated API on isolated SQLite, a released old desktop application, and a fixed packaged application against the same temporary profile:

```sh
node tests/desktop-offline-upgrade.integration.mjs /path/to/old/executable /path/to/fixed/executable
```

It establishes the old client's login and local note through the UI, reproduces the old HTTP 500 login screen, then checks local UI editing after upgrade, persistence across a full native restart with HTTP 503, a route 401 whose session confirmation fails, recovery synchronization of all queued edits, and actual server-side session revocation. The test retains screenshots and a result manifest in its printed temporary evidence directory. It never accesses production services or the owner's profile.

## Executed verification

- macOS arm64, formal v2.16.1 native host and sidecar; Electron 44.7.0 / Node 24.21.0. The candidate changes the production renderer only, retains the released host/sidecar, and is Developer ID signed and Apple notarized. Both bundles still display 2.16.1 because this is a test candidate, not a published release.
- Seven native scenarios pass on the same old-created profile: login/local persistence; baseline `http_500`; upgrade plus offline UI editing under HTTP 500; full restart and editing under HTTP 503; route 401 with failed confirmation; uploading every queued edit with the unchanged credential after recovery; real session revocation while running and after restart, followed by reauthentication and reading the original local note.
- The fault responses are real HTTP responses from a loopback fixture with normal CORS headers, around the real authenticated API and SQLite storage. Neither renderer API methods nor the desktop bridge are mocked. No production D1 load or user-profile changes were used.
- 101 API tests pass, including first-launch denial, invalid responses, instance changes, explicit rejection, and late/concurrent credential replacement. Full non-E2E suites pass: 4,566 + 17 + 24 tests, with one Windows-only cleanup test skipped on macOS. Web/API typecheck, mobile typecheck and production Web build pass.
- [Native results](evidence/2026-10-31-desktop-offline-session/results.json) record the recovered server content and zero pending/syncing/error/conflict items. Screenshots show the [old 500 login screen](evidence/2026-10-31-desktop-offline-session/old-500-login.png), [local editing during HTTP 500](evidence/2026-10-31-desktop-offline-session/fixed-500-local-edit.png), and [recovered workspace](evidence/2026-10-31-desktop-offline-session/fixed-recovered.png).

Windows/Linux native execution, signed installer replacement and updater transport were not verified in this change. There is no new schema migration, release publication or installation over the owner's application. If an older client already erased its identity and credential, this change cannot safely reconstruct them; successful authentication is required to reopen that account's existing local data.
