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
6. Commit message lint runs during PR validation as informational feedback (`Commit Message Lint (informational)`), and is non-blocking.

## Releases and Tags

- Releases are automated by Release Please from Conventional Commits on `main`.
- Tags follow SemVer with a `v` prefix (for example `v0.1.1`) and are managed by release automation.
- Release Please uses the `RELEASE_PLEASE_TOKEN` secret (PAT) so release/tag events can trigger downstream workflows.
- npm publication is automated from GitHub `release.published` events via `.github/workflows/publish.yml` (with `workflow_dispatch` retained as break-glass fallback).
- npm publish uses GitHub OIDC trusted publishing (`id-token: write`); no `NPM_TOKEN` secret is required when the npm trusted publisher is configured.
- Do not manually edit `CHANGELOG.md` for routine releases; it is generated via release automation.

## Git Identity (Maintainers)

Set a canonical Git identity before contributing:

```bash
git config --global user.name "Fabien Campana"
git config --global user.email "37816914+f-campana@users.noreply.github.com"
git config --global user.useConfigOnly true
```

Optional local guardrail: configure the repository hook path to enforce a noreply author email at push time.

```bash
git config --local core.hooksPath .githooks
chmod +x .githooks/pre-push
```
