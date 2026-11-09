# models.dev as a fallback for model limits (#652)

[简体中文](2026-11-06-ai-models-dev-fallback.zh-CN.md)

Related Issue: #652

## Problem and goal

Since #791, clients read the provider's model metadata to learn the output limit and context window. The official OpenAI API and many gateways (NewAPI, one-api and others) list models without limits, so detection records `none`: requests are sent without an output limit, Anthropic stays at 4096, and long tasks cannot be sized into parts.

When the provider reports no limits at all, EdgeEver now falls back to the public [models.dev](https://github.com/anomalyco/models.dev) catalogue.

## Allowed changes and acceptance

1. **When and in what order**: models.dev is read only when the provider's metadata endpoint answered without any limits (`none`). The provider's own limits always win, and the two are never mixed. If the provider metadata cannot be read (network, authentication, rate-limit or server errors) the result stays "unknown" and the catalogue is not used.
2. **Where it runs**: the client (`packages/client`, shared by Web, desktop and Android) downloads `https://models.dev/api.json`. The catalogue allows any origin, so it is fetched directly, never through the instance's model relay. The whole catalogue is downloaded, so no model ID or service address is sent. The server never contacts models.dev.
3. **Matching** (`packages/shared/src/ai-models-dev.ts`, case-insensitive, exact only, in order):
   - The catalogue provider whose `api` host matches the Base URL (such as `api.deepseek.com` or `openrouter.ai`); `api.openai.com`, or the Anthropic and Gemini service types, map to the official entries. A hit uses that provider's own listing.
   - Otherwise, listings whose model key or `canonical_model_id` equals the ID exactly; an ID without a `vendor/` prefix may also match the canonical model part. When the canonical IDs those listings record lead to the original vendor's listing, that listing is used; for example `openai/gpt-4o-mini` uses OpenAI's `gpt-4o-mini`.
   - An unknown prefix is never removed to find a match: when the catalogue does not record the full ID `my-team/gpt-5`, it does not take OpenAI `gpt-5`'s limits and stays `none`. What a gateway serves behind an unknown prefix cannot be confirmed, and the result is saved on the instance for every client.
   - Without an original listing, each number takes the lower median across the relay listings, so one listing with odd data cannot decide the result.
   - Only a `models/` prefix is removed. Dates, versions and suffixes such as `-thinking` are never guessed; an unmatched model stays `none`.
4. **Mapping**: with `limit.input`, the input and output limits are independent; `context` is also kept as a shared window only when `input + output` exceeds it. Without `input`, `context` is a window shared by input and output. Zero, negative or oversized values are unknown.
5. **Storage**: results are saved with source `models-dev` in the existing `ai_models.detected_*` columns, with the same 7-day lifetime and clearing on configuration changes. A later recognised "output too large" 400 still corrects the output limit through `provider-error` and keeps the source. **No database migration.**
6. **Caching**:
   - Instance (main cache): each model's result is stored on the instance and shared by every device, so the catalogue is read at most once per model every 7 days.
   - Client memory: the parsed compact index is reused for 24 hours without a request, and concurrent lookups share one download. After that it is requested again: where the ETag is readable (Android) the request carries `If-None-Match`, so an unchanged catalogue costs a 304; models.dev does not expose ETag to browsers, so Web and desktop send a plain GET and rely on the browser's own HTTP cache revalidation. A failed request keeps using the old index.
   - Failures: a 5-second timeout, and the user's abort is honoured. After a failure the catalogue is not retried for 10 minutes and this detection records `none`. "Detect again" in settings retries at any time.
   - The catalogue is not stored in the local database.
7. **Settings**: the source is shown as "the public models.dev catalogue (reference values)" in all 9 interface languages.

## Unchanged boundaries, risks and recovery

- The native iOS app does not read limits yet; that is unchanged here and follows in a separate PR. Limits saved by other clients are still used for iOS through prepare.
- A new client with an older server: the older server rejects the `models-dev` source and behaviour is as before.
- Worst case: the catalogue lists official limits, and a third-party gateway may allow less. A recognised 400 is corrected automatically once; silent truncation is flagged as incomplete and blocks replacing the original. Values that are too low only cause more parts.
- Where models.dev is unreachable, the first detection waits at most 5 extra seconds, then records `none` and does not ask again for 7 days.
- Rollback: revert the code. Older code treats the unknown `models-dev` source as `none`, so budgets return to the previous behaviour.

## Implementation and acceptance

- Automated: shared (catalogue parsing, mapping, matching, a long input within an independent input limit keeps the output budget; the cases live in `packages/shared/test-fixtures/models-dev/` for reuse by iOS), client (cache reuse, ETag 304 (Android), failure backoff, stale copy as fallback, an abort that leaves the shared download running; fallback only on `none`, provider limits first, no fallback when the provider is unreadable; generation reports `models-dev` and uses it in the same request), API (storing and using a `models-dev` report, then a `provider-error` correction).
- Spot checks against the real catalogue (downloaded 2026-11-06, about 8,800 entries) for common IDs such as `gpt-5`, `gpt-4o`, `claude-sonnet-4-5-20250929`, `gemini-2.5-flash`, `deepseek-chat`, `qwen3-max`, `glm-4.6`, `hy3` resolve to the original vendor's listing or a sensible relay median; prefixed IDs the catalogue does not record, such as `my-team/gpt-5` and `xxxyyy/claude-opus-5-5`, do not match.
- Real services (isolated preview instance): the Android client (instabox Android 14 container, x86_64 preview APK) detected and reported limits that started empty. With a mock gateway whose model list has no limits, `gpt-5` was saved as `models-dev` and requested `max_tokens=128000`, while the unmatched `my-team-model` sent no limit (after the matching rule was tightened in review, a recheck with the current client code saved `xxxyyy/claude-opus-5-5` as `none`). On a real third-party gateway that reports `none`, the OpenAI-compatible, Anthropic and Gemini protocols all got limits from the catalogue and completed; 39 of its 56 models matched, nearly all misses being image or video models.
- Web and desktop: Chromium on the preview instance's live build, and a Linux x64 AppImage built from this branch (page origin `edgeever-app://app`), show the correct source label in the Chinese and English settings dialogs; "Detect again" requests models.dev directly from the page (200, not blocked by CORS, not relayed through the instance) and saves the limits.
- models.dev is reachable from mainland China.
- Not verified: a USB device (instabox is a container and does not replace device testing), macOS and Windows desktop installers, the interface in the other 7 languages.
