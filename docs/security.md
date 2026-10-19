# Security model

## Local storage

- Connections are stored in `vault.json` in the application data folder. There is no account, no
  server of ours and no telemetry: Bucketeer only talks to the storage endpoints you configure.
- Secret access keys are encrypted with Electron's `safeStorage`:
  - **macOS**: Keychain (an item named *Bucketeer Safe Storage*),
  - **Windows**: DPAPI, tied to your Windows user account,
  - **Linux**: GNOME Keyring / KWallet through libsecret. Without a keyring, secrets are only
    obfuscated; Settings shows a warning in that case.
- The vault file is written atomically with `0600` permissions.

## Requests

- All S3 requests are signed locally (AWS Signature V4) with the AWS SDK for JavaScript v3.
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

The UI runs with `contextIsolation` and without Node integration; it talks to the main process only
through a fixed preload API. The Content Security Policy only allows the app's own scripts.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
