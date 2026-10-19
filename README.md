<p align="center">
  <img src="build/icon.png" width="128" alt="Bucketeer icon">
</p>

<h1 align="center">Bucketeer</h1>

<p align="center">
  A local-first browser for S3-compatible object storage, for macOS, Windows and Linux.<br>
  OVHcloud, Amazon S3, Scaleway, Wasabi, Cloudflare R2, MinIO and any S3-compatible service.<br>
  <b>No account, no cloud, no telemetry.</b>
</p>

---

Bucketeer is a desktop file manager for object storage buckets. It is a sibling of
[Sshelby](https://github.com/croos555/sshelby) and shares its stack and design. Connections and
secret keys are stored on your machine only, encrypted by your operating system's keychain.

## Features

- **Connections & groups**: provider presets with their regions (OVHcloud, AWS, Scaleway, Wasabi,
  Cloudflare R2, MinIO, custom endpoint), path-style or virtual-hosted URLs, connection test,
  default bucket for keys limited to one bucket, custom icons and colors.
- **Dual-pane browser**: local disk on one side, a bucket on the other (or two buckets), drag & drop
  between panes and from your file manager, breadcrumbs, filter, sorting, pagination of large
  listings.
- **Transfers**: upload and download of files and whole folders with progress and cancel,
  multipart uploads for large files (configurable part size and parallelism), bucket-to-bucket
  copies (server-side on the same connection, streamed across providers).
- **Buckets & objects**: create and delete buckets (Bucketeer refuses to delete a non-empty bucket
  even if the provider would allow it), create folders, rename and move, recursive delete.
- **Links**: the **public URL** of every object (derived from the endpoint or from a custom CDN /
  domain base), **make public / private** (object ACLs) with a live check that the URL answers,
  **signed links** with an expiry, `s3://` URIs.
- **Object details**: size, content type, storage class, ETag, version, metadata and image preview.

## Install

Download the package for your system from the [releases](https://github.com/croos555/bucketeer/releases):

| System | File |
|---|---|
| macOS (Apple Silicon / Intel) | `Bucketeer-<version>-arm64.dmg` / `-x64.dmg` |
| Windows | `Bucketeer Setup <version>.exe` (installer) or `Bucketeer-<version>-portable.exe` |
| Linux | `Bucketeer-<version>.AppImage`, `bucketeer_<version>_amd64.deb` or `bucketeer-<version>.x86_64.rpm` |

macOS releases are signed with a Developer ID and notarized by Apple. Windows releases are
code-signed (Certum); SmartScreen may still warn until the app builds up reputation.

## Documentation

- [User guide](docs/user-guide.md)
- [Security model](docs/security.md)
- [Development](docs/development.md)
- [Building & releasing](docs/building.md)
- [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security policy](SECURITY.md) · [Changelog](CHANGELOG.md)

## Build from source

```bash
git clone https://github.com/croos555/bucketeer.git
cd bucketeer
npm install
npm run dev          # run in development mode
npm run dist:mac     # or dist:win / dist:linux
```

Requires Node.js 22.12 or later. See [Building & releasing](docs/building.md) for details.

## License

[MIT](LICENSE) © Christophe Roos. Bundled dependencies keep their own licenses (MIT, Apache-2.0 for
the AWS SDK, BSD, ISC).

Bucketeer is an independent project and is not affiliated with OVHcloud, Amazon Web Services,
Scaleway, Wasabi, Cloudflare or MinIO.
