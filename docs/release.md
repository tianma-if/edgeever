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
  native assets, prepares and audits the multi-platform GHCR image, publishes,
  and closes the Issue without installing
  the desktop application by default; installation remains available as an
  explicit option.
  Demo deployment continues independently after its Actions URL is printed.
- A separate workflow sends the same verified Git commit to CNB. CNB builds and
  audits the public Tencent TCR image inside Tencent Cloud after the formal
  Release is published. Its duration or failure does not block the GitHub
  Release or return a published version to Draft.
- This command does not authorize or run mobile store delivery itself. After
  Draft native assets are prepared, publication is blocked unless the Android
  APK uses the Google Play app-signing certificate. If that gate fails, the
  Release remains a Draft. Run
  `bun run publish:stores -- --release vX.Y.Z --platform android --android-track production`
  for that Draft, then rerun the original release command to resume. See
  [Mobile Store Delivery](store-delivery.md).

## Registry Credentials

The official GitHub repository must define the `CNB_TCR_BUILD_PUSH_TOKEN`
Actions secret with write access only to the CNB source mirror. The private CNB
key repository provides `TCR_USERNAME` and `TCR_PASSWORD` to the trusted
`push` and `tag_push` pipelines. For TCR Personal Edition, the username is the
Tencent Cloud account ID and the password is the fixed registry password
initialized in the TCR console. GHCR is the blocking Release gate. CNB builds
TCR from the same Git commit, publishes the same public tags asynchronously,
and independently verifies anonymous access and both supported architectures.
Independent builds are not required to have the same registry digest.

## Failure and Resume

- Validation, Draft asset, or GHCR image failures leave the Release unpublished.
- An asynchronous CNB/TCR build failure leaves the formal Release intact and is
  repaired or rerun independently.
- Rerunning the same command resumes a matching Draft created by an interrupted
  run instead of creating another Issue, commit, or Release.
- A failed post-publication native or GHCR audit attempts to return the Release to
  Draft and leaves the Issue open.
- If an explicit application installation fails, the script restores the previous
  app from its macOS Trash backup when possible.
