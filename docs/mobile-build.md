# EdgeEver Mobile Builds

EdgeEver Mobile is built with Expo and React Native. Main-branch Android packages are built directly on GitHub Actions, without using EAS Build quota.

## App Updates

Installed release builds use EAS Update for compatible JavaScript and asset updates. The app checks once shortly after launch and, at most once every six hours, when it returns to the foreground. Users can also open **My** -> **General settings** -> **App updates** to check manually. A downloaded update is only applied after the user confirms a restart, so an active editing session is not interrupted automatically.

The `production` build and locally generated Play build read from the `production` update channel. Preview EAS builds read from `preview`. Publish and verify an update on `preview` before promoting the same change to production:

```sh
bunx eas-cli update --channel preview --environment preview --message "Describe the update"
bunx eas-cli update --channel production --environment production --message "Describe the update"
```

The update runtime uses the app-version policy. Any native dependency, Expo SDK, native module, or native configuration change requires incrementing `expo.version` and shipping a new store build before publishing code that depends on that native change. EAS Update does not replace Google Play or App Store updates for native binaries.

## Main-Branch Android APK

The `Build EdgeEver Mobile` workflow runs on GitHub Actions and produces a
fast arm64 APK after mobile changes land on `main`. This APK uses the same
pinned production signing certificate as formal GitHub Release APKs. The fast
build only disables R8, resource shrinking, and PNG crunching; it must never
fall back to `debug.keystore`.

It runs:

```sh
bun install --frozen-lockfile
bun run typecheck:mobile
bun run build:android:fast
```

The APK is uploaded as a GitHub Actions artifact named
`edgeever-android-main-apk`. If the stable signing credentials are unavailable,
the workflow fails and does not upload an APK with a different signer.

For a local fast build, load the same signing environment used for release
builds:

```sh
bun run build:android:fast:local
```

## Release Builds

### GitHub Release APK

Every formal GitHub Release must include a directly installable APK. Build the production-signed `arm64-v8a` APK on the release Mac:

```sh
bun run build:android:apk:local
```

This produces `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
Before upload, automation requires exactly one signer and pins its certificate
SHA-256 to
`22bf52a9501c89020f5acc966960152c826bfa64f31e578e858d088f8cd75d87`.
Any other signer fails the build. Verify the application version and APK
SHA-256 as well. Additional ABIs should only be published for an explicit
compatibility need; the Play AAB continues to include all supported
architectures. A release whose audited change range affects mobile runtime
code, shared code used by mobile, mobile dependencies, native configuration,
APK build tooling, or signer verification must rebuild the APK from that
release commit.

If the audited change range does not affect the mobile binary, the most recent compatible, verified APK may be attached again without rebuilding. Keep its original versioned filename and checksum, and state the source release explicitly; never rename an older binary to the current release version.

The release workflow performs this audit automatically and verifies the pinned
signer for both newly built and reused APKs. Web-only releases use an Ubuntu
planning job and copy the single verified `arm64-v8a` APK from the previous
formal Release. The self-hosted Android runner is scheduled only when the
audited range includes mobile runtime code, shared mobile packages,
dependencies, native configuration, Android build tooling, or signer
verification.

This locally signed APK prepares the Draft without requiring a Google Play
submission. After the matching AAB is delivered, the store-delivery workflow
downloads Google Play's signed universal APK and replaces the GitHub Release
asset under the established filename. The Play-generated APK supports arm64
and may contain additional ABIs; publishing it is the explicit compatibility
exception that lets Play and GitHub installations update each other without
uninstalling the app. The workflow pins and verifies the Play app-signing
certificate before replacing the asset.

### Recommended local Play build

Routine Google Play bundles should be built on the release Mac instead of in
GitHub Actions. Keep the upload keystore and signing environment outside the
repository:

```sh
mkdir -p "$HOME/.config/edgeever/android"
cp .env.android.local.example "$HOME/.config/edgeever/android/signing.env"
chmod 600 "$HOME/.config/edgeever/android/signing.env"
```

Fill in the existing upload key's absolute path and credentials. Android
keystore formats and local environment files are ignored by Git.

```sh
bun run build:android:play:local
```

This produces:

```text
apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
apps/mobile/android/app/build/outputs/mapping/release/mapping.txt
```

The command builds all Play-supported Android architectures by default,
verifies the AAB signature, and requires a non-empty R8 mapping file. Keep an
encrypted backup of `signing.env` and the upload keystore outside the
repository. Do not replace or regenerate the upload key for an existing Play
app unless the key reset has been completed in Play Console.

Set `EDGE_EVER_ANDROID_ENV_FILE` to use a different secure environment file.

### Automated store delivery

The GitHub Release workflow never builds or uploads a Play bundle. After a
formal Release that contains mobile changes is published, use the separate
store-delivery workflow. It builds a signed AAB from the immutable Release tag,
preserves the AAB and R8 mapping as Actions artifacts, and uploads the bundle
through EAS Submit. It then replaces the GitHub APK with the Play-signed
universal APK. See [Mobile Store Delivery](store-delivery.md).

The upload keystore is only used to prove ownership when uploading bundles;
Google Play App Signing manages the app signing key delivered to users. Keep an
encrypted backup of the upload keystore and its credentials outside the
repository.

### iOS App Store build

The production iOS app uses the bundle identifier `org.edgeever.mobile`. The
Apple Developer team and distribution credentials are managed through EAS so
that the App Store archive can be built without storing signing certificates in
the repository or on the release machine:

```sh
cd apps/mobile
bunx eas-cli credentials:configure-build --platform ios --profile production
bunx eas-cli build --platform ios --profile production
```

The first command requires the Apple Account Holder to authenticate and may
prompt for two-factor authentication. The production profile automatically
increments the App Store build number. Routine delivery should use the separate
store-delivery workflow, which builds from an immutable formal Release tag,
uploads to App Store Connect, and submits that exact build to App Review.
Approved builds are released automatically. Apple credentials, App Store
Connect API keys, certificates, and provisioning profiles must never be
committed.

## EAS

The project is linked to Expo/EAS for optional future use, but routine CI builds should use GitHub Actions local Android builds to avoid consuming EAS monthly build quota.
