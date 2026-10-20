# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Proxy support (*Settings → Network*): the system proxy (environment variables, macOS and Windows
  network settings) by default, a manual proxy with optional authentication and bypass list, or
  direct connections.

## [0.2.0] — 2026-10-20

### Changed
- Bucketeer now runs on Tauri 2 with a Rust backend (AWS SDK for Rust) instead of Electron: the
  app is about 10 MB instead of 290 MB and starts faster. Connections and secret keys from 0.1.0
  are imported automatically on first start.
- Secret keys are encrypted with AES-256-GCM, with a random key kept in the OS keychain.
- Packages: dmg (Apple Silicon, Intel), Windows installer and portable exe (x64, ARM64), Linux
  AppImage, deb and rpm (x64, ARM64). The macOS zip is no longer published.

### Removed
- Splash screen (the app window opens immediately).

## [0.1.0] — 2026-10-19

First public release.

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
- macOS apps are signed with a Developer ID certificate (hardened runtime) and notarized by Apple.
