# Mobile Store Delivery

GitHub Releases and mobile store delivery are separate operations:

- `bun run release` creates and audits the GitHub Release. It never contacts
  Google Play or App Store Connect.
- `bun run publish:stores` dispatches a manual store-delivery workflow for one
  existing formal Release tag.
- Store delivery is the authorization to submit. By default, Google Play uses
  the Production track, while iOS continues from App Store Connect upload into
  App Review. Approved builds are released automatically.

## Safety Model

The workflow checks out the immutable Release tag rather than `main`. Before any
store build starts, it verifies that:

- the tag belongs to a formal, non-prerelease GitHub Release;
- the Release target and Git tag resolve to the same commit;
- the audited range since the previous formal Release contains mobile runtime
  changes;
- root and mobile app versions both match the Release tag;
- Android `versionCode` increased.

A Release that reused the previous mobile binary is intentionally rejected. It
does not represent a new store binary and should not be uploaded again.

## Prerequisites

Configure these GitHub repository secrets:

- `EXPO_TOKEN`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_PLAY_APP_SIGNER_SHA256`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`
- `APP_STORE_CONNECT_API_KEY_ID`
- `APP_STORE_CONNECT_API_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

Upload the Google Play service-account key to the Android application's EAS
Submit credentials, and store the same service-account JSON as base64 in the
repository secret listed above. Copy the SHA-256 fingerprint of the **app
signing certificate** (not the upload certificate) from Play Console into
`ANDROID_PLAY_APP_SIGNER_SHA256`. Configure the iOS distribution credentials
and App Store Connect API key in EAS. Credentials and private keys must remain
outside the repository.

Create these GitHub Environments:

- `store-delivery` for Android testing tracks and Apple App Review delivery.
- `store-production` for Google Play production delivery.

EAS Submit requires the application to exist in each store and Google Play API
submission requires the service account to have access to the application.
Follow the official
[EAS Android submission guide](https://docs.expo.dev/submit/android/) and
[EAS Submit configuration reference](https://docs.expo.dev/submit/eas-json/).

## Commands

Submit both platforms to Google Play Production and Apple App Review:

```sh
bun run publish:stores -- --release v1.7.0
```

Deliver only Android to a closed testing track:

```sh
bun run publish:stores -- \
  --release v1.7.0 \
  --platform android \
  --android-track beta
```

Use `--dry-run` to print the GitHub workflow dispatch without starting it.

## Platform Behavior

### Google Play

The self-hosted release runner builds a signed AAB from the selected tag,
verifies its signature and R8 mapping, preserves both as GitHub Actions
artifacts, and uploads the AAB through EAS Submit.

After Google Play finishes processing the bundle, the workflow downloads the
Play-signed universal APK, verifies the pinned app-signing certificate, and
replaces the GitHub Release Android asset. This makes installations from
Google Play and GitHub mutually updateable. The established `arm64-v8a` asset
name is retained for release compatibility; the Play-generated universal APK
supports arm64 and can include additional ABIs.

Internal, Alpha, Beta, and Production profiles use a completed release on the
selected track. The default command targets Production; use
`--android-track internal`, `alpha`, or `beta` only when a testing delivery is
explicitly requested.

### App Store Connect

Native iOS store binaries come from **`apps/ios`** (SwiftUI), not Expo EAS.
On macOS beta hosts, archives must go through **Xcode Cloud** (manual Archive
workflow) so `BuildMachineOSBuild` is a release OS image — see
[iOS Xcode Cloud](ios-xcode-cloud.md). Cloud stamps `CFBundleVersion` from the
product’s next build number; `ci_post_xcodebuild.sh` uploads the App Store IPA
with an App Store Connect API key when shared environment secrets are set.
Fastlane (`apps/ios` `submit_review`) then selects the exact app version and
build number, submits App Review, and configures automatic release after
approval. Missing metadata, agreements, review information, or credentials
cause the workflow to fail without submitting a different build.
