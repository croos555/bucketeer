# Development

## Setup

```bash
npm install
npm run dev        # tauri dev: Vite with hot reload for the UI, rebuilds the Rust backend on change
npm run typecheck
```

Requirements: Node.js 22.12+ (Vite 8), Rust stable (via [rustup](https://rustup.rs)) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) of your system (Xcode command line
tools on macOS; WebView2 and the MSVC build tools on Windows; `libwebkit2gtk-4.1-dev`,
`librsvg2-dev`, `libdbus-1-dev`… on Linux, see the CI workflow for the full list).

## Architecture

Bucketeer is a [Tauri 2](https://tauri.app) app: a React UI in the system web view and a Rust
backend, sharing its design with [Sshelby](https://github.com/croos555/sshelby).

| Layer | Folder | Role |
|---|---|---|
| Backend | `src-tauri/src/` | S3 client (AWS SDK for Rust), transfers, local disk, vault storage |
| Bridge | `src/renderer/src/api.ts` | `window.api`: typed wrappers around Tauri commands and events |
| Renderer | `src/renderer/src/` | React 19 UI, zustand store |
| Shared | `src/shared/` | types, provider presets, URL helpers |

| File | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | plugins, command registration, window setup |
| `src-tauri/src/store.rs` | `vault.json`, secret fields, cascades on delete, import of the 0.1.0 vault |
| `src-tauri/src/secrets.rs` | AES-256-GCM encryption with a key kept in the OS keychain |
| `src-tauri/src/s3.rs` | one cached client per connection, listing, buckets, delete, rename, ACLs, presigning, error messages |
| `src-tauri/src/transfers.rs` | multipart uploads, streamed downloads, server-side or streamed copies, progress, cancel |
| `src-tauri/src/local.rs` | local folders: list, rename, mkdir, move to Trash, open |
| `shared/providers.ts` | provider presets: regions and endpoint templates |
| `shared/urls.ts` | public URL and `s3://` URI building |
| `renderer/src/components/BrowserTab.tsx` | dual-pane browser, transfers list, bucket list |
| `renderer/src/components/ObjectInfoPanel.tsx` | object details, visibility, links |

Adding a backend call = a `#[tauri::command]` in `src-tauri/src/`, registered in `lib.rs`, plus a
typed wrapper in `api.ts` (command names are snake_case, arguments camelCase).

## Checks

```bash
npm run typecheck
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Testing against a local S3 server

To exercise the S3 code without a cloud account, run an S3-compatible server locally, for example
SeaweedFS (the `minio/minio` image is no longer published on Docker Hub):

```bash
docker run -d --name s3test -p 127.0.0.1:8333:8333 chrislusf/seaweedfs server -s3 -s3.port=8333
```

- The end-to-end test (`src-tauri/src/s3_tests.rs`, ignored by default) runs every S3 operation
  against it: `cd src-tauri && cargo test -- --ignored --test-threads=1`.
- In the app, add a connection with provider *MinIO* / *Other*, endpoint `http://127.0.0.1:8333`,
  path-style URLs on, any keys. SeaweedFS in anonymous mode lists no buckets (open them with the
  default bucket or the path bar) and does not support ACL changes.
