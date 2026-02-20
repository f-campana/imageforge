# Benchmark Runbook

## Local Dry Run

```bash
pnpm run bench:dataset:fetch -- --out-dir ./.tmp/bench/sources
pnpm run bench:dataset:synthetic -- --count 600
pnpm run bench:dataset:build -- --dataset-version 0.0.0-dev --sources-dir ./.tmp/bench/sources
pnpm run build

node scripts/bench/run-benchmark.mjs \
  --cli-path ./dist/cli.js \
  --tier-manifest ./.tmp/bench/build/v0.0.0-dev/tier30/tier-manifest.json \
  --workspace ./.tmp/bench/local-run \
  --run-count 3 \
  --profiles P2
```

`fetch-sources` defaults are strict and fail-closed. Use waiver flags only for controlled recovery:

```bash
pnpm run bench:dataset:fetch -- \
  --out-dir ./.tmp/bench/sources \
  --allow-unpinned-sources \
  --allow-partial
```

## Head vs Main Comparison

```bash
node scripts/bench/compare-benchmark.mjs \
  --base-summary /path/to/base-summary.json \
  --head-summary /path/to/head-summary.json \
  --out-json /path/to/compare.json \
  --out-md /path/to/compare.md
```

## Export Site Snapshot (local)

```bash
node scripts/bench/export-site-snapshot.mjs \
  --head-summary /path/to/head-summary.json \
  --base-summary /path/to/base-summary.json \
  --compare /path/to/compare.json \
  --out /path/to/site-benchmark-snapshot.json \
  --repository f-campana/imageforge \
  --workflow-name "Benchmark CI" \
  --workflow-path ".github/workflows/benchmark-ci.yml" \
  --run-id 22036204221 \
  --run-attempt 1 \
  --run-url "https://github.com/f-campana/imageforge/actions/runs/22036204221" \
  --event-name schedule \
  --ref-name main \
  --sha 4ff596ceb9d3d7e0057d82e071c834505a212868 \
  --tier tier200 \
  --run-count 10 \
  --dataset-version 1.0.0 \
  --runner ubuntu-24.04 \
  --node-version 22 \
  --headline-profile P2 \
  --headline-scenario batch-all
```

## Sync Snapshot to `imageforge-site` (approval-gated)

```bash
export IMAGEFORGE_SITE_SYNC_TOKEN=***redacted***

node scripts/bench/sync-site-benchmark.mjs \
  --snapshot /path/to/site-benchmark-snapshot.json \
  --site-repo f-campana/imageforge-site \
  --site-default-branch main \
  --site-branch codex/benchmark-sync-nightly \
  --retention 20
```

Notes:

1. Sync uses a dedicated automation branch and force-pushes updates to that branch.
2. PRs are created/updated automatically, but never auto-merged.
3. Required secret in CLI repo: `IMAGEFORGE_SITE_SYNC_TOKEN` with `contents:write` and PR write access on `imageforge-site`.
4. Sync normalizes `data/benchmarks/latest.json` and `data/benchmarks/history.json` with repo-pinned Prettier (`pnpm exec prettier --write ...`) and fails closed if formatting cannot be applied.

## Dataset Release

1. Assert dataset tag does not already exist:

```bash
pnpm run bench:dataset:assert-tag -- \
  --repo f-campana/imageforge \
  --dataset-version X.Y.Z
```

2. Generate synthetic pool.
3. Fetch open-license sources (strict default).
4. Build tier archives and manifest.
5. Publish release tag `bench-dataset-vX.Y.Z` with assets:
   - `imageforge-bench-tier30-vX.Y.Z.tar.zst`
   - `imageforge-bench-tier200-vX.Y.Z.tar.zst`
   - `imageforge-bench-tier500-vX.Y.Z.tar.zst`
   - `benchmark-dataset-manifest-vX.Y.Z.json`
   - `sha256sums-vX.Y.Z.txt`

Release tags are immutable. Existing tags must not be overwritten; publish a new semantic version instead.

## Monthly Governance Sync

1. Pull latest nightly benchmark artifacts.
2. Confirm dataset version, runner, and profile metadata.
3. Review or merge the latest benchmark sync PR in `imageforge-site`.
4. Confirm `/benchmarks/latest` matches snapshot metadata and links.
