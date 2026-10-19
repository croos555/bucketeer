# Security policy

Bucketeer handles storage access keys, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub's
[private vulnerability reporting](https://github.com/croos555/bucketeer/security/advisories/new)
with a description, the affected version and steps to reproduce.

You can expect an acknowledgement within a few days. Once a fix is released, the issue can be made
public and you will be credited if you wish.

## Scope

In scope: credential storage, the renderer / main process boundary, anything that could leak access
keys or signed links, make objects public unintentionally, delete data unexpectedly, or execute code.

See [docs/security.md](docs/security.md) for how Bucketeer protects your data.
