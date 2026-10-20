# Security model

## Local storage

- Connections are stored in `vault.json` in the application data folder. There is no account, no
  server of ours and no telemetry: Bucketeer only talks to the storage endpoints you configure.
- Secret access keys are encrypted with AES-256-GCM. The 256-bit key is random, generated on first
  start and kept in the OS keychain (item *dev.bucketeer.app* / *vault-key*):
  - **macOS**: Keychain,
  - **Windows**: Credential Manager, tied to your Windows user account,
  - **Linux**: Secret Service (GNOME Keyring, KWallet). Without a keyring, secrets cannot be
    encrypted; Settings shows a warning in that case.
- The manual proxy's password is encrypted the same way. System proxies are read from the OS or the
  environment when needed and are not stored.
- The vault file is written atomically with `0600` permissions.

## Requests

- All S3 requests are signed locally (AWS Signature V4) with the AWS SDK for Rust.
- For non-AWS providers, the SDK's automatic CRC32 request checksums are limited to the operations
  that require them, because many S3-compatible services reject them. Integrity is still covered by
  TLS and by the providers' own checks.
- Use `https://` endpoints. `http://` is accepted for local test servers only.

## Public access

- Objects are never made public implicitly. Making objects public is an explicit action (context
  menu, details toggle) or an explicit per-connection setting for new uploads.
- Signed links are generated locally and expire (at most 7 days). Anyone holding one can download the
  object until it expires: share them carefully.

## Destructive operations

- Deletes are confirmed by default and are permanent on the bucket (local deletes go to the Trash).
- Deleting a bucket is refused by Bucketeer when the bucket is not empty, even on providers that
  would delete a non-empty bucket.

## Renderer isolation

The UI runs in the system web view without access to the file system or the network: it talks to
the Rust backend only through the commands registered in `src-tauri/src/lib.rs`, and the Tauri
capabilities (`src-tauri/capabilities/`) only grant the dialog, opener and clipboard plugins. The
Content Security Policy (`tauri.conf.json`) only allows the app's own scripts.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
