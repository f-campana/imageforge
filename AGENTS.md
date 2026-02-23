# AGENTS.md

## Project Overview

ImageForge is a TypeScript CLI package (`@imageforge/cli`) that scans image directories, generates optimized `webp`/`avif` derivatives, and writes a manifest (`imageforge.json`) with metadata and `blurDataURL` values.

Primary implementation lives in `src/` and ships as dual-module output in `dist/`:
ESM entrypoints and CommonJS compatibility under `dist/cjs/`.

## Tech Stack

- Runtime: Node.js `>=22`
- Package manager: `pnpm` (`packageManager: pnpm@10.28.2`)
- Language/build: TypeScript (`tsc`)
- CLI/runtime libs: `commander`, `chalk`, `sharp`, `p-limit`
- Quality: ESLint (`typescript-eslint` strict/stylistic), Prettier, Vitest
- CI/CD: GitHub Actions (`ci.yml`, `release-please.yml`, `publish.yml`, benchmark workflows)

## Setup and Commands

Run from repo root.

```bash
pnpm install
pnpm run build
```

Core dev commands:

```bash
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm run lint:fix
pnpm run format
pnpm run format:check
pnpm test
pnpm run test:watch
pnpm run test:e2e
pnpm run check
pnpm run release:verify
```

Command intent:

- `pnpm run check`: local quality gate (`typecheck + lint + format:check + test`).
- `pnpm run test:e2e`: packaged install smoke test (`tests/packaged-install.e2e.test.ts`).
- `pnpm run release:verify`: pre-release gate (`check + build + pnpm pack --dry-run`).

## Coding Conventions

- Write source changes in `src/*.ts`; do not hand-edit compiled output in `dist/`.
- Keep TypeScript strictness intact; avoid weakening types or bypassing lint rules without a strong reason.
- Follow existing formatting/style enforced by Prettier and ESLint:
  - double quotes
  - semicolons
  - trailing commas (`es5`)
  - max line width `100`
- Preserve path normalization behavior (`toPosix` / `fromPosix`) for manifest/output paths.
- When behavior touches CLI, packaging, exports, or config loading, update tests in `tests/imageforge.test.ts` and `tests/packaged-install.e2e.test.ts` in the same PR.

## Testing and Validation

Minimum before opening/updating a PR:

```bash
pnpm run check
pnpm run build
pnpm run test:e2e
```

Run additional validation when relevant:

- Release workflow changes: `pnpm run release:verify`
- If `package.json` or `pnpm-lock.yaml` changes: `pnpm audit --prod --audit-level=high`

Notes:

- `pnpm test` excludes the packaged-install E2E test by design.
- Tests create and delete temporary fixtures under `tests/fixtures`, `tests/cli-fixtures`, `tests/config-fixtures`, and `tests/test-output`.

## Workflow and PR Rules

- Use Conventional Commits for commit messages (e.g. `feat(cli): ...`, `fix(cache): ...`).
- PR titles must be semantic/Conventional Commit compatible (enforced by workflow).
- Keep PRs focused; describe behavior changes and edge cases in PR description.
- Ensure core checks pass locally (`check`, `build`, and `test:e2e`), and run `pnpm audit --prod --audit-level=high` when `package.json` or `pnpm-lock.yaml` changes.
- Release process is automated with Release Please:
  - Do not manually maintain `CHANGELOG.md` for routine releases.
  - Tags are SemVer with `v` prefix.

## Safety and Guardrails

- Do not commit secrets, tokens, or local machine paths.
- Do not manually edit generated/release artifacts unless the task explicitly requires it:
  - `dist/`
  - `.release-please-manifest.json`
  - release-generated `CHANGELOG.md` entries
- Preserve lockfile consistency; use `pnpm` for dependency changes.
- If using the optional local pre-push hook (`.githooks/pre-push`), keep `git user.email` set to a GitHub noreply address as enforced by the hook.

## Project Context and Key Files

- `package.json`: scripts, package exports, Node/pnpm requirements.
- `src/cli.ts`: CLI options, validation, config merge precedence, process exit behavior.
- `src/config.ts`: config loading from `--config`, `imageforge.config.json`, and `package.json#imageforge`.
- `src/runner.ts`: discovery, cache lock, processing pipeline, report/manifest writing.
- `src/processor.ts`: image discovery, hashing, conversion, blur generation, per-file processing.
- `src/index.ts` and `src/types.ts`: public API exports and manifest typings.
- `tests/imageforge.test.ts`: main functional/unit/integration coverage.
- `tests/packaged-install.e2e.test.ts`: tarball install and `npx imageforge` smoke test.
- `eslint.config.mjs`, `vitest.config.ts`, `tsconfig*.json`: quality/build configuration.
- `.github/workflows/*.yml`: CI, release automation, publish automation.
- `RELEASE_CHECKLIST.md`: manual release validation playbook.

## Directory-Specific Notes

- Add `**/AGENTS.override.md` only when a subdirectory has different commands, constraints, or release workflow.
- Use these directory expectations:
  - `src/`: production code.
  - `tests/`: Vitest suites, temporary fixture generation/cleanup.
  - `dist/`: generated build output only.
  - `assets/`: documentation/branding assets (not runtime code).
