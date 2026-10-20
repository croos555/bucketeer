# Building & releasing

## Local builds

```bash
npm run dist                                   # packages for the current system
npx tauri build --target aarch64-apple-darwin  # or x86_64-apple-darwin, after rustup target add
```

Output goes to `src-tauri/target/[<target>/]release/bundle/`: `.app` and `.dmg` on macOS, NSIS
installer on Windows, AppImage, deb and rpm on Linux. Each system builds its own packages (the
backend is native code), which the release workflow does on GitHub's runners.

## Continuous integration

### Checks (`.github/workflows/ci.yml`)

Every push to `main` and every pull request runs `npm ci`, the typecheck, the renderer build,
`cargo clippy -D warnings`, `cargo test` and `npm audit --omit=dev`. Dependabot
(`.github/dependabot.yml`) opens weekly npm and Cargo updates.

### Packages (`.github/workflows/build.yml`)

Builds every package on GitHub-hosted runners, free for public repositories:

| Job | Runner | Packages |
|---|---|---|
| `build-macos` | `macos-latest` | dmg, Apple Silicon and Intel |
| `build-windows` | `windows-latest` | NSIS installer and portable exe, x64 and ARM64 |
| `build-linux` | `ubuntu-22.04`, `ubuntu-22.04-arm` | AppImage, deb, rpm, x64 and ARM64 |

It runs on tags `v*` and manually (*Actions → Build → Run workflow*). Packages are uploaded as
workflow artifacts; on a tag, a **draft release** is created with all of them attached. Linux
packages are built on Ubuntu 22.04 so they run on distributions with an older glibc.

## Code signing

### Windows (Certum Code Signing in the Cloud)

Windows executables are signed with a Certum open source code signing certificate kept in Certum's
cloud (SimplySign). The release workflow does it automatically on `v*` tags:

1. [ssign](https://github.com/Le-Syl21/ssign) (pinned release, SHA-256 verified) is installed in the
   job. It talks to Certum's cloud API over HTTPS and computes the one-time password from
   the account's TOTP seed: no SimplySign Desktop, no virtual smart card.
2. The job sets Tauri's `bundle.windows.signCommand` (through `tauri build --config`) to
   [`build/sign-win.js`](../build/sign-win.js), which Tauri calls for the app, the installer and
   the uninstaller; ssign signs in place with SHA-256, embeds the Certum chain and adds an RFC 3161
   timestamp from `http://time.certum.pl`. One login covers the whole build.
3. `Get-AuthenticodeSignature` checks every executable (chain and timestamp) before upload.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CERTUM_USERNAME` | e-mail of the SimplySign account |
| `CERTUM_TOTP_SECRET` | TOTP seed in **Base32** (the `secret=` of the SimplySign activation QR code; if Certum shows it in hexadecimal, convert it to Base32) |

Without these secrets (local builds, pull requests from forks) nothing is signed. The TOTP seed
allows signing in the maintainer's name until the SimplySign QR code is re-issued: consider moving
the secrets to a protected GitHub environment with required reviewers.

To sign by hand on a workstation, install ssign and use a one-shot code from the SimplySign mobile
app: `ssign -e you@example.com -T 123456 app.exe`.

### macOS (Developer ID + notarization)

On `v*` tags, the macOS job imports the **Developer ID Application** certificate into a temporary
keychain and passes its name to Tauri (`APPLE_SIGNING_IDENTITY`). Tauri signs the app with the
hardened runtime, has Apple notarize it (`notarytool` with an App Store Connect API key:
`APPLE_API_KEY` = key ID, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`) and staples the ticket before
building the dmg. The job then checks `codesign --verify`, `spctl --assess` (must report *Notarized
Developer ID*) and `stapler validate`.

Repository secrets:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the Developer ID Application certificate and its private key, exported from Keychain Access as `.p12`, **base64-encoded** |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY_BASE64` | the App Store Connect API key (`AuthKey_XXXXXXXXXX.p8`, *Developer* access), base64-encoded |
| `APPLE_API_KEY_ID` | the key ID |
| `APPLE_API_ISSUER` | the issuer ID shown above the keys list |

```bash
base64 -i developer-id.p12 | gh secret set MAC_CSC_LINK --repo <owner>/bucketeer
base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set APPLE_API_KEY_BASE64 --repo <owner>/bucketeer
```

The `.p8` is written to the runner's temp folder only for the build and deleted afterwards, with the
keychain. Without the secrets (forks, manual runs) macOS builds stay unsigned.

Locally, `APPLE_SIGNING_IDENTITY="Developer ID Application: …" npm run dist` signs with a
certificate from your keychain; add `APPLE_API_KEY`, `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH` to
notarize.

Never store certificates or passwords in the repository.

## Releasing

1. Bump `version` in `package.json` (the Tauri build reads it) and `src-tauri/Cargo.toml`, and
   update `CHANGELOG.md`.
2. Commit, then tag: `git tag -a v0.2.0 -m v0.2.0 && git push --tags`.
3. The GitHub workflow builds every package and creates a draft release: review it and publish.
