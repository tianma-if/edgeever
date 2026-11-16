# Model limit detection on iOS (#652)

[简体中文](2026-11-09-ios-model-limits.zh-CN.md)

Related Issue: #652

## Problem and goal

Since #791 and #809, Web, desktop and Android share `packages/client`: when a model's limits are missing or stale, the client reads the provider's metadata, falls back to models.dev when there is none, and saves the result on the instance; a recognised "output limit too large" 400 is corrected and retried once.

The native iOS client (Swift) had none of this: it ignored `capabilityTarget` / `detectCapabilities` from prepare, never detected limits, and surfaced such a 400 as an error. For iOS-only users a model's limits stayed unknown (no output limit was sent; Anthropic stayed at 4096), and a cached limit that was too high could not be corrected from iOS.

The iOS client now behaves like the other clients.

## Allowed changes and acceptance

1. **Decoding**: `AiPreparedGeneration` decodes `capabilityTarget` and `detectCapabilities`; an older server sends neither, and nothing is detected.
2. **Detection (`AiModelCapabilities.swift`, `AiModelCapabilityDetector.swift`)**: the same rules as `packages/shared/src/ai-model-capabilities.ts`, `ai-models-dev.ts` and `packages/client/src/ai-model-capabilities-direct.ts`.
   - Provider metadata: the Anthropic and Gemini single-model endpoints; the OpenAI-compatible `/models` list (OpenRouter and DeepSeek formats), then LiteLLM `/model/info`. Shared windows and independent input and output limits are kept apart.
   - When the provider answers without any limits, models.dev fills in: exact matching, an unknown prefix is never removed.
   - Network, authentication, rate-limit and server errors mean "unknown"; nothing is reported. The same holds for `/model/info`: only an unsupported path (400, 404 and the like) means "no limits", so a temporary failure never replaces a limit the instance already has.
   - Detection requests carry the model key and never follow a redirect (as `redirect: "error"` in the shared client); a redirect counts as "unknown" and its target receives nothing. Generation and tag suggestion requests to the model service no longer follow redirects either and report a failed request instead (iOS used to follow them with the key; Web, desktop and Android already refused).
   - The whole detection (metadata plus models.dev) takes at most 8 seconds; on timeout the result is "unknown", nothing is reported, and this generation uses the first prepare.
3. **models.dev cache**: the parsed index stays in memory for 24 hours, then is revalidated with `If-None-Match` (an unchanged catalogue costs a 304); a 5-second timeout; after a failure it is not retried for 10 minutes, and a failed revalidation keeps the old index; concurrent lookups share one download. Nothing is written to local storage.
4. **Generation**: when prepare asks for detection, the client reads the limits, reports them (`PUT .../capabilities`) and, when there are any, prepares again so this request already uses them; fresh limits are not read again. A recognised "output limit too large" 400 is retried once with the accepted limit, which is reported as `provider-error`.
5. **Shared client fix**: `packages/client` used to treat authentication, rate-limit, server and network errors on `/model/info` as "no limits" and report `none`; like iOS, they now mean "unknown" and nothing is reported.
6. **Both clients agree**: the provider metadata and error parsing cases move to `packages/shared/test-fixtures/model-capabilities/`, and together with `packages/shared/test-fixtures/models-dev/` are read by both the TypeScript and the Swift tests.
7. **Project file**: `EdgeEver.xcodeproj` is regenerated with XcodeGen for the new files; the hand-added TOTP file entries are renumbered to XcodeGen's form, with no change to what is built.

## Unchanged boundaries, risks and recovery

- Server, Web, desktop and Android are unchanged; no database migration.
- A new iOS client with an older server: no `capabilityTarget` means no detection, as before. A server older than #809 rejects `models-dev` reports, which iOS ignores; generation is unaffected.
- A gateway whose generation endpoint redirects (for example http to https) now fails on iOS, as it already does on the other clients; the Base URL has to point at the final address.
- A gateway whose `/model/info` answers 401/403 for ordinary keys is now detected again whenever limits are missing (two extra metadata requests each time) instead of being recorded as "no limits" for seven days.
- Worst case: limits read too high make the first request fail with a 400 that one retry corrects; limits read too low only cause more parts. When limits are missing or stale, detection runs before generating for at most 8 seconds.
- Rollback: revert the iOS code.

## Implementation and acceptance

- Automated: Swift unit tests (the shared provider metadata, error and models.dev cases; request paths and headers per provider; fallback only on "no limits", provider limits first, no fallback when the provider is unreadable, no match for unknown prefixes; the catalogue's shared download, 24-hour reuse, ETag 304 and failure backoff; a single retry and report on an "output limit too large" 400; redirects not followed by detection, generation or tag suggestions, and their target never requested; no report and immediate generation after a detection timeout; `/model/info` 401/403/429/500/503 as "unknown"; the full generation flow of detecting, reporting and preparing again, with the request using the new limit; no detection while limits are fresh). The TypeScript tests now read the shared cases too, plus a case for temporary `/model/info` failures.
- Against the real models.dev catalogue (about 8,800 entries), Swift and TypeScript return identical results for all 4,234 model IDs.
- Not verified: an iOS device.
