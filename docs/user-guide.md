# User guide

## Connections

Open **Connections → New connection** and pick your provider. Choosing a region fills the endpoint
(for example `https://s3.gra.io.cloud.ovh.net` for OVHcloud Gravelines); you can still edit it.

| Field | Notes |
|---|---|
| Access key / secret key | For OVHcloud: Control Panel → Public Cloud → *Users & Roles* → S3 credentials. The secret key never leaves your computer and is encrypted with the OS keychain. |
| Path-style URLs | `endpoint/bucket/key` instead of `bucket.endpoint/key`. Needed by MinIO and some self-hosted services. |
| Default bucket | Opened directly. Required when the key is limited to one bucket and cannot list buckets. |
| New uploads | *Public* applies the `public-read` ACL to everything you upload or copy to this connection. |
| Public URL base | Replaces the endpoint in public URLs: a CDN, a custom domain or a static website. `{bucket}` is replaced by the bucket name. |

**Test connection** lists your buckets (or reads the default bucket) to check the endpoint, region
and keys. Connections can be organized in groups and given an icon and a color.

Double-click a connection (or **Open**) to start browsing it in a new tab.

## Browsing

Each tab has two panes. Use the source button at the top of a pane to switch it to your local disk
or to any saved connection. Without a bucket, a pane lists the buckets: create or delete them from
there (a bucket must be empty to be deleted).

- Double-click a folder to open it, a local file to open it with your system, an object to show its
  details.
- Breadcrumbs, back/forward and **Up** (or Backspace) navigate; double-click the path bar to type a
  path (`bucket/some/prefix` or `s3://bucket/prefix`).
- Listings of more than 1000 entries show **Load more**.
- Select with click, ⌘/Ctrl-click, Shift-click, ⌘/Ctrl+A and the arrow keys.

## Transfers

- Drag items from one pane to the other, onto a folder or onto a breadcrumb, or use the context menu
  (**Upload**, **Download**, **Copy to other side**, **Download to…**).
- Drop files and folders from your file manager onto a bucket pane to upload them.
- Folders are transferred recursively; empty local folders become folder markers.
- Bucket-to-bucket copies are done by the provider when both buckets use the same connection (up to
  5 GB per object), otherwise the data is streamed through your computer.
- Progress appears at the bottom right; transfers can be cancelled. Part size and parallelism of
  multipart uploads are in **Settings → Transfers**.

## Links and visibility

Objects are **private by default** on most providers: their public URL answers *403 Access Denied*.

- **Public URL**: shown in the object details and as an optional column (link icon in the pane
  header). Context menu → **Copy public URL** works on several files at once (one URL per line).
- **Make public / Make private**: context menu on files or folders (recursive), or the toggle in the
  object details. The details panel checks that the public URL really answers without credentials.
- **Signed link**: a temporary URL (1 hour, 1 day or 7 days) that works even on a private bucket.
- **Copy S3 URI**: `s3://bucket/key`.

Some buckets have ACLs disabled (AWS "bucket owner enforced"): public access then has to be granted
with a bucket policy in the provider's console.

## Other operations

New folder, rename (a folder rename copies and deletes every object under it), delete (recursive,
confirmed unless disabled in Settings), refresh.

## Settings

Appearance (system, light, dark), hidden files, delete confirmation, multipart part size and
parallelism, and whether the app keeps running when its window is closed.

### Proxy

*Settings → Network → Proxy* applies to every S3 request and to the public URL check:

- **System** (default): the `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` and `NO_PROXY` environment
  variables if set, otherwise the operating system's proxy (macOS network settings, Windows Internet
  settings, with their exceptions). On Linux only the environment variables are read. The proxy in
  use is shown below the setting.
- **Manual**: a proxy URL (`http://host:port`, or `https://` for a TLS proxy), an optional user and
  password, and the hosts that bypass it (`host`, `.domain`, `10.0.0.0/8`, comma-separated).
- **None**: always connect directly.

Local addresses (`localhost`, `127.0.0.1`, `::1`) never use the proxy. Automatic configuration
scripts (PAC) are not supported: enter the proxy manually.

## Where data is stored

`vault.json` in the application data folder: `~/Library/Application Support/dev.bucketeer.app` (macOS),
`%APPDATA%\dev.bucketeer.app` (Windows), `~/.local/share/dev.bucketeer.app` (Linux). The key that
encrypts the secret keys is in the OS keychain (item *dev.bucketeer.app*). On first start, a vault
left by Bucketeer 0.1.0 (`bucketeer` folder) is imported once.
