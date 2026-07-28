# Desktop performance baseline

The desktop app must remain a local-first application. Remote network latency
must not be part of the critical path for opening or editing a note.

## Acceptance targets

| Operation | Target |
| --- | ---: |
| Sidecar ready after process spawn | `< 500 ms` |
| Local SQLite health request | `< 20 ms` |
| Existing local memo list query | `< 50 ms` |
| Existing local memo detail query | `< 20 ms` |
| Create/edit local memo acknowledgement | `< 50 ms` |
| Cloud sync | Background only |

The Web/PWA build keeps Mermaid, diagram renderer, code-highlighting, and
editor-only Tiptap/ProseMirror chunks out of both the service-worker precache
and the initial HTML `modulepreload` list. They load and cache on first use
instead, so ordinary note-list startup does not pay for optional editor/diagram
support. The initial modulepreload list is also capped at 700 KiB uncompressed;
the build verifier reports the measured bytes and fails if this critical-path
budget regresses.

Remote resource blobs use a separate 90-day, 500-entry cache-first runtime
cache. When the browser is offline, newly attached files are written to the
same Cache Storage namespace under a local resource URL, added to the local
resource mirror, and queued for upload. The sync worker uploads the bytes,
rewrites memo JSON/Markdown references, and only then removes the local blob.

## Repeatable checks

Build and benchmark the sidecar:

```sh
cargo build --manifest-path crates/desktop-sidecar/Cargo.toml --release
EDGE_EVER_SIDECAR_PATH="$PWD/crates/desktop-sidecar/target/release/edgeever-sidecar" \
  bun run benchmark:desktop:sidecar
```

Build an unsigned local desktop bundle and inspect that the bundle contains
the Web renderer, migrations, and sidecar:

```sh
bun run build:web
cargo build --manifest-path crates/desktop-sidecar/Cargo.toml --release
CSC_IDENTITY_AUTO_DISCOVERY=false \
  bun --cwd apps/desktop run dist -- --dir
```

The benchmark exercises the same local domain RPCs used by the desktop
renderer: notebook discovery, memo creation, memo list, and memo detail. Its
`thresholds` object is suitable for CI gating; remote sync is deliberately not
included in the interactive critical path.

Verify that optional editor and diagram chunks stay out of the initial PWA
precache and HTML modulepreload list:

```sh
bun run build:web
bun run verify:web-performance
```
