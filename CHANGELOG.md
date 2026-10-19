# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

First public release (0.1.0).

### Added
- Connections with provider presets and regions (OVHcloud, AWS S3, Scaleway, Wasabi, Cloudflare R2,
  MinIO, custom endpoint), groups, custom icons and colors, connection test.
- Secret keys stored locally only, encrypted with the OS keychain.
- Dual-pane browser (local ↔ bucket, bucket ↔ bucket) with drag & drop, filter, sorting and
  pagination.
- Uploads and downloads of files and folders with progress and cancel; multipart uploads;
  server-side or streamed bucket-to-bucket copies.
- Bucket creation and deletion (refused when not empty), folders, rename/move, recursive delete.
- Public URL of every object (endpoint-derived or custom base), make public / private with a
  reachability check, "new uploads are public" option, signed links with an expiry, `s3://` URIs.
- Object details with metadata and image preview.
- Splash screen, light/dark appearance, packages for macOS (dmg, zip), Windows (installer, portable)
  and Linux (AppImage, deb, rpm).
- Windows executables are code-signed with a Certum open source certificate and timestamped.
