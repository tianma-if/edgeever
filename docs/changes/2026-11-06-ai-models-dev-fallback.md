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
   - Otherwise, listings whose model key or `canonical_model_id` equals the ID, or whose canonical model part equals the ID without a `vendor/` prefix. When the canonical ID leads to the original vendor's listing, that listing is used; for example a gateway's `xxxyyy/claude-opus-5-5` uses Anthropic's `claude-opus-5-5`.
   - Without an original listing, each number takes the lower median across the relay listings, so one listing with odd data cannot decide the result.
   - Only a `models/` prefix is removed. Dates, versions and suffixes such as `-thinking` are never guessed; an unmatched model stays `none`.
4. **Mapping**: with `limit.input`, the input and output limits are independent; `context` is also kept as a shared window only when `input + output` exceeds it. Without `input`, `context` is a window shared by input and output. Zero, negative or oversized values are unknown.
5. **Storage**: results are saved with source `models-dev` in the existing `ai_models.detected_*` columns, with the same 7-day lifetime and clearing on configuration changes. A later recognised "output too large" 400 still corrects the output limit through `provider-error` and keeps the source. **No database migration.**
6. **Caching**:
   - Instance (main cache): each model's result is stored on the instance and shared by every device, so the catalogue is read at most once per model every 7 days.
   - Client memory: the parsed compact index is reused for 24 hours without a request, and concurrent lookups share one download. After that it is revalidated with `If-None-Match`, so an unchanged catalogue costs a 304. A failed revalidation keeps using the old index.
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

- Automated: shared (catalogue parsing, mapping, matching, a long input within an independent input limit keeps the output budget; the cases live in `packages/shared/test-fixtures/models-dev/` for reuse by iOS), client (cache reuse, ETag 304, failure backoff, stale copy as fallback, an abort that leaves the shared download running; fallback only on `none`, provider limits first, no fallback when the provider is unreadable; generation reports `models-dev` and uses it in the same request), API (storing and using a `models-dev` report, then a `provider-error` correction).
- Spot checks against the real catalogue (downloaded 2026-11-06, about 8,800 entries) for common IDs such as `gpt-5`, `gpt-4o`, `claude-sonnet-4-5-20250929`, `gemini-2.5-flash`, `deepseek-chat`, `qwen3-max`, `glm-4.6`, `hy3` and `xxxyyy/claude-opus-5-5` resolve to the original vendor's listing or a sensible relay median.
- Not verified: hit rate and end-to-end generation on real gateways, reachability of models.dev from mainland China, timing on an Android device, desktop installers.
