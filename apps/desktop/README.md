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

## App icon (macOS Dock)

Dock tiles need a complete multi-resolution `.icns` (including 1024px). Do not
point electron-builder at a lone 512 PWA PNG — that produces a thin icon pack
and macOS can show a blank Dock placeholder forever after installs.

Regenerate committed icon assets after changing the brand mark:

```sh
bun run prepare:desktop:icons
```

This writes `apps/desktop/assets/icon.icns` (full ICNS) and `icon.png` (1024
master). Packaging validation rejects incomplete ICNS types. Runtime also calls
`app.dock.setIcon` as a Launch Services / Dock cache fallback.

Preview the committed icon at its real Dock size without starting EdgeEver:

```sh
bun run preview:desktop:icon
```

The temporary preview stays in the Dock until you quit it from the icon's
context menu.

Build an unsigned installer for the current platform with:

```sh
bun run prepare:desktop:icons
bun run build:web
bun run build:desktop:sidecar
CSC_IDENTITY_AUTO_DISCOVERY=false bun run --cwd apps/desktop dist -- --publish never
```

The resulting DMG, ZIP updater package, NSIS installer, or AppImage is written
under `release/desktop`. Formal macOS Releases contain separate `arm64` and
`x64` DMGs; each package includes a Rust sidecar compiled for the same
architecture. The CI workflow accepts optional signing secrets:

On macOS, users can double-click EdgeEver in the mounted DMG and choose
**Install and Launch**. The app moves itself to `Applications`, relaunches the
installed copy, and ejects any mounted EdgeEver installer images so macOS does
not retain duplicate file-association entries. Dragging the app to
`Applications` remains supported; launching the installed copy also performs
the installer-image cleanup.

- `EDGEEVER_MAC_CERTIFICATE_BASE64` and `EDGEEVER_MAC_CERTIFICATE_PASSWORD`
- `EDGEEVER_APPLE_ID`, `EDGEEVER_APPLE_APP_SPECIFIC_PASSWORD`, and `EDGEEVER_APPLE_TEAM_ID`
- `EDGEEVER_WINDOWS_CERTIFICATE_BASE64` and `EDGEEVER_WINDOWS_CERTIFICATE_PASSWORD`

When these secrets are absent, CI produces unsigned verification artifacts.
Private signing material is never committed to the repository.

The workflow keeps `workflow_dispatch` builds as non-publishing verification
runs. When a GitHub Release is published, the workflow first compares it with
the previous formal Release. It rebuilds and publishes the installer through
electron-builder only when Electron, the Rust sidecar, native dependencies,
packaging configuration, or desktop build tooling changed. Web-only Releases
reuse the previous verified arm64/x64 DMGs, updater ZIPs, blockmaps, and
combined update metadata without renaming them, so the macOS runners and
signing pipeline are not scheduled unnecessarily.

The desktop Settings page exposes the sidecar's local backup list. Restoring a
backup creates an additional protective backup first, restores the SQLite
database in place, restores the staged offline attachment directory when the
snapshot contains one, applies any newer migrations, and reloads the workspace.

Packaged macOS builds also expose **Settings → Advanced → Clear local data**.
After an explicit destructive confirmation, EdgeEver stops the local sidecar,
removes every account's local SQLite data, unsynced queue, offline attachments,
caches, backups, settings, and sign-in state, then relaunches into first-run
setup. Server data and files exported outside the app data directory are never
removed by this action.

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
