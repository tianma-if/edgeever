# EdgeEver Desktop

The desktop application deliberately reuses the Web renderer from `apps/web`.
Electron owns the window and OS lifecycle; the Rust sidecar owns local SQLite
and native data services. The renderer never receives Node.js access.

Development prerequisites:

- Bun dependencies installed with `bun install`
- Rust toolchain (`cargo`) installed
- Web dev server available at `http://127.0.0.1:5173`
- Debug sidecar built at `crates/desktop-sidecar/target/debug/edgeever-sidecar`

Run the shell with:

```sh
bun run dev:desktop
```

The sidecar can be overridden for development with
`EDGE_EVER_SIDECAR_PATH=/absolute/path/to/edgeever-sidecar`.

Build an unsigned installer for the current platform with:

```sh
bun run build:web
bun run build:desktop:sidecar
CSC_IDENTITY_AUTO_DISCOVERY=false bun run --cwd apps/desktop dist -- --publish never
```

The resulting DMG, NSIS installer, or AppImage is written under
`release/desktop`. The CI workflow accepts optional signing secrets:

- `EDGEEVER_MAC_CERTIFICATE_BASE64` and `EDGEEVER_MAC_CERTIFICATE_PASSWORD`
- `EDGEEVER_APPLE_ID`, `EDGEEVER_APPLE_APP_SPECIFIC_PASSWORD`, and `EDGEEVER_APPLE_TEAM_ID`
- `EDGEEVER_WINDOWS_CERTIFICATE_BASE64` and `EDGEEVER_WINDOWS_CERTIFICATE_PASSWORD`

When these secrets are absent, CI produces unsigned verification artifacts.
Private signing material is never committed to the repository.

The workflow keeps `workflow_dispatch` builds as non-publishing verification
runs. When a GitHub Release is published, each platform job publishes its
installer and update metadata to that release through electron-builder.

The desktop Settings page exposes the sidecar's local backup list. Restoring a
backup creates an additional protective backup first, restores the SQLite
database in place, restores the staged offline attachment directory when the
snapshot contains one, applies any newer migrations, and reloads the workspace.

Local SQLite data, backups, staged attachments, and resource cache are scoped
by the configured instance and authenticated user. Existing pre-scope data is
migrated to the first authenticated account that opens the upgraded desktop
app.

On Unix-like systems the sidecar also enforces private permissions for its data
directory (0700) and SQLite/backup files (0600); Windows uses the platform's
user-data ACLs.

On startup the sidecar receives the repository `migrations/` directory and
applies unapplied SQL files into the per-user SQLite database. Migration files
are never copied into the user data directory or modified in place.

Main-process diagnostics are written to `userData/logs/desktop.log` and rotate
at 5 MiB, retaining one `.1` archive so long-running installations cannot grow
logs without bound.

If the sidecar exits unexpectedly, Electron records the exit and retries it
with exponential backoff (up to 30 seconds). Intentional shutdowns and account
or instance switches stop the process without scheduling a restart.
