# Bucketeer — notes for Claude Code

Local-first desktop browser for S3-compatible object storage (OVHcloud, AWS S3, Scaleway, Wasabi,
Cloudflare R2, MinIO, custom): saved connections, dual-pane browser (local ↔ bucket, bucket ↔ bucket),
transfers, buckets/folders management, public URLs, make public/private, signed links. Sibling of
Sshelby (same stack, design and conventions). No account, no cloud: everything lives in a local vault.

Open source (MIT). Code, comments, docs and commit messages are in English. User and contributor
docs live in README.md and docs/; keep them in sync when behavior changes.

## Open source standards (non-negotiable)

Bucketeer is a public MIT project on GitHub (github.com/croos555/bucketeer). Every change must meet
the standards expected of a well-run open source repository:

- **History**: small, focused commits with [Conventional Commits](https://www.conventionalcommits.org/)
  messages (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`…) and a body explaining *why*. Never commit
  secrets, access keys, personal data, local paths or machine-specific config. Never rewrite
  published history or force-push `main` without the maintainer's explicit approval.
- **Versioning**: [Semantic Versioning](https://semver.org/); `package.json` version, `CHANGELOG.md`
  ([Keep a Changelog](https://keepachangelog.com/), user-visible changes under *Unreleased*) and the
  `vX.Y.Z` tag must agree. Releases are cut by pushing an annotated tag; CI drafts the GitHub release.
- **Quality gates**: `npm run typecheck`, `npm run build` and `cargo clippy --all-targets -- -D warnings`
  (in `src-tauri/`) must pass before pushing; the CI workflow checks every push and pull request.
  Keep `npm audit --omit=dev` clean and dependencies MIT-compatible (Tauri and the AWS SDK are
  Apache-2.0/MIT, fine).
- **Docs in sync**: README, `docs/`, CHANGELOG and this file are updated in the same commit as the
  behavior they describe. User-facing text is in English.
- **Community files** stay current: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY (private
  vulnerability reporting), issue and PR templates.
- **Security**: secrets encrypted at rest, no telemetry, minimal Tauri capabilities; anything
  touching credentials, public access or deletion is reviewed with extra care and documented in
  `docs/security.md`.

## Stack

Tauri 2 (Rust backend in `src-tauri/`, system web view), React 19 + TypeScript + Vite, zustand,
lucide-react. Rust crates: aws-sdk-s3 (behavior-version-latest), keyring (vault key in the OS
keychain), aes-gcm, reqwest (rustls), trash, mime_guess, tokio; Tauri plugins dialog, opener,
clipboard-manager. Migrated from Electron after 0.1.0 (the Electron code lives in git history).

## Commands

```bash
npm run dev          # tauri dev (Vite on :5175 + Rust backend, rebuilt on change)
npm run typecheck    # tsc for vite.config.ts and the renderer
npm run build        # renderer only, to out/renderer (embedded by the Rust build)
npm run dist         # tauri build: packages for the current system
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
cd src-tauri && cargo test -- --ignored --test-threads=1   # S3 end-to-end test, needs SeaweedFS on 127.0.0.1:8333
```

Rust lives in `~/.cargo/bin` (not always on PATH). Some shells rewrite `npx`/`cargo` (token-saving
hooks); in scripts prefer `./node_modules/.bin/<tool>` or the proxy. Test S3 behavior against a local
SeaweedFS (`chrislusf/seaweedfs server -s3`): the `minio/minio` image is no longer on Docker Hub.

## Layout

```
src/shared/       types.ts (vault model, settings, command payloads), providers.ts (presets), urls.ts (public URL, s3://)
src/renderer/src  api.ts (window.api over Tauri invoke/listen, OS file drops → "os-file-drop" event),
                  App.tsx, store.ts (zustand), views/ (Connections, Settings), components/ (BrowserTab:
                  dual pane + bucket list + transfers, ObjectInfoPanel, ConnectionEditor, icons, ui)
src-tauri/src/    lib.rs (plugins, commands), store.rs (vault), secrets.rs (AES-256-GCM, key in keychain),
                  s3.rs (client cache, operations, errors, ACLs, presign), transfers.rs (upload/download/copy,
                  progress, cancel), local.rs (local files), util.rs (emit, Error, bail!), s3_tests.rs
src-tauri/        tauri.conf.json (+ tauri.windows.conf.json), capabilities/, icons/
build/            icon.svg (source) → icon.png → src-tauri/icons; sign-win.js (Windows signCommand, CI only)
```

## Rules and gotchas

- Vault = `vault.json` in Tauri's app data dir (`~/Library/Application Support/dev.bucketeer.app`,
  `%APPDATA%\dev.bucketeer.app`, `~/.local/share/dev.bucketeer.app`). Collections: groups, connections,
  bookmarks + settings. `secretAccessKey` is encrypted (`secret_fields`). New settings need a default
  in `default_settings`. The Electron 0.1.0 vault (`<config>/bucketeer/vault.json`, `enc:v1:` secrets
  from "Bucketeer Safe Storage") is imported once; keep that path working.
- S3 clients are cached per connection and dropped when the connection changes (`s3::forget_client`).
- Non-AWS providers: `RequestChecksumCalculation` / `ResponseChecksumValidation` = `WhenRequired`
  (the SDK's default CRC32 checksums break many S3-compatible stores). Uploads pass `ContentLength`
  so small files are plain PUTs; failed multipart uploads are aborted.
- Folders are prefixes; a "folder marker" object `prefix/` may or may not exist. Never assume it does
  (renames/copies must not copy a missing marker).
- Never trust the server to refuse destructive operations: bucket deletion checks emptiness first.
- Renderer ↔ backend only through `window.api` (`api.ts`). Add a call = `#[tauri::command]` +
  registration in `lib.rs` + typed wrapper in `api.ts` (snake_case command, camelCase args). New
  plugin permissions go in `capabilities/default.json`; keep them minimal.
- OS file drops: Tauri drag-drop events, dispatched to the element under the cursor as `os-file-drop`
  (`data-dir-path` marks folder targets). Disabled on Windows (`tauri.windows.conf.json`) so HTML5
  drag & drop between panes keeps working there.
- `tauri.conf.json` reads its version from `package.json`; bump `src-tauri/Cargo.toml` with it.

## CI

- GitHub Actions (`.github/workflows/build.yml`), tags `v*` and manual runs: `build-macos` (aarch64 +
  x86_64 dmg), `build-windows` (windows-latest, NSIS + portable exe, x64 + arm64), `build-linux`
  (ubuntu-22.04 and -arm: AppImage, deb, rpm); tags create a draft release (pre-release for `-rc`).
- Windows signing: Certum cloud certificate through ssign's Windows binary (pinned v0.1.8 + SHA-256)
  on release tags; the job passes `bundle.windows.signCommand` = `node build/sign-win.js %1` with
  `tauri build --config`. Secrets `CERTUM_USERNAME` / `CERTUM_TOTP_SECRET` (Base32), see
  docs/building.md. Third-party tools and actions that receive secrets are pinned (release + SHA-256
  or commit SHA) after review. SimplySign Desktop on GitHub's Windows runner does not work.
- macOS signing: Developer ID Application certificate imported into a job keychain (Tauri's and
  electron-builder's own temporary keychains are avoided), `APPLE_SIGNING_IDENTITY` from
  `find-identity`; notarization by Tauri with `APPLE_API_KEY` (= secret `APPLE_API_KEY_ID`),
  `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH` (from `APPLE_API_KEY_BASE64`). Secrets `MAC_CSC_LINK`,
  `MAC_CSC_KEY_PASSWORD` hold the .p12.
