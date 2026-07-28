# EdgeEver desktop sidecar

The sidecar is a private local process owned by the Electron main process. It
communicates over newline-delimited JSON-RPC on stdin/stdout and owns the
desktop SQLite data directory.

Build locally with:

```sh
cargo build --manifest-path crates/desktop-sidecar/Cargo.toml
```

The first milestone exposes `system.info`, `storage.health`, and
`app.shutdown`. Domain storage and sync methods will be added behind the same
protocol without exposing Node.js APIs to the renderer.
