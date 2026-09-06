# Windows x64 Preview

## Distribution status

EdgeEver distributes a Windows x64 Preview from the official
[GitHub Releases](https://github.com/tianma-if/edgeever/releases/latest) page.
The current installer and packaged executables are not Authenticode-signed.
Windows SmartScreen, antivirus software, or organization policy may therefore
warn about or block the installer. This warning is expected for the Preview,
but it is not proof that an arbitrary copy is safe.

- Download only from the official `tianma-if/edgeever` Release.
- Do not disable SmartScreen, antivirus software, or organization security
  controls for EdgeEver.
- If policy blocks the installer, use the Web/PWA client until an
  Authenticode-signed build is available.

## Automatic updates

An unsigned installer does not prevent the NSIS updater from downloading and
installing a later Release. EdgeEver adds an independent trust gate so that the
update channel does not rely only on an unsigned `latest.yml` file:

1. The client reads `latest.yml` to discover an update but does not begin the
   Windows download yet.
2. It fetches `latest-windows.json` and `latest-windows.json.sig` from that
   exact version's official Release.
3. It verifies the Ed25519 signature with a public key pinned in the packaged
   client, then requires the version, filename, size, and SHA-512 digest to
   match `latest.yml`.
4. It downloads the installer automatically and validates its size, SHA-512,
   and SHA-256 against the signed manifest.
5. Only a verified installer becomes eligible for restart installation or
   automatic installation when the user quits EdgeEver.

Missing metadata, an unknown key, an invalid signature, a version mismatch, or
a changed installer fails closed. The app never enables install-on-quit for a
Windows package that has not passed the final local-file check.

This protects the update decision and installer bytes. It does not remove the
initial Windows reputation warning, provide publisher identity in Explorer,
or bypass organization application-control policy; those require trusted
Authenticode signing.

## Release assets and offline signing

Every formal Release carries this Windows set:

- `EdgeEver-<version>-windows-x64.exe`
- `latest.yml`
- `latest-windows.json`
- `latest-windows.json.sig`
- `SHA256SUMS-windows.txt`

GitHub Actions builds and verifies the unsigned package, then uploads the first
four unsigned inputs except the signature to the Draft Release. The release
command signs the exact manifest locally using the repository-external key
identified by `EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY`. It then dispatches an
independent GitHub Actions audit that downloads all five assets and verifies
the signature plus installer digests before publication is allowed.

The private key must be an Ed25519 PKCS#8 PEM file, must remain outside the
repository, and must be backed up in a separate secure location. Configure the
release shell with an absolute path:

```bash
export EDGE_EVER_WINDOWS_UPDATE_SIGNING_KEY=/absolute/path/to/windows-update-ed25519-private.pem
```

The initial trust anchor uses key ID `edgeever-windows-update-2026-01`; its
SPKI DER SHA-256 fingerprint is
`ec12b4b5673a2e6ac3666d0cc90dd5c418f3650418cd2b91fa09cec969d50db9`.

If the key is missing or does not match the public key pinned in the desktop
client, the Release remains a Draft. Key rotation is a two-release process:
first ship a client that trusts both old and new public keys while continuing
to sign with the old key, then switch manifest signing to the new key in a
later Release.

## Future Authenticode migration

When a trusted certificate becomes available:

1. Sign every shipped PE executable, including `EdgeEver.exe`, the Rust
   sidecar, helper executables, and the final NSIS installer.
2. Configure the exact certificate subject as electron-builder's
   `publisherName` so signed clients enforce publisher continuity.
3. Generate `latest.yml`, the signed EdgeEver manifest, and checksums only
   after all Authenticode signing has finished, because signing changes bytes.
4. Keep the independent Ed25519 gate during and after migration. Existing
   unsigned Preview clients can accept the first signed installer because they
   do not claim an Authenticode publisher; newly signed clients then add the
   publisher check for subsequent updates.

The first public Windows platform Release is a user-visible platform addition
and must use a SemVer minor bump, not a patch bump.
