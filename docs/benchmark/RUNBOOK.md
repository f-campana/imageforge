# Benchmark Runbook

## Local Dry Run

```bash
pnpm run bench:dataset:synthetic -- --count 600
pnpm run bench:dataset:build -- --dataset-version 0.0.0-dev
pnpm run build

node scripts/bench/run-benchmark.mjs \
  --cli-path ./dist/cli.js \
  --tier-manifest ./.tmp/bench/build/v0.0.0-dev/tier30/tier-manifest.json \
  --workspace ./.tmp/bench/local-run \
  --run-count 3 \
  --profiles P2
```

## Head vs Main Comparison

```bash
node scripts/bench/compare-benchmark.mjs \
  --base-summary /path/to/base-summary.json \
  --head-summary /path/to/head-summary.json \
  --out-json /path/to/compare.json \
  --out-md /path/to/compare.md
```

## Dataset Release

1. Generate synthetic pool.
2. Optionally fetch open-license sources.
3. Build tier archives and manifest.
4. Publish release tag `bench-dataset-vX.Y.Z` with assets:
   - `imageforge-bench-tier30-vX.Y.Z.tar.zst`
   - `imageforge-bench-tier200-vX.Y.Z.tar.zst`
   - `imageforge-bench-tier500-vX.Y.Z.tar.zst`
   - `benchmark-dataset-manifest-vX.Y.Z.json`
   - `sha256sums-vX.Y.Z.txt`

## Monthly Governance Sync

1. Pull latest nightly benchmark artifacts.
2. Confirm dataset version, runner, and profile metadata.
3. Update site benchmark evidence constants.
4. Record `as-of` date and owner in site methodology section.
