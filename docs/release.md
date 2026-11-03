# Release Guide

## Run a Release

Run from a clean `main` branch on macOS that matches `origin/main`:

For any Release that rebuilds desktop assets, first point the release shell at
the repository-external Ed25519 key used for the Windows update manifest:

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

```bash
bun run release -- \
  --bump patch \
  --issue-title "Improve the release workflow" \
  --label enhancement \
  --change-en "Run required release checks in parallel." \
  --change-zh "并行执行发布所需检查。" \
  --change-locale "ja:必要なリリースチェックを並列実行します。" \
  --change-commit "abcdef1" \
  --change-issue "123:en"
```

Repeat `--change-en`, `--change-zh`, `--change-locale ja:`, `--change-commit`, and `--change-issue` as matching groups.
Japanese What's New is required because the App Store listing includes Japanese.
One change may cover multiple comma-separated commits:

```bash
--change-commit "abcdef1,1234567"
```

Every commit since the previous formal Release must be covered. Exclude a
non-user-facing commit with a concrete reason:

```bash
--ignore-commit "89abcde:test-only coverage"
```

The coverage audit runs before any local or GitHub mutation; its mapping is
stored in the tracking Issue. Use `--dry-run` to preview commit coverage, the
native rebuild plan, and Release notes.

### Automatic Follow-up for Resolved Issues

Each change requires `--change-issue "123:en,456:zh"` to declare fully resolved
Issues in the release repository and the discussion language: `en` for English,
`zh` for Chinese, and `en` for mixed discussions. Use `--change-issue none` when
there is no resolved Issue. PR numbers are rejected. Do not list merely related
or partially implemented Issues; the script never infers closure from arbitrary
`#number` mentions.

`--dry-run` validates and displays the targets. The tracking Issue and release
checkpoint retain the mapping, and Release notes automatically link these Issues.
Resume a Draft with the same declarations. After all blocking post-publication
desktop, Android, and GHCR audits pass, the script backlinks the Release in the
selected language, then closes each still-open target. Already-closed Issues get
a backlink while retaining their closure reason. Non-blocking iOS delivery,
Demo deployment, and TCR jobs do not gate this follow-up.

A failed backlink prevents that Issue from closing; other targets still proceed.
Partial failures retain the published Release and leave the tracking Issue open,
with an independent retry command:

```bash
bun run release -- --finish-issues vX.Y.Z
```

This command restores the saved plan and successful-audit receipt and only handles
Issues; it does not republish or rebuild assets. Repeated runs do not duplicate
backlinks. Missing plans or audit receipts, a different target commit, or a Release
restored to Draft prevent closure. Add `--dry-run` to inspect the plan. Older
releases without these records cannot use this entry point.

### External Contributor Credits

- Changes completed by the maintainer need no attribution. Credit external
  contributions with `@username` and the PR at the end of the corresponding item.
- Multiple contributions by the same person may use consolidated credits instead.
  The closing list only includes people not credited individually; omit it when empty.
- GitHub generates its native Contributors avatar section from `@username`
  mentions throughout the notes, including individual items.

Place individual credits in `--change-zh` / `--change-en`. For a consolidated
list, repeat `--contributor alice`; the script appends
`贡献者 / Contributors：@alice` after the bilingual notes. This option does not
infer contributors automatically. Resuming an existing Draft preserves its
notes; edit the Draft directly to adjust credits.

## EdgeEver-Specific Behavior

- Stable tags and Release titles use `vX.Y.Z`. Pass `--bump` explicitly and
  follow SemVer; do not compress user-visible new capabilities or new platforms
  into `patch` for release cadence (see `AGENTS.md`).
- The root version identifies the product Release. Native marketing versions
  change only when that native runtime is rebuilt. Android `versionCode` and
  iOS build numbers remain independent, monotonically increasing identifiers.
- A formal Release contains macOS arm64 and x64 DMGs, architecture-specific
  updater ZIPs, an unsigned Windows x64 Preview installer with an independently
  signed update manifest, a Linux x64 AppImage Preview with updater metadata and a SHA-256 checksum
  file, and an Android arm64 APK. Unchanged native assets are reused with their
  original filenames, versions, and checksums.
- Desktop and Android update checks use the version embedded in the applicable
  Release asset rather than the overall GitHub tag. This prevents a Web-only or
  API-only Release from prompting an unnecessary native update.
- The script creates the tracking Issue and Draft Release, validates or reuses
  native assets, prepares and audits the multi-platform GHCR image, publishes,
  and closes the Issue without installing
  the desktop application by default; installation checks require an explicit
  `--install-desktop`.
  Demo deployment continues independently after its Actions URL is printed.
- A separate workflow sends the same verified Git commit to CNB. CNB builds and
  audits the public Tencent TCR image inside Tencent Cloud after the formal
  Release is published. Its duration or failure does not block the GitHub
  Release or return a published version to Draft.
- After Draft native assets are prepared, publication is blocked unless the
  Android APK uses the Google Play app-signing certificate. If that gate fails,
  the Release remains a Draft. Run
  `bun run publish:stores -- --release vX.Y.Z --platform android --android-track production`
  for that Draft, then rerun the original release command to resume. When the
  audited range includes iOS runtime changes, the same command starts Xcode
  Cloud and submits App Review after GitHub publication. Once post-publication
  audits pass, the script closes the tracking Issue and then waits for App
  Store delivery. An iOS failure leaves the GitHub Release published and that
  Issue closed; retry with
  `bun run publish:stores -- --release vX.Y.Z --platform ios`. See
  [Mobile Store Delivery](store-delivery.md).
- Web Clipper store submission is a separate official-repository workflow.
  Run **Submit Web Clipper** after increasing `apps/extension/package.json`.
  It does not run as part of `bun run release`, and its review does not change
  a GitHub Release. See [Web Clipper store submission](extension-store.md).
- Published desktop and Android audits read asset names and download
  installers through the release API URL. `gh release view --json assets` and
  `gh release download` can stay empty after a draft is published, and treating
  that empty list as a missing asset set returns the Release to Draft.
- After rebuilt desktop assets are uploaded to the Draft, the local release
  command signs only `latest-windows.json`; the private key never enters GitHub
  Actions. A second desktop workflow run downloads the Windows installer,
  `latest.yml`, manifest, signature, and checksum file and independently audits
  them before publication. See [Windows Preview security and updates](windows-preview.md).

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

- Validation, Windows signature/audit, Draft asset, or GHCR image failures leave
  the Release unpublished.
- An asynchronous CNB/TCR build failure leaves the formal Release intact and is
  repaired or rerun independently.
- Rerunning the same command resumes a matching Draft created by an interrupted
  run instead of creating another Issue, commit, or Release.
- A failed post-publication native or GHCR audit attempts to return the Release to
  Draft and leaves the Issue open.
- After those audits pass, the script closes the tracking Issue before waiting
  for App Store delivery. A later App Store failure leaves that Issue closed.
- If an explicit application installation fails, the script restores the previous
  app from its macOS Trash backup when possible.
