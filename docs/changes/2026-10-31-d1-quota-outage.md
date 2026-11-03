# D1 daily quota outage diagnostics

## Observed incident

On 2026-10-31, the desktop login screen reported `http_500` for `tianma.edgeever.org`. Read-only checks found `/api/release` still reporting server version 2.16.0, `/api/health` returning 500, and the unauthenticated session probe returning 200. Worker logs for the failing health request explicitly reported `D1_ERROR: Your account has exceeded D1's free tier daily row read limit`. The database check failed before login; these observations do not attribute the historical reads to a particular operation or establish data loss.

The prior release's Demo deployment had already failed with the same account-level quota error. Release artifact validation did not establish readiness of this personal instance. Updating the desktop application does not deploy the server-side read-budget fixes.

## Product change

Recognize explicit D1 daily read/write quota errors, including nested causes, and return HTTP 503 with `database_daily_quota_exceeded`. Web/desktop login translates this category into an actionable message in all five supported locales. Unrelated transport, schema, storage and per-query errors retain their existing classification. No underlying query or provider error details are returned to the client.

This only corrects diagnosis. It does not restore exhausted quota, bypass authentication, change storage, apply migrations, or deploy a server. The provider-neutral business paths remain unchanged; recognition of a provider error is confined to error handling.

## Recovery and verification

Cloudflare documents that free daily quotas reset at 00:00 UTC and that upgrading Workers removes daily read/write limits, usually within minutes: <https://developers.cloudflare.com/d1/platform/pricing/>. For this incident, the next reset is 2026-11-01 08:00 Asia/Shanghai. A paid upgrade requires the owner's explicit decision. Once queries are available, the instance still needs the normal server upgrade with migration 0084 and health/login validation.

Focused tests cover both quota types, wrapped causes, diagnostic redaction, unrelated errors, cycles, and login/session message selection. Required checks are Web/API typecheck, mobile typecheck and Web production build. No live old-to-new server upgrade, production migration, paid subscription change, or restored service has been verified for this diagnostic patch. Reverting the error classifier and message changes rolls it back without a data migration.
