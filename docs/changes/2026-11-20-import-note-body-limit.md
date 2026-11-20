# Oversized note error during import

[简体中文](2026-11-20-import-note-body-limit.zh-CN.md)

## Goal

A 2.35 MB ENEX containing one large text note reproduces [#868](https://github.com/tianma-if/edgeever/issues/868) on v2.30.0 with local D1. The initial note create returns HTTP 200 with a failed item and `D1_ERROR: string or blob too big: SQLITE_TOOBIG`. The import dialog treats the failure as an unconfirmed write even though the destination notebook is empty.

## Change and acceptance

The shared Web and desktop import flow recognizes `SQLITE_TOOBIG` in a D1 error on the initial create's failed item. It shows a localized message naming the oversized note body and reports a confirmed failure. This uses the existing response so it also works with v2.30.0 servers. Replay the observed response in the import integration test and import the original synthetic fixture through Web against local D1. Check the visible message, the failed count, and the empty destination notebook.

## Boundaries

The import formats, storage limits, API contract, source contents, and destination notebook lifecycle retain their existing behavior. The same task keeps its existing retry and idempotency rules. Other failures, including lost create responses and uncertain attachment or body updates, retain their existing handling. Verify a lost create response and same-task retry with the existing integration test. Import a similarly sized ENEX containing a short body and an attachment as a control.

Incorrect classification could give users false confidence that a write failed. Matching the explicit D1 size error on the failed create item limits that risk. Rollback reverts the client change. Native desktop packaging and the reporter's instance are outside the local acceptance environment.

## Verification

- Web with local D1 displayed the localized body size error and 0 of 1 notes imported. The API returned the original failed item and D1 reported zero notes in the destination. The attachment control imported one note and one 1,782,000-byte attachment.
- The import integration and controller suites passed all 109 tests. They cover the observed D1 response, a lost create response and retry without a duplicate note, and uncertain attachment and final update responses. Web build and both type checks passed.
