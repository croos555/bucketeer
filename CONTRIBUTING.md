# Contributing

Thanks for your interest in Bucketeer!

Please read and follow the [code of conduct](CODE_OF_CONDUCT.md).

## Reporting bugs and ideas

Open an issue on [GitHub](https://github.com/croos555/bucketeer/issues) with your OS, the
Bucketeer version, the storage provider and the steps to reproduce. **Never paste access keys,
secret keys, signed links or your `vault.json`**; mask bucket names and endpoints if needed.

Security issues: see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development

See [docs/development.md](docs/development.md) for the setup and the architecture.

Before opening a pull request:

- `npm run typecheck` and `cargo clippy` (in `src-tauri/`) pass,
- the app builds (`npm run build`) and you tried your change in `npm run dev`, ideally against a real
  S3-compatible service or a local test server (see the development guide),
- new dependencies (npm or crates) are MIT-compatible, `npm audit --omit=dev` stays clean,
- commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
  `docs:`…) and explain *why* when it isn't obvious.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
