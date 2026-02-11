# Contributing

Thanks for your interest in improving ImageForge.

## Development Setup

1. Install Node.js 22 or newer.
2. Install dependencies with `pnpm install`.
3. Run checks with `pnpm run check`.
4. Build with `pnpm run build`.

## Commit Convention

Use Conventional Commits for all commit messages.

Examples:

- `feat(cli): add --dry-run mode`
- `fix(cache): avoid stale hash reuse`
- `docs: clarify check mode semantics`

Allowed types include: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Pull Requests

1. Keep PRs focused and small when possible.
2. Ensure CI is green (`pnpm run check` and `pnpm run build`).
3. Use a semantic PR title (Conventional Commit format).
4. Explain behavior changes and edge cases in the PR description.
5. If release behavior is touched, verify both release and publish workflows still pass.

## Releases and Tags

- Releases are automated by Release Please from Conventional Commits on `main`.
- Tags follow SemVer with a `v` prefix (for example `v0.1.1`) and are managed by release automation.
- npm publication is automated from GitHub `release.published` events via `.github/workflows/publish.yml`.
- `NPM_TOKEN` must be configured in repository secrets for publish jobs.
- Do not manually edit `CHANGELOG.md` for routine releases; it is generated via release automation.
