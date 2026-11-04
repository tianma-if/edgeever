# Automatic output budgets for text generation (#652 PR A)

[简体中文](2026-11-04-ai-auto-output-budget.zh-CN.md)

Related Issue: #652

## Problem and outcome

After #780, text generation still defaulted to a fixed 4096 output tokens: models that support 32K or more output got cut off on long translations, rewrites and continuations, and nothing told the user, so a truncated result could replace the original. This PR implements PR A as agreed in #652:

- Text generation uses an automatic budget by default, based on the limits of the provider or gateway actually connected; a manual budget stays available as an advanced setting and takes priority.
- With known limits the budget follows them; without them it is no longer fixed at 4096.
- An incomplete result (limit reached or stopped) is clearly flagged and cannot replace the original note or selection.

Chunking, continuation, the Web / desktop sidebar body commands and selection translate, and sidebar draft recovery belong to PR B and are out of scope here.

## Allowed changes and acceptance

1. **Reading limits (client):** the client reads the provider's model metadata with GET requests only, which never generate text or cost tokens.
   - Anthropic `GET /models/{id}`: `max_tokens` and `max_input_tokens` (the context window, shared by input and output).
   - Gemini `GET /models/{id}`: `outputTokenLimit` and `inputTokenLimit` (independent).
   - OpenAI-compatible `GET /models`: OpenRouter's `top_provider.max_completion_tokens` and `context_length` (shared window), DeepSeek's `max_output_tokens` and `context_window` (shared window). Without them, LiteLLM's `/model/info` (`max_output_tokens` / `max_input_tokens`, independent).
   - Network, authentication, rate-limit or server errors count as "unknown" and are not reported. A normal response without limits (OpenAI, NewAPI, one-api and similar), or a gateway answering an unsupported metadata path with 400 / 404, is reported as `none` and not read again for 7 days.
2. **Storage (server):** migration `0092` adds the nullable columns `detected_max_output_tokens`, `detected_max_input_tokens`, `detected_context_window_tokens`, `detected_capability_source` and `detected_at` to `ai_models`. New `PUT /api/v1/ai/providers/:providerConfigId/models/:modelConfigId/capabilities` validates values and source, only accepts reports matching the currently saved model ID and Base URL (409 otherwise), and keeps the user-session requirement, workspace isolation and demo / read-only restriction. Changing a service's type or Base URL clears the detected limits of its models.
3. **Budget planning (server prepare, shared pure functions):**
   - A manual budget wins.
   - With known limits, open-ended tasks (continue, expand, custom instructions) may use the available limit; source-sized tasks (translate, proofread, polish, simplify, change tone, shorten) get what the source needs (never below the previous 4096), capped by the available limit.
   - Only a shared input + output window (Anthropic, DeepSeek, OpenRouter) is reduced by the estimated input and a margin; an independent input limit (Gemini, LiteLLM) only checks whether the input fits and never reduces the output budget.
   - Without limits, new clients that opt in (`allowUnboundedOutput: true`) send no output limit and the provider's default applies; Anthropic requires `max_tokens` and keeps 4096; older clients keep 4096.
   - For new clients, `maxOutputTokens` in the prepare response may be `null`; the response adds `outputBudget` (mode, available limit, whether the input fits), and `capabilityTarget` when limits are missing or older than 7 days, asking the client to read and report them.
4. **Client flow (`packages/client`, shared by Web, desktop and Android):** when prepare returns `capabilityTarget`, the client reads the limits, reports them and prepares once more so the same request already uses them. A recognised "output limit too large" 400 (for example Anthropic's `max_tokens: X > Y`) is reported and retried once with that limit; unrecognised errors are not retried. Finish events carry `truncated`, recognising `length`, `max_tokens`, `model_context_window_exceeded` and `MAX_TOKENS`. The Web fallback relay additionally allows only the GET requests for one model's metadata and LiteLLM's `/model/info`.
5. **Truncation protection:** a result counts as incomplete when the provider reports its limit was reached, or when the result opened with the request's start marker but never reached the end marker (a real gateway was seen cutting output and still reporting `stop`). On Android (AI assistant and the editor selection panel) and iOS (AI assistant), an incomplete or stopped result shows a notice and disables "Replace" / "Replace selection"; copy and append / insert still work. iOS decodes a `null` budget and, without a known limit, sends no `max_tokens` / `maxOutputTokens` (Anthropic still does). New strings cover five languages.
6. **Settings (Web / desktop):** the text generation budget placeholder reads "Auto"; the budget dialog shows the detected limits, their source and time, and "Detect limits / Detect again".

## Boundaries, risks and recovery

- Tag suggestion (300) and sidebar (2048) defaults are unchanged, as are manual budget semantics.
- After a server-only upgrade, older clients get the automatic budget (as a number) once limits are detected, and 4096 before that. New clients on an older server do not read limits, request the numeric budget as before, and still flag truncation.
- Worst cases:
  - A wrong limit or estimate asks for more than the provider supports and it returns 400. A recognised error is retried once with the correct limit and remembered; otherwise the error is shown and the user can set a manual budget.
  - With unknown limits no limit is sent, and a gateway's default may be small, so the result is cut off; it is then clearly flagged and cannot replace the original.
- Larger budgets allow longer output, with matching cost and latency. On platforms that reserve credit for `max_tokens` (such as OpenRouter), source-sized tasks still ask only for what they need rather than the full limit.
- Rollback: revert the code. The new columns do not affect older code (it selects explicit `ai_models` columns), so the migration does not need to be reverted.

## Implementation and acceptance

- Automated: shared (limit parsing, truncation reasons, budget planning including the Gemini case where a long input does not reduce the output budget), API (report endpoint validation, permissions and merge rules; prepare results for new / old clients, manual / automatic, shared / independent windows and stale detection; clearing on type or Base URL changes; 0091 → 0092 upgrade), client (per-provider reading, 400 as no limits, prepare again, 400 retry, a missing end marker counting as truncated), the Web relay allowlist, Playwright (the budget dialog shows "Auto" and the detection state) and iOS unit tests (decoding `null`, no limit when unknown, truncation reasons, end marker). `bun run typecheck`, `bun run typecheck:mobile` and `bun run build:web` pass; the only `bun run test` failure is `deployment-entrypoints`, which also fails on `main`; the only `bun run lint` error is in `note-image-export.ts` on `main`.
- Real providers (preview instance, this branch's client calling directly):
  - Limits available: the official DeepSeek API (`deepseek-flash`, output limit 393,216, shared window 1,048,576). Translating and polishing a 40-section Chinese note both requested `max_tokens=45166` and produced 11,415 and 10,694 output tokens, finished normally without truncation, kept all 40 sections and every heading, code block, link and table, with no manual budget.
  - No limits available: an OpenAI-compatible gateway (no limit fields in its model list, recorded as `none`); requests sent no `max_tokens`. DeepSeek V4 Flash's polish produced 8,574 tokens with the structure intact, and both DeepSeek and Claude Haiku 4.5 translations were complete. The gateway cut Claude Haiku 4.5's polish at about 8192 tokens (even with a manual `max_tokens=32000`) while still reporting `stop`; the client flagged it as truncated from the missing end marker. A gateway's own hard cap like this needs PR B's chunking to deliver in full.
- Cross-version (self-hosted SQLite, one data directory): old server (`main`, 0091) → this branch (0092) → rollback to the old server, 29 checks passed, covering this branch's client, the released v2.19.0 client and the Web fallback, against a gateway with limits, one without, and an Anthropic-style 400 retried and remembered at 2048.
- Cloudflare D1 (isolated preview instance): upgraded from 0091 with existing users, models and saved budgets to 0092; configuration and budgets unchanged; old clients still get 4096 and are asked to detect; new clients send no limit; after a report the automatic budget applies (an independent input limit does not reduce output); a manual budget wins. After rolling back to `main`, reads and writes work.
- iOS: Xcode build and unit tests pass on the fork's Actions.
- Not verified: Android on a USB device (awaiting a device test of the preview APK), iOS on a device and its UI interaction, and real requests to the official Gemini / Anthropic / OpenRouter APIs (their parsing is unit-tested).
