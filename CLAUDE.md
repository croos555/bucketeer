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
- **Quality gates**: `npm run typecheck` and `npm run build` must pass before pushing; the CI workflow
  checks every push and pull request. Keep `npm audit --omit=dev` clean and dependencies
  MIT-compatible (AWS SDK is Apache-2.0, fine).
- **Docs in sync**: README, `docs/`, CHANGELOG and this file are updated in the same commit as the
  behavior they describe. User-facing text is in English.
- **Community files** stay current: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY (private
  vulnerability reporting), issue and PR templates.
- **Security**: secrets encrypted at rest, no telemetry, renderer isolation kept intact; anything
  touching credentials, public access or deletion is reviewed with extra care and documented in
  `docs/security.md`.

## Stack

Electron + electron-vite, React 19 + TypeScript, zustand, AWS SDK for JavaScript v3
(`@aws-sdk/client-s3`, `lib-storage`, `s3-request-presigner`), `mime-types`, lucide-react.
**No native modules**: keep it that way so every platform builds from one machine.

## Commands

```bash
npm run dev          # electron-vite dev (hot reload renderer, restarts the app on main changes)
npm run typecheck    # tsc for node (main/preload/shared) and web (renderer) configs
npm run build        # bundle to out/
npm run dist:mac     # dmg + zip, x64 and arm64 (dist:mac:arm = Apple Silicon only)
npm run dist:win     # NSIS installer (x64+arm64) + portable exe
npm run dist:linux   # AppImage (x64+arm64) + deb + rpm
```

No test runner. Main-process modules can be run from Node with a loader that stubs `electron`
(see docs/development.md); use `import type` for type-only imports and no TS parameter properties.
Test S3 behavior against a local SeaweedFS (`chrislusf/seaweedfs server -s3`): the `minio/minio`
image is no longer published on Docker Hub.

## Layout

```
src/shared/      types.ts (vault model, settings, IPC payloads), providers.ts (presets), urls.ts (public URL, s3://)
src/main/        index.ts (window, IPC, lifecycle), store.ts (vault + safeStorage), s3.ts (client cache,
                 operations, errors, ACLs, presign), transfers.ts (upload/download/copy, progress, cancel),
                 splash.ts
src/preload/     contextBridge API (`window.api`), typed in index.d.ts
src/renderer/src App.tsx, store.ts (zustand), views/ (Connections, Settings),
                 components/ (BrowserTab: dual pane + bucket list + transfers, ObjectInfoPanel,
                 ConnectionEditor, icons, ui primitives)
build/           icon.svg (source) → icon.png used by electron-builder; splash reuses the SVG
```

## Rules and gotchas

- Vault = `~/Library/Application Support/bucketeer/vault.json` (Windows `%APPDATA%\bucketeer`, Linux
  `~/.config/bucketeer`). Collections: groups, connections, bookmarks + settings. `secretAccessKey`
  is encrypted (`SECRET_FIELDS`). New settings need a default in `DEFAULT_SETTINGS`.
- `S3Client`s are cached per connection and rebuilt when the connection changes (`store.onConnectionChange`).
- Non-AWS providers: `requestChecksumCalculation` / `responseChecksumValidation` = `WHEN_REQUIRED`
  (the SDK's default CRC32 checksums break many S3-compatible stores). Uploads pass `ContentLength`
  so small files are plain PUTs, not chunked streams.
- Folders are prefixes; a "folder marker" object `prefix/` may or may not exist. Never assume it does
  (renames/copies must not copy a missing marker).
- Never trust the server to refuse destructive operations: bucket deletion checks emptiness first.
- Renderer ↔ main only through `window.api` (contextIsolation on, no nodeIntegration). Add a
  channel = handler in main + entry in `src/preload/index.ts`.
- `npm run dev` restarts the app on main-process changes; warn before editing `src/main` while
  someone is testing in dev mode. Use `--user-data-dir=<scratch>` for a separate test instance.
- Some shells rewrite `npx` (token-saving hooks); in scripts prefer `./node_modules/.bin/<tool>`.

## CI

- GitHub Actions (`.github/workflows/build.yml`): macOS and Linux packages on their runners, Windows
  packages built and signed on Linux (`build-windows` job on ubuntu-latest, no container: ssign needs
  Ubuntu 24.04's glibc), for
  tags `v*` and manual runs; tags create a draft release (pre-release for `-rc` tags).
- Windows signing: Certum cloud certificate through ssign (Certum cloud API, no SimplySign Desktop)
  on release tags (`build/sign-win.js`, secrets `CERTUM_USERNAME` / `CERTUM_TOTP_SECRET` in Base32,
  see docs/building.md). Third-party tools that receive secrets are pinned (release + SHA-256 or
  commit SHA) after review. SimplySign Desktop on GitHub's Windows runner does not work: its virtual
  smart card reader never registers.
- macOS signing: Developer ID Application certificate + notarization with an App Store Connect API
  key on release tags (secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`); `mac.hardenedRuntime` is on, notarization is enabled from
  the workflow with `-c.mac.notarize=true`.
