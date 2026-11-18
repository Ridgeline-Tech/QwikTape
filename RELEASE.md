# QwikTape signing and signed-candidate CI

The Android package is `construction.ridgeline.qwiktape`. Its first signed
release uses versionName `0.1.0` and versionCode `1`; debug builds retain the
`.debug` application ID and `-debug` version suffix. Release builds have no
debug-signing or unsigned fallback.

## Dedicated identity custody

The permanent identity is created only after its source and wrapper gates are
approved. On Zac's trusted Windows account, the reviewed initializer writes:

- the PKCS12 keystore, encrypted recovery payload, public certificate and
  public identity record under
  `%OneDriveCommercial%\ZacsApps\Release Identity\QwikTape\`;
- the DPAPI CurrentUser operational record under
  `%LOCALAPPDATA%\QwikTape\signing\`.

`scripts/Initialize-QwikTapeReleaseIdentity.ps1` refuses to start unless
`OneDriveCommercial` and its existing `ZacsApps\Release Identity` directory
are available. It refuses to overwrite any identity file, passes generated
operational passwords to keytool through its child environment rather than
arguments, protects private files with owner-only ACLs, and removes partial
files in `finally` on failure. The recovery copy uses PBKDF2-HMAC-SHA256 with
600,000 iterations and AES-256-GCM. The recovery passphrase is never stored by
this script; the separately reviewed one-time wrapper owns Windows Credential
Manager recovery storage.

The identity is dedicated to QwikTape. It does not reuse Smart Dock, Zac's Apps
Store, upstream or debug signing material.

## Protected GitHub Environment

Before any secret upload, repository controls must be read back and verified:

- `main` requires a pull request, applies to administrators, requires zero
  approving reviews and conversation resolution, and forbids force-pushes and
  branch deletion;
- Environment `qwiktape-release` has administrator bypass disabled, requires
  Wabull as its sole reviewer, and permits deployments only from `main`.

After the dedicated identity exists and its public certificate has been
independently reviewed, `scripts/Upload-CISecrets.ps1` verifies those
Environment controls and sends these five values through GitHub CLI standard
input to Environment-scoped secrets:

- `QWIKTAPE_RELEASE_KEYSTORE_BASE64`
- `QWIKTAPE_RELEASE_STORE_PASSWORD`
- `QWIKTAPE_RELEASE_KEY_ALIAS`
- `QWIKTAPE_RELEASE_KEY_PASSWORD`
- `QWIKTAPE_RELEASE_CERT_SHA256`

The upload script uses the explicit `github.com/Ridgeline-Tech/QwikTape`
target, does not print secret values or place them in arguments, and validates
the public certificate against the DPAPI-protected identity before upload.
Repository-level secret count must remain zero.

## CI behavior and gates

Pull requests run `.github/workflows/signed-candidate.yml` with a disposable,
one-day CI-only key. That job exercises release signing and independently
requires exactly one signer plus the expected package, versionCode,
versionName and minSdk. It deletes the throwaway key and APK in an always-run
cleanup step.

The manual `signed-candidate` job runs only for `workflow_dispatch` on `main`,
uses Environment `qwiktape-release`, scopes the keystore and password secrets
to only the steps that need them, disables Gradle caching for the permanent-key
job, and always removes the restored keystore. It uploads only the verified APK
and `.sha256` as a seven-day workflow artifact.

Gate 1 intentionally contains an all-zero blocked certificate-pin sentinel.
The permanent job fails before building until a later workflow-only reviewed
PR replaces that sentinel with the public identity's lowercase 64-hex SHA-256.
The workflow validates both the Environment secret and checked-in pin, compares
them, and passes the checked-in pin—not the secret—to the APK verifier.

No workflow in this gate creates a tag, GitHub Release, catalog row, deployment
or device installation. Publishing the single authorized signed release occurs
only after the identity, repository controls, wrapper, certificate pin, secret
inventory and one approved signed-candidate run have passed their separate
gates.

## Pocket Builder engine impact

Signing and release plumbing must not add UI behavior to the shared calculator
engine. This release-identity gate changes none of the five files vendored by
Pocket Builder:

- `app/src/main/assets/tape-engine.js`
- `app/src/main/assets/tape-parser.js`
- `app/src/main/assets/bignum.js`
- `app/src/main/assets/vendor/decimal.mjs`
- `app/src/main/assets/vendor/chevrotain.min.js`

No Pocket Builder re-pin is required for this gate.
