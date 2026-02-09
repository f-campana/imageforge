# Agent Review Brief

## Context
- Repo: `@imageforge/cli`
- Worktree: `/Users/fabiencampana/Documents/ImageForge/.worktrees/audit-p0-p1`
- Branch: `codex/audit-p0-p1`
- Base: `origin/main`

## Goal of This Change Set
Implement and close-loop the audit remediation scope (P0 + P1 + selected DX), then harden remaining gaps:
- true CLI-over-config precedence for boolean flags
- cache safety (schema versioning + cross-process lock)

## Commit Map (newest first)
- `a80c124` `fix(cli): close loop on config overrides and cache safety`
- `2a8d708` `fix(cli): enforce verbose and quiet mutual exclusivity`
- `2b12abc` `fix(cli): apply post-review verbosity and progress fixes`
- `e33e0c9` `docs: document config, logging modes, and publish flow`
- `93ce2c9` `ci(release): add npm publish and security audit jobs`
- `7dde425` `test(cli): expand coverage for audit remediation`
- `43c965d` `feat(cli): add runner with config, out-dir, and concurrency`

## Highest-Risk Areas to Review
1. CLI option resolution and precedence
- File: `src/cli.ts`
- Focus: config/default/CLI precedence, `--no-*` semantics, `--verbose` + `--quiet` conflict behavior.

2. Cache locking and schema behavior
- File: `src/runner.ts`
- Focus:
  - lock acquire/release lifecycle
  - timeout/stale lock behavior
  - schema v1 write + legacy cache read compatibility
  - lock path behavior when `--out-dir` does not yet exist.

3. Output path and collision semantics
- Files: `src/processor.ts`, `src/runner.ts`
- Focus: out-dir manifest path relativity, case-insensitive collision handling, check-mode rerun command fidelity.

4. Public API and packaging surface
- Files: `src/index.ts`, `package.json`
- Focus: exports correctness for root + subpaths and runtime CJS compatibility.

## Test/Validation Status
- Local gate passed:
  - `pnpm run check`
  - `pnpm run build`
- Current suite count: `58` tests passing.

## Suggested Independent Verification Commands
```bash
pnpm run check
pnpm run build
node dist/cli.js --help
node dist/cli.js --version
```

## Known Residual Risk (non-blocking)
- Cache locking is file-based and single-lock for full run duration; this is intentionally conservative for correctness, but may reduce parallel throughput when multiple processes target the same output root.
