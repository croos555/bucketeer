# Development

## Setup

```bash
npm install
npm run dev        # electron-vite: hot reload for the UI, restarts the app when main-process code changes
npm run typecheck
```

Node.js 22.12+ is required (electron-vite / Vite 8).

## Architecture

Bucketeer is an Electron app built with electron-vite, sharing its structure with
[Sshelby](https://github.com/croos555/sshelby):

| Layer | Folder | Role |
|---|---|---|
| Main process | `src/main/` | S3 client (AWS SDK v3), transfers, local disk, vault storage, dialogs |
| Preload | `src/preload/` | the `window.api` bridge (contextIsolation, no Node in the UI) |
| Renderer | `src/renderer/src/` | React 19 UI, zustand store |
| Shared | `src/shared/` | types, provider presets, URL helpers |

| File | Responsibility |
|---|---|
| `main/index.ts` | window, splash, single-instance lock, IPC, lifecycle |
| `main/store.ts` | `vault.json`, secret encryption (`safeStorage`), cascades on delete |
| `main/s3.ts` | one cached `S3Client` per connection, listing, buckets, delete, rename, ACLs, presigning, error messages |
| `main/transfers.ts` | uploads (multipart via `@aws-sdk/lib-storage`), downloads, copies, progress, cancel |
| `shared/providers.ts` | provider presets: regions and endpoint templates |
| `shared/urls.ts` | public URL and `s3://` URI building |
| `renderer/src/components/BrowserTab.tsx` | dual-pane browser, transfers list, bucket list |
| `renderer/src/components/ObjectInfoPanel.tsx` | object details, visibility, links |

## Testing against a local S3 server

There is no test runner yet. To exercise the S3 code without a cloud account, run an S3-compatible
server locally, for example SeaweedFS:

```bash
docker run -d --name s3test -p 127.0.0.1:8333:8333 chrislusf/seaweedfs server -s3 -s3.port=8333
```

and add a connection with provider *MinIO* / *Other*, endpoint `http://127.0.0.1:8333`, path-style
URLs on, any keys. Note that SeaweedFS in anonymous mode lists no buckets (open them with the
default bucket or the path bar) and does not support ACL changes.

To try the UI without touching your own data, start a separate instance with its own data folder:

```bash
./node_modules/.bin/electron . --user-data-dir=/tmp/bucketeer-test
```

Main-process modules can be imported from Node (`node --no-warnings script.mts`) with a small loader
that stubs the `electron` module; use `import type` for type-only imports so Node's TypeScript
support can run them.
