# Release Guide

## Run a Release

Run from a clean `main` branch on macOS that matches `origin/main`:

```bash
bun run release -- \
  --bump patch \
  --issue-title "Improve the release workflow" \
  --label enhancement \
  --change-en "Run required release checks in parallel." \
  --change-zh "并行执行发布所需检查。" \
  --change-commit "abcdef1"
```

Repeat `--change-en`, `--change-zh`, and `--change-commit` as matching groups.
One change may cover multiple comma-separated commits:

```bash
--change-commit "abcdef1,1234567"
```

Every commit since the previous formal Release must be covered. Exclude a
non-user-facing commit with a concrete reason:

```bash
--ignore-commit "89abcde:test-only coverage"
```

The coverage audit runs before any local or GitHub mutation. Its mapping is
stored in the tracking Issue, not in the public Release notes. Public notes
contain only user-visible changes, impact, and necessary migration guidance.

Use `--dry-run` to inspect commit coverage, the native rebuild plan, and notes.
After publication, the command does not download, install, or launch the macOS
application. Existing desktop installations receive new versions through the
in-app automatic updater. Pass `--install-desktop` explicitly only when the
previous installation check is actually needed.

## EdgeEver-Specific Behavior

- Stable tags and Release titles use `vX.Y.Z`. Pass `--bump` explicitly and
  follow SemVer; do not compress user-visible new capabilities or new platforms
  into `patch` for release cadence (see `AGENTS.md`).
- The root version identifies the product Release. Native marketing versions
  change only when that native runtime is rebuilt. Android `versionCode` and
  iOS build numbers remain independent, monotonically increasing identifiers.
- A formal Release contains macOS arm64 and x64 DMGs, architecture-specific
  updater ZIPs, and an Android arm64 APK. Unchanged native assets are reused
  with their original filenames, versions, and checksums.
- Desktop and Android update checks use the version embedded in the applicable
  Release asset rather than the overall GitHub tag. This prevents a Web-only or
  API-only Release from prompting an unnecessary native update.
- The script creates the tracking Issue and Draft Release, validates or reuses
  native assets, prepares the multi-platform Docker image in both GHCR and the
  public Tencent TCR mirror, publishes, and closes the Issue without installing
  the desktop application by default; installation remains available as an
  explicit option.
  Demo deployment continues independently after its Actions URL is printed.
- Mobile store delivery is not part of this command. See
  [Mobile Store Delivery](store-delivery.md).

## Registry Credentials

The official repository must define `TENCENT_TCR_USERNAME` and
`TENCENT_TCR_PASSWORD` Actions secrets. For the TCR Personal Edition registry,
the username is the Tencent Cloud account ID and the password is the fixed
registry password initialized in the TCR console. Draft preparation publishes
the same tags to GHCR and TCR; both registries are checked anonymously before
the Release can be published.

## Failure and Resume

- Validation, Draft asset, or Docker image failures leave the Release unpublished.
- Rerunning the same command resumes a matching Draft created by an interrupted
  run instead of creating another Issue, commit, or Release.
- A failed post-publication native or Docker audit attempts to return the Release to
  Draft and leaves the Issue open.
- If an explicit application installation fails, the script restores the previous
  app from its macOS Trash backup when possible.
