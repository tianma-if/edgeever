# Flush queued local edits before refreshing a table

## Problem and goal

The web client saves locally first: a document save writes IndexedDB and queues
`memo.update:<id>`, while the `PATCH` to the API is deferred
(`DEFERRED_MEMO_SYNC_DELAY_MS`, 30 seconds by default). The "refresh" button treats
`dirty === false` as "nothing to save" and replaces the editor with the server copy.

That makes a fresh table disappear: create a table, leave it queued, press refresh, and the
old server snapshot replaces the local base. A full browser reload is unaffected because the
local mirror wins, so only the in-panel refresh drops the change. The single-table editor
(`TableEditorPane`) shares the same latent bug.

Goal: refresh must either deliver the queued change before trusting the server snapshot, or
refuse and keep the local document — never overwrite unsynced edits with a stale copy.

## Allowed changes and acceptance

- `apps/web/src/lib/sync-queue.ts` gains two exports:
  - `hasPendingMemoUpdate(memoId)` looks up the `memo.update:<id>` sync queue record;
  - `flushPendingMemoUpdate(memoId, { timeoutMs = 5000 })` returns `false` when offline,
    otherwise dispatches `edgeever:sync-queue-changed` so the sync lifecycle runs the queue,
    then polls every 150 ms until the record is gone or the timeout expires.
- The refresh handlers in `apps/web/src/components/base/BaseEditorPane.tsx` and
  `apps/web/src/components/TableEditorPane.tsx` call `flushPendingMemoUpdate(memo.id)` before
  `api.getMemo`; on `false` they surface `structuredTable.refreshPending` and return without
  touching the local document.
- Nine catalogs add `structuredTable.refreshPending` after `refreshError`.
- `tests/e2e/structured-table-base.spec.ts` asserts that refresh right after creating the third
  table keeps three tables (it dropped to two before the fix), and a second case covers both the
  delivered-queue path and a stuck queue (blocked `PATCH`) where refresh only warns with
  `structuredTable.refreshPending` and keeps all three tables.

Acceptance: creating a table and immediately refreshing keeps it; the server eventually receives
the change; offline or conflicted refreshes only warn and leave local content untouched.

## Unchanged

- The 30-second deferred sync, queue format, conflict handling and offline behaviour.
- Full page reloads, document switching and autosave semantics.
- Panel layout, button placement and every other toolbar action.

## Verification

- `bun run lint`: `Found 0 warnings and 0 errors.` (1866 files)
- `bun run typecheck`, `bun run typecheck:mobile`, `bun run build:web`: pass
- `bun test packages/shared/src/i18n`: 8 pass (including the order-sensitive catalog check)
- `tests/e2e/structured-table-base.spec.ts`: 2 cases pass (28.5 s / 14.9 s)
- Remaining table specs (base-fields, narrow, option-colors, header-controls, image-preview,
  mvp, virtual-grid): pass

Not verified: manual refresh on a real offline device or while a conflict dialog is open. The
suite simulates an undeliverable queue by aborting `PATCH`, and `isBrowserOffline()` is always
false on loopback origins, so true disconnection is not covered.
